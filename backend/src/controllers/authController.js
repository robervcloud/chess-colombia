/**
 * Controlador HTTP de auth: registra, loguea, devuelve el perfil actual.
 */
const authService = require('../services/authService');
const { registerSchema, loginSchema, googleAuthSchema } = require('../utils/validators');

async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await authService.register(data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function googleAuth(req, res, next) {
  try {
    const data = googleAuthSchema.parse(req.body);
    const result = await authService.loginWithGoogle(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function guest(req, res, next) {
  try {
    const result = await authService.createGuest();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const profile = await authService.getPublicProfile(req.user.id);
    res.json({ user: { ...profile, guest: req.user.guest } });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, googleAuth, guest, me };
