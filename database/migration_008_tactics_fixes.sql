-- =========================================================
-- Migración 008: limpieza y escalabilidad de tácticas
-- =========================================================
-- Idempotente. Ejecutar después de migrar a puzzles de Lichess
-- (el DELETE de manuales debe correrse DESPUÉS de importar Lichess,
-- nunca antes — dejarías la tabla vacía).
-- =========================================================

-- (1) Borrar los puzzles manuales rotos.
-- Comentado para que NO se ejecute por accidente. Descomentá tras
-- haber importado Lichess y confirmado puzzles 'lichess' presentes.

-- delete from puzzles where source = 'manual' or source is null;

-- (2) Índices adicionales para escala (cientos de miles+)
-- Búsqueda principal: rating range + filtro temas → ya tenemos
-- idx_puzzles_rating + idx_puzzles_themes (gin).
-- Agregamos uno por (rating, popularity desc) para ranking futuro
-- y otro para leaderboard táctico.
create index if not exists idx_puzzles_rating_pop on puzzles(rating, popularity desc);
create index if not exists idx_user_tactics_rating on user_tactics_stats(rating desc);

-- (3) RPC opcional para recalcular agregados (popularity / success_rate)
-- desde puzzle_attempts. NO se llama en el flujo normal: se ejecuta
-- manualmente o por cron periódico.
-- Uso:
--   select recompute_puzzle_aggregates();
create or replace function recompute_puzzle_aggregates()
returns integer
language plpgsql
as $$
declare n int;
begin
  with agg as (
    select puzzle_id,
           count(*)::int                                            as attempts,
           (sum(case when solved then 1 else 0 end)::real / count(*)) as success_rate
      from puzzle_attempts
     group by puzzle_id
  )
  update puzzles p
     set attempts     = agg.attempts,
         success_rate = agg.success_rate
    from agg
   where p.id = agg.puzzle_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

notify pgrst, 'reload schema';
