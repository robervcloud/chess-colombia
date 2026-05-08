/**
 * Configuración centralizada de variables de entorno.
 * Carga .env y valida que las variables críticas existan.
 */
require('dotenv').config();

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);

if (missing.length > 0) {
  // No hacemos throw para permitir que el server arranque en desarrollo
  // y muestre un mensaje claro en consola.
  console.warn(
    `⚠️  Faltan variables de entorno requeridas: ${missing.join(', ')}.\n` +
      `   Copia backend/.env.example a backend/.env y rellena los valores.`
  );
}

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  google: {
    // Si está vacío, el endpoint /api/auth/google responde 503.
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },
};
