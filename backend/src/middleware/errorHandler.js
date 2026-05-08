/**
 * Manejador de errores de Express.
 * Convierte ZodError a 400 y todo lo demás a 500.
 */
const { ZodError } = require('zod');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  // Errores de negocio que se lanzan con { status, message }
  if (err && err.status && err.message) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error('[errorHandler]', err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { errorHandler };
