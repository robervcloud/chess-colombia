-- =========================================================
-- Migración 010: índices para Panel de Ejercicios (insights)
-- =========================================================
-- Idempotente. getInsights filtra puzzle_attempts por
-- (user_id, created_at >= since) ordenado desc. Ya existe
-- idx_attempts_user_created (user_id, created_at desc) de la
-- migración 007 → cubre el caso. Este índice extra acelera la
-- cola de repeat (solved=false por usuario).
-- =========================================================

create index if not exists idx_attempts_user_solved
  on puzzle_attempts(user_id, solved, created_at desc);

notify pgrst, 'reload schema';
