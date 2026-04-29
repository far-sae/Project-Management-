-- Fix REST 403 on GET /rest/v1/notifications and 404 on POST /rest/v1/rpc/create_notification_v1
-- when earlier migrations ran in order 029 → 030.
--
-- Background: 029_notifications_anon_select_grant.sql grants SELECT on notifications to `anon` so
-- PostgREST can pass relation ACL checks before JWT role elevation (Supabase/PostgREST behavior).
-- 030_notifications_grants_and_policies.sql then runs `revoke all on notifications from anon`,
-- which removes that grant and brings back 403 for signed-in clients.
--
-- This migration restores the anon SELECT ACL (rows remain invisible: RLS policy uses false for anon)
-- and ensures create_notification_v1 exists (028_create_notification_rpc.sql may never have been applied).

-- ── PostgREST: anon must hold SELECT privilege; RLS blocks every row for anon ───────────────
grant select on table public.notifications to anon;

drop policy if exists "anon_no_notifications" on public.notifications;
create policy "anon_no_notifications"
  on public.notifications for select
  to anon
  using (false);

-- ── RPC: cross-user notification inserts (same as 028) ─────────────────────────────────────
create or replace function public.create_notification_v1(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_task_id uuid default null,
  p_project_id uuid default null,
  p_actor_user_id uuid default null,
  p_actor_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_allowed_types text[] := array[
    'task_created', 'task_assigned', 'task_updated', 'task_completed',
    'comment_mention', 'comment_added', 'project_invite', 'subscription_renewed',
    'task_reminder', 'task_overdue', 'project_chat_message'
  ];
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if p_user_id is null or p_type is null or p_title is null or p_message is null then
    raise exception 'missing required field' using errcode = '23502';
  end if;
  if p_type <> all (v_allowed_types) then
    raise exception 'unknown notification type: %', p_type using errcode = '22023';
  end if;

  insert into public.notifications (
    notification_id, user_id, type, title, message,
    task_id, project_id, actor_user_id, actor_display_name,
    read, link, created_at
  ) values (
    v_id, p_user_id, p_type, p_title, p_message,
    p_task_id, p_project_id,
    coalesce(p_actor_user_id, auth.uid()),
    p_actor_display_name,
    false, null, v_now
  );

  return jsonb_build_object(
    'notification_id', v_id,
    'user_id', p_user_id,
    'type', p_type,
    'title', p_title,
    'message', p_message,
    'task_id', p_task_id,
    'project_id', p_project_id,
    'actor_user_id', coalesce(p_actor_user_id, auth.uid()),
    'actor_display_name', p_actor_display_name,
    'read', false,
    'link', null,
    'created_at', v_now
  );
end;
$fn$;

revoke all on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) from public;
grant execute on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) to authenticated;

comment on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) is
  'Create a notification for any recipient (SECURITY DEFINER). Rest applied via migration 032.';
