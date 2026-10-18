/**
 * Inicializa Socket.io sobre el servidor HTTP de Express.
 *
 * El handshake exige un JWT en `auth.token` (cliente lo envía con
 * io(url, { auth: { token } })). Si falla, se rechaza la conexión.
 */
const { Server } = require('socket.io');
const env = require('../config/env');
const { verifyToken } = require('../utils/jwt');
const gameHandler = require('./gameHandler');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
    // Permitimos polling como fallback (algunos hosts gratuitos
    // no soportan WS puros, p. ej. ciertas configuraciones).
    transports: ['websocket', 'polling'],
  });

  // ---- Middleware: autenticación de socket ----
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('No token'));
      const payload = verifyToken(token);
      socket.user = {
        id: payload.sub,
        username: payload.username,
        country: payload.country,
        guest: payload.guest === true,
      };
      next();
    } catch (err) {
      next(new Error('Token inválido'));
    }
  });

  // Map<userId, socketId> — última sesión activa por usuario.
  // P1-5: si un mismo usuario abre 2 pestañas, desconectamos la anterior
  // para evitar duplicación de eventos y socketId sobreescrito en el state
  // de partida (potencial inconsistencia con múltiples tabs simultáneas).
  const activeSessions = new Map();

  io.on('connection', (socket) => {
    // Desplazar la sesión anterior del MISMO usuario (si existe y NO es ésta)
    const previousId = activeSessions.get(socket.user.id);
    if (previousId && previousId !== socket.id) {
      const prev = io.sockets.sockets.get(previousId);
      if (prev) {
        try {
          prev.emit('session:replaced', {
            reason: 'Tu sesión se abrió en otra pestaña.',
          });
          prev.disconnect(true);
        } catch { /* noop */ }
      }
    }
    activeSessions.set(socket.user.id, socket.id);

    console.log(`[socket] conectado ${socket.user.username} (${socket.id})`);
    gameHandler.register(io, socket);

    socket.on('disconnect', (reason) => {
      // Sólo limpiamos si seguimos siendo la "sesión activa" registrada
      // (si la perdimos por reemplazo, ya la sobreescribió otro socket).
      if (activeSessions.get(socket.user.id) === socket.id) {
        activeSessions.delete(socket.user.id);
      }
      console.log(`[socket] desconectado ${socket.user.username}: ${reason}`);
    });
  });

  return io;
}

module.exports = { initSocket };
