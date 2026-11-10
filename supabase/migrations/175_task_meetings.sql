-- TaskCalendar meetings on tasks (replaces "Add Google Meet").
--
--   • tasks.meeting_starts_at / meeting_duration_minutes — a task's meeting.
--     People join it in the app (its own call room inside the project,
--     `project:<projectId>:task:<taskId>`), guests by invite link.
--   • generate_task_meeting_reminders() (every 5 min): ~15 minutes before
--     the meeting, notify (and so email) the task's assignees and creator.
--   • claim_notification_emails() now also returns the meeting time so
--     task emails can show it, and holds "Task updated" emails for 90 s so
--     rapid edits (auto-save) collapse into one email.

set search_path = public;

alter table public.tasks
  add column if not exists meeting_starts_at timestamptz,
  add column if not exists meeting_duration_minutes integer
    check (meeting_duration_minutes is null or meeting_duration_minutes between 5 and 480);

create index if not exists tasks_meeting_starts_at_idx
  on public.tasks (meeting_starts_at)
  where meeting_starts_at is not null;

-- A newer "Task updated" for the same person and task replaces any older one
-- still waiting to be emailed (see the 90 s wait in claim_notification_emails).
create or replace function public.notifications_enqueue_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type in ('task_assigned', 'task_updated', 'task_completed', 'task_reminder',
                  'task_overdue', 'comment_mention', 'comment_added')
     and (new.actor_user_id is null or new.actor_user_id <> new.user_id) then
    if new.type = 'task_updated' and new.task_id is not null then
      update public.notification_email_outbox o
        set status = 'skipped', last_error = 'superseded by a newer update'
        from public.notifications n
        where n.notification_id = o.notification_id
          and o.status = 'pending'
          and n.user_id = new.user_id
          and n.task_id = new.task_id
          and n.type = 'task_updated'
          and n.notification_id <> new.notification_id;
    end if;
    insert into public.notification_email_outbox (notification_id)
    values (new.notification_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Return type changes, so drop and recreate.
drop function if exists public.claim_notification_emails(integer);

-- Claim a batch of emails to send, with everything the email shows.
create or replace function public.claim_notification_emails(p_limit integer default 50)
returns table (
  notification_id uuid,
  type text,
  title text,
  message text,
  task_id uuid,
  project_id uuid,
  recipient_email text,
  recipient_name text,
  prefs jsonb,
  timezone text,
  task_title text,
  task_due_date timestamptz,
  task_priority text,
  task_urgent boolean,
  task_status_label text,
  project_name text,
  task_meeting_at timestamptz,
  task_meeting_minutes integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select o.notification_id
    from public.notification_email_outbox o
    join public.notifications nn on nn.notification_id = o.notification_id
    where (
         o.status = 'pending'
         or (o.status = 'failed' and o.attempts < 5 and o.claimed_at < now() - interval '5 minutes')
         or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
      )
      -- "Task updated" waits 90 s so a burst of edits (the task form
      -- auto-saves) becomes one email about the latest state.
      and (nn.type <> 'task_updated' or o.created_at < now() - interval '90 seconds')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update of o skip locked
  ),
  claimed as (
    update public.notification_email_outbox o
      set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from picked
      where o.notification_id = picked.notification_id
      returning o.notification_id
  )
  select
    n.notification_id,
    n.type,
    n.title,
    n.message,
    n.task_id,
    n.project_id,
    coalesce(nullif(trim(up.email), ''), u.email)::text,
    coalesce(nullif(trim(up.display_name), ''), split_part(u.email, '@', 1))::text,
    coalesce(up.notification_preferences, '{}'::jsonb),
    coalesce(nullif(trim(up.timezone), ''), 'UTC')::text,
    t.title,
    t.due_date,
    t.priority,
    coalesce(t.urgent, false),
    coalesce(
      (select c->>'title' from jsonb_array_elements(coalesce(p.columns, '[]'::jsonb)) c
        where c->>'id' = t.status limit 1),
      case t.status
        when 'undefined' then 'Undefined task'
        when 'todo' then 'To-do'
        when 'inprogress' then 'On-Progress'
        when 'done' then 'Done'
        when 'needreview' then 'Need review'
        else t.status
      end
    )::text,
    p.name,
    t.meeting_starts_at,
    t.meeting_duration_minutes
  from claimed cl
  join public.notifications n on n.notification_id = cl.notification_id
  left join auth.users u on u.id = n.user_id
  left join public.user_profiles up on up.id = n.user_id
  left join public.tasks t on t.task_id = n.task_id
  left join public.projects p on p.project_id = coalesce(n.project_id, t.project_id);
end;
$$;

revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;

create or replace function public.generate_task_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
  v_minutes integer;
begin
  for r in
    with people as (
      select t.task_id, t.title, t.project_id, t.meeting_starts_at, p.name as project_name,
             (a->>'userId')::uuid as user_id
      from public.tasks t
      join public.projects p on p.project_id = t.project_id
      cross join lateral jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) a
      where t.meeting_starts_at > now()
        and t.meeting_starts_at <= now() + interval '20 minutes'
        and coalesce(a->>'userId', '') ~ '^[0-9a-fA-F-]{36}$'
      union
      select t.task_id, t.title, t.project_id, t.meeting_starts_at, p.name, t.created_by
      from public.tasks t
      join public.projects p on p.project_id = t.project_id
      where t.meeting_starts_at > now()
        and t.meeting_starts_at <= now() + interval '20 minutes'
        and t.created_by is not null
    )
    select * from people
  loop
    insert into public.task_reminder_log (task_id, user_id, kind, due_date)
    values (r.task_id, r.user_id, 'meeting_soon', r.meeting_starts_at)
    on conflict do nothing;
    continue when not found;

    v_minutes := greatest(1, ceil(extract(epoch from (r.meeting_starts_at - now())) / 60)::integer);
    insert into public.notifications (user_id, type, title, message, task_id, project_id)
    values (
      r.user_id,
      'task_reminder',
      format('Meeting in %s minutes', v_minutes),
      format('The meeting for "%s" in %s starts in %s minutes. Open the task and press Join meeting.',
             r.title, r.project_name, v_minutes),
      r.task_id,
      r.project_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.generate_task_meeting_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'task-meeting-reminders';
select cron.schedule(
  'task-meeting-reminders',
  '*/5 * * * *',
  $$select public.generate_task_meeting_reminders();$$
);
