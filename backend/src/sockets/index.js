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
      };
      next();
    } catch (err) {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] conectado ${socket.user.username} (${socket.id})`);
    gameHandler.register(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] desconectado ${socket.user.username}: ${reason}`);
    });
  });

  return io;
}

module.exports = { initSocket };
