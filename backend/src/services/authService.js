/**
 * Servicio de autenticación.
 * Toda la lógica de DB y hashing vive aquí; los controladores
 * sólo orquestan request/response.
 *
 * Cambios sobre la versión anterior:
 *   - Chequeo de `banned` en cada login (regular y Google).
 *   - Soporte para login/registro vía Google ID Token.
 *   - Tolera `password_hash` NULL (cuentas sólo-Google).
 */
const bcrypt = require('bcrypt');
const supabase = require('../config/supabase');
const env = require('../config/env');
const { signToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function publicUser(u) {
  if (!u) return u;
  const { password_hash, banned, banned_at, banned_reason, ...rest } = u;
  return rest;
}

function makeToken(user) {
  return signToken({
    sub: user.id,
    username: user.username,
    country: user.country,
  });
}

function ensureNotBanned(user) {
  if (user.banned) {
    throw {
      status: 403,
      message: 'Esta cuenta está bloqueada.' + (user.banned_reason ? ` Motivo: ${user.banned_reason}` : ''),
    };
  }
}

/**
 * Saca un username "limpio" a partir del email.
 *  juan.perez+spam@gmail.com  ->  juanperez
 */
function deriveUsernameFromEmail(email) {
  const base = String(email)
    .split('@')[0]
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 25);
  if (base.length >= 3) return base;
  return 'player' + Math.floor(1000 + Math.random() * 9000);
}

/**
 * Devuelve un username único en la DB (basado en `desired`, con sufijo si toca).
 */
async function ensureUniqueUsername(desired) {
  let candidate = desired;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', candidate)
      .limit(1);
    if (error) throw { status: 500, message: 'Error consultando usernames' };
    if (!data || data.length === 0) return candidate;
    candidate = `${desired}${Math.floor(100 + Math.random() * 9000)}`.slice(0, 30);
  }
  return `${desired}${Date.now().toString().slice(-6)}`.slice(0, 30);
}

// ------------------------------------------------------------------
// API pública (sin cambios de firma)
// ------------------------------------------------------------------

/**
 * Registra un usuario nuevo (flujo email/password tradicional).
 */
async function register({ username, email, password, country }) {
  // 1) Verificar que no exista
  const { data: existing, error: existingErr } = await supabase
    .from('users')
    .select('id, username, email')
    .or(`username.eq.${username},email.eq.${email}`)
    .limit(1);

  if (existingErr) throw { status: 500, message: 'Error consultando usuarios' };
  if (existing && existing.length > 0) {
    throw { status: 409, message: 'El username o el email ya están en uso' };
  }

  // 2) Hashear password
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  // 3) Insertar
  const { data: user, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash, country })
    .select('id, username, email, country, rating, banned, banned_reason, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw { status: 409, message: 'El username o el email ya están en uso' };
    }
    throw { status: 500, message: 'No se pudo crear el usuario' };
  }

  return { user: publicUser(user), token: makeToken(user) };
}

/**
 * Login con username o email + password.
 */
