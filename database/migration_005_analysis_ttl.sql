-- =========================================================
-- Migración 005: TTL automático para game_analyses
-- =========================================================
-- Mantiene la tabla liviana: borra análisis ya consumidos
-- (>30 min desde completed_at) o fallidos viejos (>1 día).
-- NO toca la tabla games — sólo el análisis derivado.
-- Si el usuario vuelve a pedir análisis, se re-genera.
-- =========================================================

create or replace function purge_old_analyses()
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  delete from game_analyses
   where (status = 'done'   and completed_at < now() - interval '30 minutes')
      or (status = 'failed' and completed_at < now() - interval '1 day');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Verificación manual:
-- select purge_old_analyses();
