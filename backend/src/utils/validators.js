/**
 * Schemas de validación de inputs.
 * Toda entrada del cliente pasa por aquí antes de tocar la DB.
 */
const { z } = require('zod');
const { ALLOWED_TIME_CONTROLS } = require('../services/matchmakingService');

const usernameSchema = z
  .string()
  .min(3, 'El username debe tener al menos 3 caracteres')
  .max(30, 'El username no puede pasar de 30 caracteres')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Solo letras, números, guion y guion bajo');

const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(100, 'La contraseña es demasiado larga');

const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email('Email inválido').max(255),
  password: passwordSchema,
  country: z
    .string()
    .length(2, 'El país debe ser un código ISO de 2 letras')
    .toUpperCase()
    .default('CO'),
});

const loginSchema = z.object({
  // Permitimos login con email O username
  identifier: z.string().min(3).max(255),
  password: z.string().min(1),
});

const moveSchema = z.object({
  gameId: z.string().uuid(),
  // Movimiento en formato "from" + "to" (ej: e2 -> e4) y opcionalmente promoción
  from: z.string().regex(/^[a-h][1-8]$/, 'Casilla origen inválida'),
  to: z.string().regex(/^[a-h][1-8]$/, 'Casilla destino inválida'),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
});

const matchmakingSchema = z.object({
  countryFilter: z.enum(['CO', 'GLOBAL']).default('GLOBAL'),
  timeControl: z
    .enum(ALLOWED_TIME_CONTROLS)
    .default('10+0'),
});

const googleAuthSchema = z.object({
  // ID Token de Google (JWT firmado por Google). El backend lo verifica.
  idToken: z.string().min(20, 'idToken inválido'),
  // Username preferido cuando es la primera vez. Si no se pasa, lo deriva del email.
  preferredUsername: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Sólo letras, números, guion y guion bajo')
    .optional(),
});

module.exports = {
  registerSchema,
  loginSchema,
  moveSchema,
  matchmakingSchema,
  googleAuthSchema,
};
