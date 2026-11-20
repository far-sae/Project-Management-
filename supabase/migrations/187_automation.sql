-- ============================================================================
-- 187: CRM automation (the agents that carry a new lead to a running project).
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the Automation tab answers "run supabase/migrations/187_automation.sql".
--
-- What it adds, in plain words:
--   * Nine tables, all prefixed auto_:
--       auto_rules        one row per workspace: on or off, how much the agents
--                         may do alone, the monthly AI budget, the email limits
--                         and the project a won deal becomes.
--       auto_agents       the agents of a workspace (its six starting ones and
--                         any it made), each with one job and a list of rights.
--       auto_automations  a chain of agents that starts when a lead is added.
--       auto_runs         one lead going through one chain.
--       auto_run_steps    what each agent received, decided and did in a run.
--       auto_approvals    every action that waited for a person, and every
--                         email the agents sent or are about to send.
--       auto_events       what happened in the CRM that a run may be waiting
--                         for (a lead added, a status changed, a call logged).
--       auto_usage        the tokens and the cost of every AI call.
--       auto_marks        a short-lived note the server leaves just before it
--                         changes a lead or a deal itself (see "own writes").
--   * Three triggers on the CRM tables (crm_contacts, crm_deals and
--     crm_activities) that fill auto_events, so every way a lead or deal
--     changes is seen: the app, an import, anything else. They are AFTER
--     triggers, they only add a row to auto_events, they write only when the
--     row's workspace has automation switched on, and every error inside them
--     is caught: a trigger here can never make a CRM write fail.
--   * Own writes: when the automation server itself changes a lead's status or
--     a deal, it first leaves a row in auto_marks for that lead or deal. The
--     trigger finds it, records the event as the server's own and removes the
--     mark, so the agents never mistake their own change for a person's and
--     start a loop. An activity the server logs carries metadata.automation =
--     true and produces no event at all.
--   * One small function, auto_spent_micro_usd, that adds up a workspace's AI
--     spend in the database (for the monthly budget), for the server only.
--
-- Who can read and write: row level security is ON for every table with NO
-- policy, and all access is revoked from the browser roles. Only the server
-- (the service role, api/automation.ts) touches them.
--
-- It changes no existing table and no existing row. The tables hang off the
-- workspace: deleting a workspace deletes its automation; deleting a lead
-- deletes that lead's runs.
-- ============================================================================

set search_path = public;

-- ── The rules of one workspace ──────────────────────────────────────────────
create table if not exists public.auto_rules (
  workspace_id uuid primary key references public.workspaces (workspace_id) on delete cascade,
  organization_id uuid not null,
  enabled boolean not null default true,
  autonomy text not null default 'ask_external' check (autonomy in ('suggest', 'ask_external', 'full')),
  monthly_budget_cents integer not null default 2000 check (monthly_budget_cents between 0 and 10000000),
  emails_per_lead integer not null default 3 check (emails_per_lead between 0 and 10),
  send_window jsonb not null default '{}'::jsonb,
  web_research boolean not null default true,
  project jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  -- The month (YYYY-MM) the owners were last told the budget was reached, so they are told once.
  budget_notified_month text not null default '',
  -- When "process now" was last pressed, so it runs at most once a minute.
  nudged_at timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Agents ──────────────────────────────────────────────────────────────────
create table if not exists public.auto_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  kind text not null default 'custom' check (kind in ('researcher', 'qualifier', 'writer', 'chaser', 'deal_keeper', 'project_starter', 'custom')),
  name text not null check (char_length(name) between 1 and 60),
  job text not null check (char_length(job) between 1 and 2000),
  rights jsonb not null default '[]'::jsonb,
  ask_first boolean not null default false,
  paused boolean not null default false,
  archived boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists auto_agents_workspace on public.auto_agents (workspace_id, created_at);
-- A workspace has each of the six starting agents once, so pressing "Set up" twice never doubles them.
create unique index if not exists auto_agents_one_per_kind on public.auto_agents (workspace_id, kind) where kind <> 'custom';

-- ── Automations (chains) ────────────────────────────────────────────────────
create table if not exists public.auto_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'on', 'paused')),
  trigger jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists auto_automations_workspace on public.auto_automations (workspace_id, created_at);
