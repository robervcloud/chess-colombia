-- =========================================================
-- Migración 001: Google OAuth + base anti-cheat
-- =========================================================
-- Ejecutar en el SQL Editor de Supabase UNA SOLA VEZ.
-- Es idempotente: usa IF NOT EXISTS / DROP NOT NULL seguros.
-- Si tu DB es nueva, también puedes correr `schema.sql`
-- directamente; ya incluye estos cambios.
-- =========================================================

-- ---- 1) password_hash ahora puede ser NULL (cuentas sólo-Google) ----
alter table users
  alter column password_hash drop not null;

-- ---- 2) google_id: identificador único del usuario en Google (claim "sub") ----
alter table users
  add column if not exists google_id varchar(64) unique;

create index if not exists idx_users_google_id on users(google_id);

-- ---- 3) Campos para anti-cheat / bloqueos ----
alter table users
  add column if not exists banned         boolean      not null default false,
  add column if not exists banned_at      timestamptz,
  add column if not exists banned_reason  text;

-- Índice parcial: solo nos importan los baneados al filtrar
create index if not exists idx_users_banned on users(banned) where banned = true;

-- ---- 4) Sanity checks ----
-- email ya era UNIQUE NOT NULL, lo dejamos explícito
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'email' and is_nullable = 'NO'
  ) then
    alter table users alter column email set not null;
  end if;
end $$;
