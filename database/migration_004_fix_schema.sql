-- =========================================================
-- Migración 004: arreglar schema incompleto de game_analyses
-- =========================================================
-- Síntoma: worker logea "Could not find the 'X' column of
-- 'game_analyses' in the schema cache" (PGRST204).
--
-- Causa: la tabla game_analyses se creó sin todas las columnas
-- que el worker necesita (probablemente migración 002 ejecutada
-- parcialmente o tabla creada manualmente).
--
-- Solución: agregar TODAS las columnas que faltan de forma
-- idempotente (IF NOT EXISTS), refrescar el cache de PostgREST,
-- y resetear las filas que quedaron atascadas en 'running'.
-- =========================================================

-- ---------- 1. Garantizar que TODAS las columnas existen ----------
alter table game_analyses add column if not exists engine_name      varchar(40);
alter table game_analyses add column if not exists engine_depth     int;
alter table game_analyses add column if not exists moves_analysis   jsonb;
alter table game_analyses add column if not exists summary          jsonb;
alter table game_analyses add column if not exists elo_white        int;
alter table game_analyses add column if not exists elo_black        int;
alter table game_analyses add column if not exists error_message    text;
alter table game_analyses add column if not exists started_at       timestamptz;
alter table game_analyses add column if not exists completed_at     timestamptz;
alter table game_analyses add column if not exists created_at       timestamptz not null default now();

-- ---------- 2. Refrescar el schema cache de PostgREST ----------
-- Supabase usa PostgREST. Tras un ALTER TABLE, el cache puede tardar
-- en refrescarse. Este NOTIFY lo fuerza de inmediato.
notify pgrst, 'reload schema';

-- ---------- 3. Resetear filas atascadas por este bug ----------
-- Las que se quedaron en 'running' (markDone falló).
-- Las que están en 'failed' por el error de columna faltante.
update game_analyses
   set status = 'pending',
       started_at = null,
       error_message = null,
       completed_at = null
 where status = 'running'
    or (status = 'failed'
        and error_message ilike '%column%schema cache%');

-- ---------- 4. Verificación ----------
-- Estas dos queries deberían devolver lo esperado:

-- 4a. Todas las columnas que el código espera:
select column_name
  from information_schema.columns
 where table_name = 'game_analyses'
 order by ordinal_position;
-- Esperado: game_id, status, engine_name, engine_depth, moves_analysis,
--           summary, elo_white, elo_black, error_message, created_at,
--           started_at, completed_at

-- 4b. Estado de las filas:
select status, count(*) from game_analyses group by status;
-- Esperado: todas en 'pending' (el worker las recogerá enseguida)
