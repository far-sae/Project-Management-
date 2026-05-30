-- 115_activities_meetings_calls.sql
--
-- Adds dedicated Meeting + Call tables for the Zoho-style Activities hub.
-- Tasks already exist (client_tasks, migration 045) — extend with a few
-- Zoho fields (priority, repeat_rule) so the same Activities surface can
-- create/list/filter them alongside meetings and calls.
--
-- Why dedicated tables instead of overloading client_notes:
--   • Meetings have a participants list (jsonb of contacts + invited
--     external emails), a host, optional location, all-day flag, and a
--     status lifecycle (scheduled → held/cancelled/no-show). client_notes
--     has none of these and bolting them on would break the deal-side
--     Meetings UI that ships today.
--   • Calls have call-type (inbound/outbound/missed/scheduled),
--     duration, outcome, and start time — semantically different from a
--     free-text note.
--   • Cleaner reporting downstream (no `where kind = 'meeting' and ...`
--     boilerplate across every query).
--
-- All three surfaces (meetings, calls, client_tasks) are read together
-- by the activities aggregator in src/services/supabase/activities.ts.

set search_path = public;

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
  meeting_id        uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid,

  title             text not null,
  location          text,
  all_day           boolean not null default false,
  start_at          timestamptz not null,
  end_at            timestamptz not null,

  -- Host = the org user running the meeting. Stored both as id (for
  -- joins / RLS) and snapshot name (so removing a user from the org
  -- doesn't blank out historical meetings).
  host_user_id      uuid,
  host_name         text,

  -- What the meeting is about. Polymorphic — exactly one of {client, deal,
  -- lead, contact} is typical but we don't enforce that so "general"
  -- meetings without a relationship are allowed (Zoho behaviour).
  related_to_type   text,        -- 'client' | 'deal' | 'lead' | 'contact' | null
  related_to_id     uuid,
  client_id         uuid references public.clients(client_id) on delete set null,
  deal_id           uuid references public.deals(deal_id)     on delete set null,

  -- Participants is an array of objects:
  --   [{ "kind": "contact"|"user"|"email", "id": uuid|null, "name": text, "email": text|null }, ...]
  -- Stored as jsonb so we can attach external invitees by email without
  -- needing them to be CRM contacts first.
  participants      jsonb not null default '[]'::jsonb,

  description       text,
  status            text not null default 'scheduled',  -- scheduled | held | cancelled | no_show
  send_invites      boolean not null default false,     -- did the user ask to email invites?

  google_meet_link  text,
  google_event_id   text,

  created_at        timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text,
  updated_at        timestamptz not null default now(),

  check (status in ('scheduled','held','cancelled','no_show')),
  check (related_to_type is null or related_to_type in ('client','deal','lead','contact','account')),
  check (end_at >= start_at)
);

create index if not exists idx_meetings_org_start
  on public.meetings (organization_id, start_at desc);
create index if not exists idx_meetings_host
  on public.meetings (host_user_id, start_at desc);
create index if not exists idx_meetings_client
  on public.meetings (client_id);
create index if not exists idx_meetings_deal
  on public.meetings (deal_id);
-- "Show me upcoming meetings I'm hosting" — partial index keeps it cheap.
create index if not exists idx_meetings_upcoming
  on public.meetings (organization_id, start_at)
  where status = 'scheduled';

alter table public.meetings enable row level security;

grant select on table public.meetings to anon;
grant select, insert, update, delete on table public.meetings to authenticated;

drop policy if exists "anon_no_meetings"           on public.meetings;
drop policy if exists "members_view_meetings"      on public.meetings;
drop policy if exists "members_create_meetings"    on public.meetings;
drop policy if exists "host_or_admin_update"       on public.meetings;
drop policy if exists "host_or_admin_delete"       on public.meetings;

create policy "anon_no_meetings"
  on public.meetings for select to anon using (false);

create policy "members_view_meetings"
  on public.meetings for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_create_meetings"
  on public.meetings for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by is null or created_by = auth.uid())
  );

