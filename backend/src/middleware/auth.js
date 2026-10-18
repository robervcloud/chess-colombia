/**
 * Middleware de autenticación.
 * Lee el token del header Authorization: Bearer <token>
 * y agrega req.user = { id, username, country }.
 */
const { verifyToken } = require('../utils/jwt');

function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const [scheme, token] = auth.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Token no provisto' });
    }

    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      username: payload.username,
      country: payload.country,
      guest: payload.guest === true,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { authRequired };
