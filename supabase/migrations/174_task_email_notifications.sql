-- Task emails sent by the SERVER, plus due-date reminders that don't depend
-- on anyone opening the app.
--
-- Before: the browser of whoever made a change looked up the assignee's
-- email in user_profiles — which RLS only lets people read for THEMSELVES —
-- so assignment/urgent emails mostly never went out. Due-soon / overdue
-- reminders only ran when the assignee opened My Tasks.
--
-- Now:
--   • every new notification for someone else is queued in
--     notification_email_outbox (trigger on notifications);
--   • the `notification-emails` Edge Function (called every minute by
--     pg_cron while the queue has work) claims queued rows with
--     claim_notification_emails(), checks the person's email settings and
--     sends via Resend, then reports back with finish_notification_email();
--   • generate_task_due_reminders() (every 15 min) creates reminders for
--     each assignee in THEIR time zone, after 8am local:
--       3 days before · the day before · on the due day ·
--       1, 3 and 7 days overdue
--     each once per task/person/due date (task_reminder_log), so changing a
--     due date restarts the schedule.

set search_path = public;

-- ── Email queue ───────────────────────────────────────────────

create table if not exists public.notification_email_outbox (
  notification_id uuid primary key references public.notifications(notification_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_email_outbox_work_idx
  on public.notification_email_outbox (created_at)
  where status in ('pending', 'sending', 'failed');

alter table public.notification_email_outbox enable row level security;
-- No policies: only the service role (Edge Function) and definer functions touch it.

create or replace function public.notifications_enqueue_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never email people about their own actions; chat messages stay in-app.
  if new.type in ('task_assigned', 'task_updated', 'task_completed', 'task_reminder',
                  'task_overdue', 'comment_mention', 'comment_added')
     and (new.actor_user_id is null or new.actor_user_id <> new.user_id) then
    insert into public.notification_email_outbox (notification_id)
    values (new.notification_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_enqueue_email_trg on public.notifications;
create trigger notifications_enqueue_email_trg
  after insert on public.notifications
  for each row execute function public.notifications_enqueue_email();

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
  project_name text
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
    where o.status = 'pending'
       or (o.status = 'failed' and o.attempts < 5 and o.claimed_at < now() - interval '5 minutes')
       or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
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
    p.name
  from claimed cl
  join public.notifications n on n.notification_id = cl.notification_id
  left join auth.users u on u.id = n.user_id
  left join public.user_profiles up on up.id = n.user_id
  left join public.tasks t on t.task_id = n.task_id
  left join public.projects p on p.project_id = coalesce(n.project_id, t.project_id);
end;
$$;

create or replace function public.finish_notification_email(
  p_notification_id uuid,
  p_status text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_email_outbox
    set status = case when p_status in ('sent', 'skipped', 'failed') then p_status else 'failed' end,
        last_error = left(p_error, 500),
        sent_at = case when p_status = 'sent' then now() else sent_at end
    where notification_id = p_notification_id;
$$;

revoke all on function public.claim_notification_emails(integer) from public, anon, authenticated;
revoke all on function public.finish_notification_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
grant execute on function public.finish_notification_email(uuid, text, text) to service_role;

-- ── Due-date reminders ────────────────────────────────────────

create table if not exists public.task_reminder_log (
  task_id uuid not null references public.tasks(task_id) on delete cascade,
  user_id uuid not null,
  kind text not null,
  due_date timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id, kind, due_date)
);
alter table public.task_reminder_log enable row level security;

create or replace function public.generate_task_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_kind text;
  v_type text;
  v_title text;
  v_msg text;
  v_count integer := 0;
begin
  for r in
    with assignees as (
      select t.task_id, t.title, t.project_id, t.due_date, p.name as project_name,
             (a->>'userId')::uuid as user_id
      from public.tasks t
      join public.projects p on p.project_id = t.project_id
      cross join lateral jsonb_array_elements(coalesce(t.assignees, '[]'::jsonb)) a
      where t.due_date is not null
        and t.completed_at is null
        and coalesce(t.status, '') <> 'done'
        and t.due_date > now() - interval '8 days'
        and t.due_date < now() + interval '4 days'
        and coalesce(a->>'userId', '') ~ '^[0-9a-fA-F-]{36}$'
    )
    select a.*,
           coalesce(tz.name, 'UTC') as tz
    from assignees a
    left join public.user_profiles up on up.id = a.user_id
    left join pg_timezone_names tz on tz.name = nullif(trim(up.timezone), '')
  loop
    -- Local "today" and the due day in the assignee's own time zone; only
    -- send from 8am their time so reminders don't land in the middle of the night.
    continue when extract(hour from (now() at time zone r.tz)) < 8;

    v_kind := case ((r.due_date at time zone r.tz)::date - (now() at time zone r.tz)::date)
      when 3 then 'due_in_3_days'
      when 1 then 'due_tomorrow'
      when 0 then 'due_today'
      when -1 then 'overdue_1'
      when -3 then 'overdue_3'
      when -7 then 'overdue_7'
      else null
    end;
    continue when v_kind is null;

    insert into public.task_reminder_log (task_id, user_id, kind, due_date)
    values (r.task_id, r.user_id, v_kind, r.due_date)
    on conflict do nothing;
    continue when not found;

    v_type := case when v_kind like 'overdue%' then 'task_overdue' else 'task_reminder' end;
    v_title := case v_kind
      when 'due_in_3_days' then 'Due in 3 days'
      when 'due_tomorrow' then 'Due tomorrow'
      when 'due_today' then 'Due today'
      when 'overdue_1' then 'Overdue'
      when 'overdue_3' then 'Overdue by 3 days'
      else 'Overdue by a week'
    end;
    v_msg := case
      when v_type = 'task_overdue' then format('"%s" in %s is past its due date and not done yet.', r.title, r.project_name)
      else format('"%s" in %s is %s.', r.title, r.project_name, lower(v_title))
    end;

    insert into public.notifications (user_id, type, title, message, task_id, project_id)
    values (r.user_id, v_type, v_title, v_msg, r.task_id, r.project_id)
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.generate_task_due_reminders() from public, anon, authenticated;

-- ── Schedules ─────────────────────────────────────────────────

select cron.unschedule(jobid) from cron.job
  where jobname in ('task-due-reminders', 'notification-emails');

select cron.schedule(
  'task-due-reminders',
  '*/15 * * * *',
  $$select public.generate_task_due_reminders();$$
);

-- Wake the email sender only when there is something queued.
select cron.schedule(
  'notification-emails',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://cotrbcnouzcjdruiqmly.supabase.co/functions/v1/notification-emails',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  where exists (
    select 1 from public.notification_email_outbox
    where status = 'pending'
       or (status = 'failed' and attempts < 5)
       or (status = 'sending' and claimed_at < now() - interval '10 minutes')
  );
  $$
);
