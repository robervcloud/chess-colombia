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

// Invitados: cada llamada crea una fila en `users`, así que limitamos
// más fuerte para que nadie llene la tabla con scripts.
const guestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,                  // 10 invitados por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas sesiones de invitado. Intenta más tarde o crea una cuenta.' },
});

module.exports = { authLimiter, apiLimiter, guestLimiter };
