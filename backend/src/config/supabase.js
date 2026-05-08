/**
 * Cliente único de Supabase usado en todo el backend.
 * Usamos la service_role key porque la lógica de seguridad
 * vive en el backend (JWT propio, validaciones, etc.).
 */
const { createClient } = require('@supabase/supabase-js');
const env = require('./env');

const supabase = createClient(env.supabase.url, env.supabase.serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
