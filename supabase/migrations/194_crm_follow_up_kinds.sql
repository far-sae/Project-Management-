-- Follow-ups: what kind of thing each one is (to-do, call, email, meeting), and
-- follow-ups that repeat (every day, week or month).
--
-- Only two columns are added to public.crm_tasks. Follow-ups that exist already
-- become plain to-dos that do not repeat, which is what they were.
--
-- Safe to run more than once.

alter table public.crm_tasks add column if not exists kind text not null default 'todo';
alter table public.crm_tasks add column if not exists repeat_every text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_kind_check') then
    alter table public.crm_tasks
      add constraint crm_tasks_kind_check check (kind in ('todo', 'call', 'email', 'meeting'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tasks_repeat_every_check') then
    alter table public.crm_tasks
      add constraint crm_tasks_repeat_every_check
      check (repeat_every is null or repeat_every in ('daily', 'weekly', 'monthly'));
  end if;
end $$;

comment on column public.crm_tasks.kind is 'What the follow-up is: todo, call, email or meeting.';
comment on column public.crm_tasks.repeat_every is 'daily, weekly or monthly: when it is completed the next one is made. Null = does not repeat.';

-- Tell the API about the new columns straight away.
notify pgrst, 'reload schema';
