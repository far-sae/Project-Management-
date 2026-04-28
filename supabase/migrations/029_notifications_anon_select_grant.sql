-- 028 revoked ALL privileges from anon on notifications. PostgREST still executes queries using the
-- anon role at the privilege-check layer; without SELECT on the table PostgreSQL returns permission
-- denied / REST 403 even for signed-in clients (JWT elevation applies after relation ACL checks).
-- Restore SELECT for anon and explicitly hide every row under RLS when role is anon.

grant select on table public.notifications to anon;

drop policy if exists "anon_no_notifications" on public.notifications;
create policy "anon_no_notifications"
  on public.notifications for select
  to anon
  using (false);
