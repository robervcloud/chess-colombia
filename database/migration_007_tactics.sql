-- =========================================================
-- Migración 007: Sistema de Tácticas
-- =========================================================
-- Idempotente. Compatible con el seed `tactics_seed_starter.sql`.
-- Formato de puzzles alineado con Lichess CC0 (importable masivo).
-- =========================================================

-- (1) Catálogo de puzzles
-- moves_uci: secuencia separada por espacios. La PRIMERA jugada es la
-- del oponente (sitúa la posición tras aplicarla quedará al usuario en
-- turno). Luego alternan usuario / oponente.
create table if not exists puzzles (
  id           text primary key,
  fen          text not null,
  moves_uci    text not null,
  rating       int  not null default 1200,
  themes       text[] not null default '{}',
  popularity   int  not null default 0,
  attempts     int  not null default 0,
  success_rate real not null default 0.5,
  source       text default 'manual',
  created_at   timestamptz not null default now()
);

create index if not exists idx_puzzles_rating on puzzles(rating);
create index if not exists idx_puzzles_themes on puzzles using gin(themes);

-- (2) Stats por usuario
create table if not exists user_tactics_stats (
  user_id        uuid primary key references users(id) on delete cascade,
  rating         int  not null default 800,
  rd             int  not null default 350,         -- rating deviation (para confianza)
  solved         int  not null default 0,
  attempted      int  not null default 0,
  current_streak int  not null default 0,
  best_streak    int  not null default 0,
  total_time_ms  bigint not null default 0,
  by_theme       jsonb not null default '{}',       -- {fork: {solved:5, attempted:7}, ...}
  recent_ids     text[] not null default '{}',      -- últimos 20 ids servidos
  updated_at     timestamptz not null default now()
);

-- (3) Intentos (registro append-only)
create table if not exists puzzle_attempts (
  id           bigserial primary key,
  user_id      uuid not null references users(id) on delete cascade,
  puzzle_id    text not null references puzzles(id) on delete cascade,
  solved       boolean not null,
  hints_used   smallint not null default 0,
  time_ms      int not null,
  rating_delta int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_attempts_user_created on puzzle_attempts(user_id, created_at desc);

-- (4) Cleanup periódico (>90 días)
create or replace function purge_old_attempts()
returns integer
language plpgsql
as $$
declare n int;
begin
  delete from puzzle_attempts where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

notify pgrst, 'reload schema';

-- Para sembrar puzzles iniciales, ejecutar después:
--   tactics_seed_starter.sql
