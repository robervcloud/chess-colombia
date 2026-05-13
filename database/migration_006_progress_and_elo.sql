-- =========================================================
-- Migración 006: progreso en vivo + confianza/razones de Elo
-- =========================================================
-- Idempotente. Ejecutar en Supabase SQL Editor.
-- =========================================================

alter table game_analyses add column if not exists progress_current     int default 0;
alter table game_analyses add column if not exists progress_total       int default 0;
alter table game_analyses add column if not exists elo_confidence_white text;
alter table game_analyses add column if not exists elo_confidence_black text;
alter table game_analyses add column if not exists elo_reasons_white    jsonb;
alter table game_analyses add column if not exists elo_reasons_black    jsonb;

notify pgrst, 'reload schema';

-- Verificación:
-- select column_name from information_schema.columns
-- where table_name='game_analyses' order by ordinal_position;
