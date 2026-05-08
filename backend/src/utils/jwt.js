/**
 * Helpers de JWT. Centralizados para que cambiar de librería
 * (p. ej. a jose o paseto) sólo afecte un archivo.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signToken(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

module.exports = { signToken, verifyToken };
