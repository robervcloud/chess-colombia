-- =========================================================
-- Migración 002: Sistema de análisis post-partida
-- =========================================================
-- Idempotente. Ejecutar UNA VEZ en el SQL Editor de Supabase.
-- =========================================================

-- ---------- TABLA: análisis ----------
create table if not exists game_analyses (
  game_id            uuid primary key references games(id) on delete cascade,
  status             varchar(16) not null default 'pending',
                     -- 'pending' | 'running' | 'done' | 'failed'
  engine_name        varchar(40),
  engine_depth       int,
  -- Per-move analysis: array de objetos con san, eval, bestMove, lines, classification, etc.
  moves_analysis     jsonb,
  -- Resumen agregado: blunders/mistakes/inaccuracies por color, accuracy, etc.
  summary            jsonb,
  -- Estimación de Elo (heurístico, NO Elo oficial)
  elo_white          int,
  elo_black          int,
  error_message      text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz
);

-- Índice parcial: lo que el worker pollea
create index if not exists idx_analyses_pending
  on game_analyses(created_at)
  where status = 'pending';

create index if not exists idx_analyses_status on game_analyses(status);

-- ---------- FUNCIÓN: reclamo atómico ----------
-- Soporta múltiples workers concurrentes sin race conditions:
-- "FOR UPDATE SKIP LOCKED" hace que cada worker reclame un row distinto.
create or replace function claim_pending_analysis()
returns table (game_id uuid, pgn text)
language plpgsql
as $$
declare
  claimed_id uuid;
begin
  select a.game_id into claimed_id
    from game_analyses a
    where a.status = 'pending'
    order by a.created_at asc
    limit 1
    for update skip locked;

  if claimed_id is null then
    return;
  end if;

  update game_analyses
    set status = 'running',
        started_at = now()
    where game_analyses.game_id = claimed_id;

  return query
    select a.game_id, g.pgn
      from game_analyses a
      join games g on g.id = a.game_id
      where a.game_id = claimed_id;
end;
$$;

-- ---------- (opcional) Reencolar análisis fallidos viejos ----------
-- Útil para reintentar manualmente algo que falló:
-- update game_analyses set status='pending', error_message=null
-- where status='failed' and game_id='<uuid>';
