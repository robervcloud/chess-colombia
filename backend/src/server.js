/**
 * Punto de entrada. Crea el servidor HTTP a partir de la app
 * Express y le monta Socket.io encima (mismo puerto).
 */
const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { initSocket } = require('./sockets');

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  console.log(`✅ Backend corriendo en http://localhost:${env.port}`);
  console.log(`   CORS para: ${env.clientOrigin}`);
  console.log(`   Modo: ${env.nodeEnv}`);
});

// Cierre limpio
function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando servidor...`);
  server.close(() => process.exit(0));
  // Forzamos salida si tarda demasiado
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---- Red de seguridad ante errores no manejados ----
// Mejor crashear limpio y dejar que Render reinicie el servicio
// que quedarse en estado indefinido sirviendo respuestas raras.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  shutdown('UNHANDLED_REJECTION');
});
