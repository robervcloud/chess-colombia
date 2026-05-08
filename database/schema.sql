-- =========================================================
-- Chess Colombia - Esquema de base de datos (Supabase / PostgreSQL)
-- =========================================================
-- Ejecutar en el SQL Editor de Supabase una sola vez.
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------- USUARIOS ----------
create table if not exists users (
  id              uuid primary key default uuid_generate_v4(),
  username        varchar(30)  unique not null,
  email           varchar(255) unique not null,
  password_hash   varchar(255),                                -- NULL permitido para cuentas sólo-Google
  google_id       varchar(64)  unique,                         -- claim "sub" del ID Token de Google
  country         varchar(2)   not null default 'CO',
  rating          integer      not null default 1200,
  games_played    integer      not null default 0,
  wins            integer      not null default 0,
  losses          integer      not null default 0,
  draws           integer      not null default 0,
  banned          boolean      not null default false,         -- base para anti-cheat / moderación
  banned_at       timestamptz,
  banned_reason   text,
  created_at      timestamptz  not null default now()
);

create index if not exists idx_users_username  on users(username);
create index if not exists idx_users_email     on users(email);
create index if not exists idx_users_country   on users(country);
create index if not exists idx_users_rating    on users(rating desc);
create index if not exists idx_users_google_id on users(google_id);
create index if not exists idx_users_banned    on users(banned) where banned = true;

-- ---------- PARTIDAS ----------
create table if not exists games (
  id              uuid primary key default uuid_generate_v4(),
  white_id        uuid references users(id) on delete set null,
  black_id        uuid references users(id) on delete set null,
  white_username  varchar(30),
  black_username  varchar(30),
  moves           jsonb        not null default '[]'::jsonb,  -- [{san, from, to, fen, ts}]
  pgn             text,
  fen             text         not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  result          varchar(10),                                 -- '1-0' | '0-1' | '1/2-1/2' | null
  status          varchar(20)  not null default 'active',      -- 'active' | 'finished' | 'aborted'
  termination     varchar(40),                                  -- 'checkmate' | 'resignation' | 'timeout' | 'draw' | 'abandonment'
  time_control    varchar(20)  default '10+0',
  country_filter  varchar(10)  default 'GLOBAL',                -- 'CO' | 'GLOBAL'
  created_at      timestamptz  not null default now(),
  ended_at        timestamptz
);

create index if not exists idx_games_white     on games(white_id);
create index if not exists idx_games_black     on games(black_id);
create index if not exists idx_games_status    on games(status);
create index if not exists idx_games_created   on games(created_at desc);

-- ---------- VISTA: Historial por usuario ----------
create or replace view user_games as
  select id, white_id, black_id, white_username, black_username,
         result, status, termination, time_control, created_at, ended_at
  from games
  where status = 'finished';

-- =========================================================
-- IMPORTANTE: La autenticación NO usa Supabase Auth.
-- Manejamos hash + JWT desde el backend, así que las
-- tablas se acceden con la SERVICE_ROLE_KEY desde el server.
-- No habilitamos RLS para simplificar el MVP. Si en el
-- futuro se accede directo desde el cliente, agregar RLS.
-- =========================================================
