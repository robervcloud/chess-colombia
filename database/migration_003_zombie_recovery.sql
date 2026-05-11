-- =========================================================
-- Migración 003: recuperación de análisis zombie
-- =========================================================
-- Problema: si el worker muere a mitad de análisis (deploy en
-- Render, OOM, crash de Stockfish), la fila queda en
-- status='running' indefinidamente y nunca se reintenta.
--
-- Solución: redefinir claim_pending_analysis() para que también
-- reclame filas 'running' cuyo started_at sea > 5 minutos atrás.
-- 5 minutos es generoso: análisis típico tarda 15-30 segundos.
--
-- Idempotente: usar CREATE OR REPLACE. No toca datos existentes.
-- =========================================================

create or replace function claim_pending_analysis()
returns table (game_id uuid, pgn text)
language plpgsql
as $$
declare
  claimed_id uuid;
begin
  -- Reclama:
  --   1. filas 'pending' (caso normal)
  --   2. filas 'running' viejas (rescate de zombies tras crash)
  select a.game_id into claimed_id
    from game_analyses a
    where a.status = 'pending'
       or (a.status = 'running' and a.started_at < now() - interval '5 minutes')
    order by a.created_at asc
    limit 1
    for update skip locked;

  if claimed_id is null then
    return;
  end if;

  update game_analyses
    set status = 'running',
        started_at = now(),
        -- Si reciclamos un zombie, dejamos pista en error_message
        error_message = case
          when error_message is null then null
          else 'reclaimed from running'
        end
    where game_analyses.game_id = claimed_id;

  return query
    select a.game_id, g.pgn
      from game_analyses a
      join games g on g.id = a.game_id
      where a.game_id = claimed_id;
end;
$$;

-- Recordatorio operativo:
-- Si tienes filas 'failed' y quieres reintentarlas manualmente:
--   update game_analyses set status='pending', error_message=null where status='failed';