-- Host can edit their own meeting (reschedule, change participants,
-- mark held/cancelled). Admin can edit any.
create policy "host_or_admin_update"
  on public.meetings for update to authenticated
  using (
    host_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  )
  with check (
    host_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );

create policy "host_or_admin_delete"
  on public.meetings for delete to authenticated
  using (
    host_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );


-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  call_id           uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  workspace_id      uuid,

  subject           text not null,
  -- Direction + outcome — Zoho's "Call Type":
  --   inbound, outbound  → completed-direction
  --   scheduled          → planned, not yet placed
  --   missed             → inbound that wasn't answered
  call_type         text not null default 'outbound',
  call_status       text not null default 'scheduled',
  -- When the call actually happened (or is planned for).
  call_start_at     timestamptz,
  call_duration_seconds int,

  caller_user_id    uuid,
  caller_name       text,

  -- Same polymorphic relationship as meetings.
  related_to_type   text,
  related_to_id     uuid,
  client_id         uuid references public.clients(client_id) on delete set null,
  deal_id           uuid references public.deals(deal_id)     on delete set null,
  -- Direct contact reference for inbound calls that aren't tied to a deal yet.
  contact_phone     text,
  contact_name      text,

  description       text,
  outcome           text,  -- free-text "what was discussed / next step"

  created_at        timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text,
  updated_at        timestamptz not null default now(),

  check (call_type in ('inbound','outbound','missed','scheduled','cancelled')),
  check (call_status in ('scheduled','completed','missed','cancelled')),
  check (related_to_type is null or related_to_type in ('client','deal','lead','contact','account'))
);

create index if not exists idx_calls_org_start
  on public.calls (organization_id, call_start_at desc nulls last);
create index if not exists idx_calls_caller
  on public.calls (caller_user_id, call_start_at desc nulls last);
create index if not exists idx_calls_client
  on public.calls (client_id);
create index if not exists idx_calls_deal
  on public.calls (deal_id);

alter table public.calls enable row level security;

grant select on table public.calls to anon;
grant select, insert, update, delete on table public.calls to authenticated;

drop policy if exists "anon_no_calls"           on public.calls;
drop policy if exists "members_view_calls"      on public.calls;
drop policy if exists "members_create_calls"    on public.calls;
drop policy if exists "caller_or_admin_update"  on public.calls;
drop policy if exists "caller_or_admin_delete"  on public.calls;

create policy "anon_no_calls"
  on public.calls for select to anon using (false);

create policy "members_view_calls"
  on public.calls for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members_create_calls"
  on public.calls for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and (created_by is null or created_by = auth.uid())
  );

create policy "caller_or_admin_update"
  on public.calls for update to authenticated
  using (
    caller_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  )
  with check (
    caller_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );

create policy "caller_or_admin_delete"
  on public.calls for delete to authenticated
  using (
    caller_user_id = auth.uid()
    or created_by = auth.uid()
    or public.is_org_admin_or_owner(organization_id)
  );


-- ---------------------------------------------------------------------------
-- client_tasks: add the Zoho-style fields the Activities Create Task modal
-- needs, but keep the existing columns intact so the deal-side task UI
-- keeps working unchanged.
-- ---------------------------------------------------------------------------
alter table public.client_tasks
  add column if not exists priority   text not null default 'normal',
  add column if not exists repeat_rule text;

-- 'high' | 'normal' | 'low' — narrow enum via check so the kanban + list
-- view can rely on a stable vocabulary. Existing rows default to 'normal'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_tasks_priority_check'
  ) then
    alter table public.client_tasks
      add constraint client_tasks_priority_check
      check (priority in ('high','normal','low'));
  end if;
end $$;

create index if not exists idx_client_tasks_priority
  on public.client_tasks (organization_id, priority, due_at)
  where status = 'pending';


-- ---------------------------------------------------------------------------
-- Updated-at triggers — keep updated_at fresh on every UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_meetings_touch on public.meetings;
create trigger trg_meetings_touch
  before update on public.meetings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_calls_touch on public.calls;
create trigger trg_calls_touch
  before update on public.calls
  for each row execute function public.touch_updated_at();