-- A workspace's automations have different names.
create unique index if not exists auto_automations_name on public.auto_automations (workspace_id, lower(name));

-- ── Runs: one lead going through one chain ──────────────────────────────────
-- steps is the chain as it was when the run started, so editing the chain
-- never changes a run that is under way. locked_until is the claim: a worker
-- takes a run by moving it into the future, so two cron calls never work the
-- same run.
create table if not exists public.auto_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  automation_id uuid not null references public.auto_automations (id) on delete cascade,
  automation_name text not null default '',
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  deal_id uuid references public.crm_deals (id) on delete set null,
  project_id uuid references public.projects (project_id) on delete set null,
  subject text not null default '',
  status text not null default 'running' check (status in ('running', 'waiting', 'needs_approval', 'finished', 'stopped', 'failed')),
  result text not null default '',
  steps jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  waiting_on text check (waiting_on in ('time', 'reply', 'deal_won', 'agent', 'budget', 'send_window')),
  waiting_for text,
  wake_at timestamptz,
  handoff text not null default '',
  step_done_at timestamptz,
  replied_at timestamptz,
  reply_positive boolean,
  reply_note text not null default '',
  reply_seen_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- Nobody holds the run while this is in the past (it starts at the epoch).
  locked_until timestamptz not null default 'epoch',
  emails_sent integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists auto_runs_one_per_lead on public.auto_runs (automation_id, contact_id);
create index if not exists auto_runs_workspace on public.auto_runs (workspace_id, started_at desc);
create index if not exists auto_runs_contact on public.auto_runs (workspace_id, contact_id);
create index if not exists auto_runs_due on public.auto_runs (wake_at) where wake_at is not null and status in ('running', 'waiting');

-- ── What each agent received, decided and did ───────────────────────────────
-- plan is the list of actions the agent proposed, each with the server's
-- verdict (done now, waiting for a person, or dropped and why) and its state.
create table if not exists public.auto_run_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  run_id uuid not null references public.auto_runs (id) on delete cascade,
  n integer not null check (n >= 1),
  agent_id uuid,
  agent_name text not null default '',
  status text not null default 'working' check (status in ('working', 'done', 'waiting_approval', 'rejected', 'skipped', 'failed')),
  received text not null default '',
  decided text not null default '',
  outcome text not null default 'continue' check (outcome in ('continue', 'stop')),
  handoff text not null default '',
  plan jsonb not null default '[]'::jsonb,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists auto_run_steps_one_per_step on public.auto_run_steps (run_id, n);
create index if not exists auto_run_steps_agent on public.auto_run_steps (workspace_id, agent_id, created_at);

-- ── Approvals, and the ledger of emails ─────────────────────────────────────
-- state: pending (waits for a person), queued (approved or automatic, waits
-- for the send window), working (being carried out: the claim that makes an
-- approval happen at most once), done, rejected, failed.
create table if not exists public.auto_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  run_id uuid not null references public.auto_runs (id) on delete cascade,
  step_id uuid not null references public.auto_run_steps (id) on delete cascade,
  step_n integer not null default 1,
  plan_index integer not null default 0,
  agent_id uuid,
  agent_name text not null default '',
  contact_id uuid not null,
  deal_id uuid,
  action_type text not null,
  what text not null default '',
  about text not null default '',
  action jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check (state in ('pending', 'queued', 'working', 'done', 'rejected', 'failed')),
  -- True when a person had to decide it; false for an action the rules let through.
  asked boolean not null default true,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  reason text,
  due_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists auto_approvals_workspace on public.auto_approvals (workspace_id, state, created_at);
