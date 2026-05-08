/**
 * Rate limiting básico para endpoints sensibles.
 * En MVP usamos memoria del proceso. Cuando crezca,
 * cambiar `store` por uno basado en Redis sin tocar el resto.
 */
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                  // 20 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 min
  max: 120,                 // 120 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento.' },
});

module.exports = { authLimiter, apiLimiter };
