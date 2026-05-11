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

// ---- Validación dura de JWT_SECRET en producción ----
// En dev permitimos el default para que `npm run dev` arranque sin .env.
// En producción es un fallo de seguridad: cualquiera podría forjar tokens.
const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production') {
  const s = process.env.JWT_SECRET;
  if (!s || s === 'dev-secret-change-me' || s.length < 32) {
    console.error(
      '\n[FATAL] JWT_SECRET no está configurado o es inseguro en producción.\n' +
      '        Define una env var JWT_SECRET de al menos 32 caracteres.\n' +
      '        Generar uno seguro:\n' +
      '          node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
    );
    process.exit(1);
  }
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
