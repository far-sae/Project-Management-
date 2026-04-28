-- Reliable cross-user notification creation.
--
-- Problem:
--   The "Authenticated users can insert notifications" RLS policy in 001_notifications_table.sql
--   uses `with check (true)`, but many production deployments tightened it to
--   `with check (auth.uid() = user_id)` for safety, which silently breaks the bell + email
--   pipeline — the actor can only insert notifications for themselves, so assignees /
--   collaborators receive nothing. Symptom: "I only see my own self-assignment alerts".
--
-- Fix:
--   Expose a SECURITY DEFINER RPC that any authenticated user can call to create a
--   notification for any user. The function validates the input, scopes search_path, and
--   never returns the lock_pin_hash or anything sensitive. RLS for SELECT/UPDATE/DELETE
--   stays as before — recipients can only read their own rows.

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

comment on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) is
  'Create a notification on behalf of the authenticated user for any recipient. Bypasses INSERT RLS so cross-user assignment / due-soon / overdue / comment alerts always reach assignees, even when the notifications table has a strict per-user insert policy.';

revoke all on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) from public;
grant execute on function public.create_notification_v1(uuid, text, text, text, uuid, uuid, uuid, text) to authenticated;
