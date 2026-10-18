-- =========================================================
-- Migración 011: limpieza de usuarios invitados
-- =========================================================
-- POST /api/auth/guest crea filas en `users` con email
-- '...@guest.invalid'. Su JWT dura 24 h, así que después de
-- unos días ya nadie puede usarlas.
--
-- Esta función borra invitados con más de N días (default 3).
-- Las partidas se conservan: games.white_id / black_id quedan
-- en NULL (on delete set null); progreso de tácticas y rating
-- se borran en cascada.
--
-- Uso manual:   select cleanup_guest_users();
-- Programado:   habilita la extensión pg_cron en Supabase
--               (Database → Extensions) y ejecuta el bloque
--               comentado al final.
-- =========================================================

create index if not exists idx_users_guest_created
  on users(created_at)
  where email like '%@guest.invalid';

create or replace function cleanup_guest_users(older_than_days int default 3)
returns int
language sql
as $$
  with deleted as (
    delete from users
    where email like '%@guest.invalid'
      and created_at < now() - make_interval(days => older_than_days)
    returning 1
  )
  select count(*)::int from deleted;
$$;

-- select cron.schedule('cleanup-guests', '0 4 * * *', $$select cleanup_guest_users()$$);

notify pgrst, 'reload schema';