async function login({ identifier, password }) {
  const isEmail = identifier.includes('@');
  const column = isEmail ? 'email' : 'username';

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, email, country, rating, password_hash, banned, banned_reason, created_at')
    .eq(column, identifier)
    .single();

  if (error || !user) {
    throw { status: 401, message: 'Credenciales inválidas' };
  }

  // Cuenta creada vía Google y todavía sin password
  if (!user.password_hash) {
    throw {
      status: 401,
      message: 'Esta cuenta fue creada con Google. Usa "Iniciar sesión con Google".',
    };
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw { status: 401, message: 'Credenciales inválidas' };

  ensureNotBanned(user);

  return { user: publicUser(user), token: makeToken(user) };
}

/**
 * Login / auto-registro con Google ID Token.
 * El frontend obtiene el `idToken` de Google Identity Services
 * y lo manda al backend; aquí lo verificamos contra Google y
 * resolvemos al usuario.
 *
 * Reglas:
 *   1. Si ya hay usuario con `google_id` -> log in.
 *   2. Si hay usuario con ese `email` (creado con password) ->
 *      enlazar (set google_id) y log in. La password sigue siendo válida.
 *   3. Si no existe -> crear cuenta nueva con username derivado.
 *
 * Banned siempre se chequea al final.
 */
async function loginWithGoogle({ idToken, preferredUsername }) {
  if (!env.google.clientId) {
    throw { status: 503, message: 'Login con Google no está configurado en el servidor.' };
  }

  // require lazy: si la dependencia no está instalada, mensaje claro
  let OAuth2Client;
  try {
    ({ OAuth2Client } = require('google-auth-library'));
  } catch {
    throw {
      status: 503,
      message: 'Falta dependencia google-auth-library. Ejecuta `npm install` en /backend.',
    };
  }

  const client = new OAuth2Client(env.google.clientId);
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('[auth.google] verifyIdToken falló:', err.message);
    throw { status: 401, message: 'Token de Google inválido' };
  }

  const googleId = payload.sub;
  const email = (payload.email || '').toLowerCase();
  const emailVerified = payload.email_verified === true;

  if (!email || !emailVerified) {
    throw { status: 401, message: 'Tu email de Google no está verificado.' };
  }

  // 1) ¿Ya hay usuario por google_id?
  let { data: byGoogle } = await supabase
    .from('users')
    .select('id, username, email, country, rating, banned, banned_reason, created_at')
    .eq('google_id', googleId)
    .single();

  if (byGoogle) {
    ensureNotBanned(byGoogle);
    return { user: publicUser(byGoogle), token: makeToken(byGoogle) };
  }

  // 2) ¿Hay usuario con ese email? (cuenta creada con password). Enlazamos.
  const { data: byEmail } = await supabase
    .from('users')
    .select('id, username, email, country, rating, banned, banned_reason, created_at')
    .eq('email', email)
    .single();

  if (byEmail) {
    ensureNotBanned(byEmail);
    const { data: linked, error: linkErr } = await supabase
      .from('users')
      .update({ google_id: googleId })
      .eq('id', byEmail.id)
      .select('id, username, email, country, rating, banned, banned_reason, created_at')
      .single();
    if (linkErr) throw { status: 500, message: 'No se pudo enlazar la cuenta de Google' };
    return { user: publicUser(linked), token: makeToken(linked) };
  }

  // 3) No existe -> crear cuenta nueva
  const desired = preferredUsername || deriveUsernameFromEmail(email);
  const username = await ensureUniqueUsername(desired);

  const { data: created, error: createErr } = await supabase
    .from('users')
    .insert({
      username,
      email,
      google_id: googleId,
      password_hash: null, // sólo Google por ahora
      country: 'CO', // default; el usuario lo puede cambiar luego
    })
    .select('id, username, email, country, rating, banned, banned_reason, created_at')
    .single();

  if (createErr) {
    if (createErr.code === '23505') {
      throw { status: 409, message: 'El username o el email ya están en uso' };
    }
    console.error('[auth.google] insert error:', createErr);
    throw { status: 500, message: 'No se pudo crear la cuenta con Google' };
  }

  ensureNotBanned(created);
  return { user: publicUser(created), token: makeToken(created) };
}

/**
 * Devuelve el usuario "público". Usado por GET /api/auth/me.
 * También revalida `banned` para que un usuario baneado pierda acceso
 * aunque el JWT siga vivo.
 */
async function getPublicProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, username, country, rating, games_played, wins, losses, draws, banned, banned_reason, created_at'
    )
    .eq('id', userId)
    .single();

  if (error || !data) throw { status: 404, message: 'Usuario no encontrado' };
  ensureNotBanned(data);
  return publicUser(data);
}

module.exports = { register, login, loginWithGoogle, getPublicProfile };
