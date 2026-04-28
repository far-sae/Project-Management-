-- Ensure the browser client (authenticated JWT) can read/write notifications under RLS.
-- Fixes REST 403 on GET /notifications when table privileges were missing or policies applied ambiguously.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.notifications to authenticated;

-- Default Supabase templates sometimes grant anon broad table access; notifications should be login-only.
revoke all on table public.notifications from anon;

-- Replace policies with authenticated-only rules and stable auth.uid() evaluation (Supabase RLS guidance).
drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications (mark read)" on public.notifications;
drop policy if exists "Authenticated users can insert notifications" on public.notifications;
drop policy if exists "Users can delete own notifications" on public.notifications;

create policy "Users can read own notifications"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can update own notifications (mark read)"
  on public.notifications for update
  to authenticated
  using ((select auth.uid()) = user_id);

-- Assignees receive rows where user_id may differ from the actor; keep permissive insert for authenticated clients + create_notification_v1 RPC (SECURITY DEFINER).
create policy "Authenticated users can insert notifications"
  on public.notifications for insert
  to authenticated
  with check (true);

create policy "Users can delete own notifications"
  on public.notifications for delete
  to authenticated
  using ((select auth.uid()) = user_id);
