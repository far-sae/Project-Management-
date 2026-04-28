-- Atomic overdue notifications: one insert per assignee per UTC day, server-side (no client read-then-insert races).

create unique index if not exists idx_notifications_task_overdue_daily
  on public.notifications (
    user_id,
    task_id,
    ((created_at at time zone 'utc')::date)
  )
  where type = 'task_overdue';

create or replace function public.notify_task_overdue(p_task_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_task record;
  v_elem record;
  v_title text;
  v_project_id uuid;
  v_project_name text;
  v_due timestamptz;
  v_status text;
  v_overdue_days integer;
  v_day_word text;
  v_notif_title text;
  v_notif_msg text;
  v_uid text;
  v_row jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select
    t.title,
    t.project_id,
    t.due_date,
    t.status,
    t.assignees,
    coalesce(p.name, 'Project') as project_name
  into v_task
  from public.tasks t
  left join public.projects p on p.project_id = t.project_id
  where t.task_id = p_task_id;

  if not found then
    return '[]'::jsonb;
  end if;

  v_title := v_task.title;
  v_project_id := v_task.project_id;
  v_project_name := v_task.project_name;
  v_due := v_task.due_date;
  v_status := v_task.status;

  if v_status = 'done' or v_due is null or v_due >= now() then
    return '[]'::jsonb;
  end if;

  v_overdue_days := greatest(1, floor(extract(epoch from (now() - v_due)) / 86400.0)::integer);
  v_day_word := case when v_overdue_days = 1 then 'day' else 'days' end;
  v_notif_title := case
    when v_overdue_days = 1 then 'Task is overdue'
    else format('Task is %s %s overdue', v_overdue_days, v_day_word)
  end;
  v_notif_msg := format(
    '"%s" in %s was due %s %s ago and isn''t done yet',
    v_title,
    v_project_name,
    v_overdue_days,
    v_day_word
  );

  for v_elem in
    select * from jsonb_array_elements(coalesce(v_task.assignees, '[]'::jsonb))
  loop
    v_uid := coalesce(v_elem.value->>'userId', v_elem.value->>'user_id');
    if v_uid is null or btrim(v_uid) = '' then
      continue;
    end if;

    if coalesce(public.get_notification_preferences(v_uid::uuid)->>'projectUpdates', 'true') = 'false' then
      continue;
    end if;

    v_row := null;
    insert into public.notifications (
      notification_id,
      user_id,
      type,
      title,
      message,
      task_id,
      project_id,
      read,
      created_at
    )
    values (
      gen_random_uuid(),
      v_uid::uuid,
      'task_overdue',
      v_notif_title,
      v_notif_msg,
      p_task_id,
      v_project_id,
      false,
      now()
    )
    on conflict (user_id, task_id, ((created_at at time zone 'utc')::date))
      where type = 'task_overdue'
    do nothing
    returning jsonb_build_object(
      'user_id', user_id::text,
      'notification_id', notification_id::text,
      'title', title,
      'message', message,
      'project_id', project_id::text,
      'task_id', task_id::text
    )
    into v_row;

    if v_row is not null then
      v_result := v_result || jsonb_build_array(v_row);
    end if;
  end loop;

  return v_result;
end;
$fn$;

comment on function public.notify_task_overdue(uuid) is
  'Creates at most one task_overdue notification per assignee per UTC day; respects projectUpdates pref.';

revoke all on function public.notify_task_overdue(uuid) from public;
grant execute on function public.notify_task_overdue(uuid) to authenticated;
grant execute on function public.notify_task_overdue(uuid) to service_role;
