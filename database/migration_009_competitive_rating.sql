-- =========================================================
-- Migración 009: rating competitivo + base Parte 3 tácticas
-- =========================================================
-- Idempotente. Ejecutar UNA sola vez en Supabase SQL Editor
-- antes que migration_010_insights_index.sql.
--
-- ¿Por qué existe? Sin esta migración:
--   - tacticsService.recordAttempt() falla al UPDATE
--     (columnas daily_streak/xp/last_solved_day no existen)
--   - applyRatingForGame() no tiene columnas rating_blitz/rapid/etc
--   - endpoints /api/tactics/daily y /api/tactics/rush dan 500
-- =========================================================

-- ============== PARTE 1: Rating competitivo Glicko-2 ==============
-- Un rating por modalidad. Compatible con users.rating legacy (la dejamos).

alter table users add column if not exists rating_bullet     int  not null default 1500;
alter table users add column if not exists rd_bullet         int  not null default 350;
alter table users add column if not exists vol_bullet        real not null default 0.06;
alter table users add column if not exists games_bullet      int  not null default 0;

alter table users add column if not exists rating_blitz      int  not null default 1500;
alter table users add column if not exists rd_blitz          int  not null default 350;
alter table users add column if not exists vol_blitz         real not null default 0.06;
alter table users add column if not exists games_blitz       int  not null default 0;

alter table users add column if not exists rating_rapid      int  not null default 1500;
alter table users add column if not exists rd_rapid          int  not null default 350;
alter table users add column if not exists vol_rapid         real not null default 0.06;
alter table users add column if not exists games_rapid       int  not null default 0;

alter table users add column if not exists rating_classical  int  not null default 1500;
alter table users add column if not exists rd_classical      int  not null default 350;
alter table users add column if not exists vol_classical     real not null default 0.06;
alter table users add column if not exists games_classical   int  not null default 0;

create index if not exists idx_users_rating_blitz on users(rating_blitz desc);
create index if not exists idx_users_rating_rapid on users(rating_rapid desc);

-- Historial de cambios de rating (para gráficas + auditoría)
create table if not exists rating_history (
  id          bigserial primary key,
  user_id     uuid not null references users(id) on delete cascade,
  mode        text not null,
  game_id     uuid references games(id) on delete set null,
  rating      int  not null,
  rd          int  not null,
  delta       int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rating_history_user on rating_history(user_id, created_at desc);

-- ============== PARTE 3 BASE: Daily Puzzle + Puzzle Rush ==============

create table if not exists daily_puzzles (
  day        date primary key,
  puzzle_id  text not null references puzzles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists puzzle_rush_runs (
  id            bigserial primary key,
  user_id       uuid not null references users(id) on delete cascade,
  mode          text not null default '3min',
  score         int  not null default 0,
  max_combo     int  not null default 0,
  duration_sec  int  not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rush_user_score on puzzle_rush_runs(user_id, score desc);

-- Columnas extra en user_tactics_stats (tacticsService.recordAttempt las usa)
alter table user_tactics_stats add column if not exists daily_streak    int  not null default 0;
alter table user_tactics_stats add column if not exists last_solved_day date;
alter table user_tactics_stats add column if not exists xp              int  not null default 0;

notify pgrst, 'reload schema';