create index if not exists auto_approvals_run on public.auto_approvals (run_id);
create index if not exists auto_approvals_emails on public.auto_approvals (workspace_id, contact_id, action_type);
create index if not exists auto_approvals_due on public.auto_approvals (due_at) where state = 'queued';

-- ── What happened in the CRM ────────────────────────────────────────────────
-- Filled by the triggers below. No foreign key to the CRM on purpose: a row
-- here can never stand in the way of changing or deleting a lead or a deal.
create table if not exists public.auto_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  type text not null check (type in ('lead_created', 'lead_status_changed', 'deal_created', 'deal_changed', 'activity_logged')),
  contact_id uuid,
  deal_id uuid,
  payload jsonb not null default '{}'::jsonb,
  -- True when the automation server made the change itself: never acted on.
  own boolean not null default false,
  attempts integer not null default 0,
  locked_until timestamptz not null default 'epoch',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auto_events_open on public.auto_events (created_at) where processed_at is null;
create index if not exists auto_events_workspace on public.auto_events (workspace_id, created_at);

-- ── The cost of every AI call ───────────────────────────────────────────────
create table if not exists public.auto_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  run_id uuid,
  agent_id uuid,
  user_id uuid,
  feature text not null check (feature in ('step', 'web', 'assistant', 'test')),
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  web_searches integer not null default 0,
  -- Millionths of a US dollar, so sums stay whole numbers.
  cost_micro_usd bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists auto_usage_workspace on public.auto_usage (workspace_id, created_at);
create index if not exists auto_usage_run on public.auto_usage (run_id) where run_id is not null;

-- ── The server's own writes ─────────────────────────────────────────────────
create table if not exists public.auto_marks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  entity_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auto_marks_entity on public.auto_marks (entity_id);

-- The AI spend of a workspace since a moment (or of one run), in millionths of
-- a dollar: summed in the database, so a busy month is not cut off at a page of rows.
create or replace function public.auto_spent_micro_usd(p_workspace uuid, p_since timestamptz, p_run uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(u.cost_micro_usd), 0)::bigint
  from public.auto_usage u
  where u.workspace_id = p_workspace
    and (p_since is null or u.created_at >= p_since)
    and (p_run is null or u.run_id = p_run);
$$;
revoke all on function public.auto_spent_micro_usd(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.auto_spent_micro_usd(uuid, timestamptz, uuid) to service_role;

alter table public.auto_rules enable row level security;
alter table public.auto_agents enable row level security;
alter table public.auto_automations enable row level security;
alter table public.auto_runs enable row level security;
alter table public.auto_run_steps enable row level security;
alter table public.auto_approvals enable row level security;
alter table public.auto_events enable row level security;
alter table public.auto_usage enable row level security;
alter table public.auto_marks enable row level security;

revoke all on
  public.auto_rules, public.auto_agents, public.auto_automations, public.auto_runs, public.auto_run_steps,
  public.auto_approvals, public.auto_events, public.auto_usage, public.auto_marks
  from public, anon, authenticated;
grant all on
  public.auto_rules, public.auto_agents, public.auto_automations, public.auto_runs, public.auto_run_steps,
  public.auto_approvals, public.auto_events, public.auto_usage, public.auto_marks
  to service_role;

-- ── The CRM triggers ────────────────────────────────────────────────────────
-- Each function does its whole work inside one block that catches every error,
-- and returns null (ignored for an AFTER trigger): the CRM row is already
-- written and nothing here can undo or refuse it.

-- A lead was added, or its status changed.
create or replace function public.auto_note_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_own boolean := false;
begin
  begin
    if new.workspace_id is null then
      return null;
    end if;
    if not exists (
      select 1 from public.auto_rules r
      where r.workspace_id = new.workspace_id and r.enabled
    ) then
      return null;
    end if;
    if tg_op = 'INSERT' then
      insert into public.auto_events (workspace_id, type, contact_id, payload)
      values (
        new.workspace_id, 'lead_created', new.id,
        jsonb_build_object('source', new.source, 'lifecycle_stage', new.lifecycle_stage::text, 'lead_status', new.lead_status::text)
      );
    elsif new.lead_status is distinct from old.lead_status then
      with gone as (
        delete from public.auto_marks m
        where m.entity_id = new.id and m.expires_at > now()
        returning 1
      )
      select exists (select 1 from gone) into v_own;
      insert into public.auto_events (workspace_id, type, contact_id, payload, own, processed_at)
      values (
        new.workspace_id, 'lead_status_changed', new.id,
        jsonb_build_object('old', old.lead_status::text, 'new', new.lead_status::text),
        v_own, case when v_own then now() end
      );
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

-- A deal was added, or its stage or status changed.
create or replace function public.auto_note_deal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_own boolean := false;
begin
  begin
    if new.workspace_id is null then
      return null;
    end if;
    if not exists (
      select 1 from public.auto_rules r
      where r.workspace_id = new.workspace_id and r.enabled
    ) then
      return null;
    end if;
    -- "old" is only looked at for an update: on an insert there is no old row to read.
    if tg_op = 'UPDATE' then
      if new.stage_id is not distinct from old.stage_id and new.status is not distinct from old.status then
        return null;
      end if;
    end if;
    with gone as (
      delete from public.auto_marks m
      where m.entity_id = new.id and m.expires_at > now()
      returning 1
    )
    select exists (select 1 from gone) into v_own;
    if tg_op = 'INSERT' then
      insert into public.auto_events (workspace_id, type, contact_id, deal_id, payload, own, processed_at)
      values (
        new.workspace_id, 'deal_created', new.contact_id, new.id,
        jsonb_build_object('status', new.status::text),
        v_own, case when v_own then now() end
      );
    else
      insert into public.auto_events (workspace_id, type, contact_id, deal_id, payload, own, processed_at)
      values (
        new.workspace_id, 'deal_changed', new.contact_id, new.id,
        jsonb_build_object('old_status', old.status::text, 'new_status', new.status::text, 'stage_changed', new.stage_id is distinct from old.stage_id),
        v_own, case when v_own then now() end
      );
    end if;
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

-- A person logged a call, an email or a meeting on a lead.
create or replace function public.auto_note_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.workspace_id is null or new.contact_id is null then
      return null;
    end if;
    if new.type not in ('call', 'email', 'meeting') then
      return null;
    end if;
    if coalesce(new.metadata ->> 'automation', '') = 'true' then
      return null;
    end if;
    if not exists (
      select 1 from public.auto_rules r
      where r.workspace_id = new.workspace_id and r.enabled
    ) then
      return null;
    end if;
    insert into public.auto_events (workspace_id, type, contact_id, deal_id, payload)
    values (
      new.workspace_id, 'activity_logged', new.contact_id, new.deal_id,
      jsonb_build_object('activity_type', new.type::text, 'description', left(coalesce(new.description, ''), 500))
    );
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function public.auto_note_contact() from public, anon, authenticated;
revoke all on function public.auto_note_deal() from public, anon, authenticated;
revoke all on function public.auto_note_activity() from public, anon, authenticated;

drop trigger if exists auto_crm_contacts on public.crm_contacts;
create trigger auto_crm_contacts
  after insert or update of lead_status on public.crm_contacts
  for each row execute function public.auto_note_contact();

drop trigger if exists auto_crm_deals on public.crm_deals;
create trigger auto_crm_deals
  after insert or update of stage_id, status on public.crm_deals
  for each row execute function public.auto_note_deal();

drop trigger if exists auto_crm_activities on public.crm_activities;
create trigger auto_crm_activities
  after insert on public.crm_activities
  for each row execute function public.auto_note_activity();

notify pgrst, 'reload schema';
