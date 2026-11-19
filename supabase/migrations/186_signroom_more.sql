-- ============================================================================
-- 186 — Signroom, the rest: billing plans, Draft with AI usage, template
-- management, and sending from a workspace's own mailbox.
--
-- Run this AFTER 184_signroom.sql (it adds to the tables that file creates).
-- Until it is run, everything 184 gave keeps working: invoices, agreements and
-- email through the platform. Only the new parts answer "run
-- supabase/migrations/186_signroom_more.sql" until then.
--
-- What this file adds
--   1. sr_projects: a client's billing plan (the documents server calls it a
--      "project"): its billing type, fees, months and status. Plans are
--      archived, never deleted. And sr_invoices.project_id, so a Draft invoice
--      can be linked to a plan.
--   2. sr_ai_usage: one row per Draft with AI reply, with its token counts.
--   3. Agreement templates can now be renamed and deleted. 184 refused every
--      change to a template; from here only a template's name may change, and
--      a template may be deleted. An agreement made from a template holds its
--      own copy, so it is not affected.
--   4. sr_mailboxes: a workspace's own SMTP mailbox (one per workspace). The
--      password is kept encrypted by the server (v1:... ciphertext); the
--      database never sees the key or the password.
--   5. sr_email_oauth and sr_email_oauth_states: a workspace's Google or
--      Microsoft email connection (one per workspace) and its pending
--      sign-ins. The client secret and the tokens are kept in one encrypted
--      column. Of a pending sign-in only sha256 digests are stored, never the
--      values, and each row is used once and expires.
--
-- Who can do what
--   Exactly as in 184: every new table has row level security ON and NO
--   policy, and anon / authenticated have no grant at all. The only reader and
--   writer is the server, using the service role. The server checks the
--   caller's sign-in, workspace and role itself (the email connection is for
--   an organisation owner or admin only).
--
-- Deleting a Signroom workspace row removes its plans, usage rows, mailbox,
-- email connection and pending sign-ins with it.
--
-- Safe to run more than once: tables and indexes are "if not exists", the
-- column is "add column if not exists", the function is "create or replace",
-- and the grants can be repeated.
-- ============================================================================

-- ====================================================== 1. billing plans

create table if not exists public.sr_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  client_id uuid not null references public.sr_clients (id),
  created_by uuid references auth.users (id) on delete set null,
  name text not null check (char_length(name) between 1 and 160),
  billing_type text not null check (billing_type in ('One-off', 'Monthly', 'Custom')),
  billing_label text not null default '',
  currency text not null check (currency in ('GBP', 'USD', 'EUR', 'CAD', 'AUD', 'NZD', 'INR', 'AED')),
  monthly_fee_minor bigint not null default 0 check (monthly_fee_minor >= 0),
  contract_value_minor bigint not null default 0 check (contract_value_minor >= 0),
  annual_target_minor bigint not null default 0 check (annual_target_minor >= 0),
  start_month text not null check (start_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  end_month text not null default '' check (end_month = '' or end_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status text not null default 'Active' check (status in ('Active', 'On hold', 'Completed')),
  notes text not null default '',
  monthly_entries jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sr_projects_workspace on public.sr_projects (workspace_id);
create index if not exists sr_projects_client on public.sr_projects (client_id);

-- The plan a Draft invoice is linked to. No delete action on purpose: plans
-- are never deleted, and an issued invoice is frozen (184's sr_invoices_freeze
-- compares every column, so the link cannot change after issue either).
alter table public.sr_invoices add column if not exists project_id uuid references public.sr_projects (id);
create index if not exists sr_invoices_project on public.sr_invoices (project_id) where project_id is not null;

-- ===================================================== 2. Draft with AI usage

-- One row per reply from the AI model, written by the server. `model` is the
-- model that really answered; the counts are tokens.
create table if not exists public.sr_ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sr_ai_usage_workspace on public.sr_ai_usage (workspace_id, created_at desc);

-- ============================================ 3. templates: rename and delete

-- Replaces 184's rule ("Templates cannot change."). A template version's
-- content, fields and pages still never change; its name may, and a version
-- may be deleted. The trigger itself (sr_agreement_templates_immutable, before
-- update or delete) is the one 184 created and is left in place.
create or replace function public.sr_agreement_templates_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if (to_jsonb(new) - 'name') is distinct from (to_jsonb(old) - 'name') then
    raise exception 'Only the name of a template can change.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.sr_agreement_templates_immutable() from public, anon, authenticated;
grant execute on function public.sr_agreement_templates_immutable() to service_role;

-- ================================================= 4. a workspace's own mailbox

create table if not exists public.sr_mailboxes (
  workspace_id uuid primary key references public.sr_workspaces (id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook', 'ionos', 'yahoo', 'zoho', 'godaddy', 'hostinger', 'custom')),
  host text not null check (char_length(host) between 1 and 253 and host ~ '^[a-z0-9.-]+$'),
  port int not null check (port in (465, 587, 2525)),
  security text not null check (security in ('tls', 'starttls')),
  username text not null check (char_length(username) between 1 and 254),
  from_email text not null check (char_length(from_email) <= 254 and from_email ~ '^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$'),
  password_enc text not null check (password_enc ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'),
  verified_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  updated_at timestamptz not null default now()
);

-- ================================= 5. Google or Microsoft sign-in for email

create table if not exists public.sr_email_oauth (
  workspace_id uuid primary key references public.sr_workspaces (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  revision integer not null default 1 check (revision > 0),
  provider text not null check (provider in ('google', 'microsoft')),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  client_id text not null check (char_length(client_id) between 1 and 300),
  tenant text not null default '' check ((provider = 'google' and tenant = '') or (provider = 'microsoft' and tenant ~ '^[A-Za-z0-9.-]{1,100}$')),
  secrets_enc text not null check (secrets_enc like 'v1:%'),
  status text not null default 'configured' check (status in ('configured', 'authenticated', 'verified', 'reconnect')),
  verified_at timestamptz,
  last_test_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  challenge_digest text check (challenge_digest ~ '^[0-9a-f]{64}$'),
  challenge_expires timestamptz,
  challenge_attempts integer not null default 0 check (challenge_attempts between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sr_email_oauth_id on public.sr_email_oauth (id);

-- The pending sign-ins. user_id is the owner or admin who started one: the
-- provider's redirect carries no sign-in, so the server checks that person again.
create table if not exists public.sr_email_oauth_states (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  browser_digest text not null check (browser_digest ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.sr_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  revision integer not null,
  verifier_enc text not null check (verifier_enc like 'v1:%'),
  -- http only for this computer: "http://localhost:<port>/..." or "http://localhost/...", never "http://localhost.evil.com/...".
  redirect_uri text not null check (char_length(redirect_uri) <= 300 and (redirect_uri like 'https://%' or redirect_uri like 'http://localhost:%' or redirect_uri like 'http://localhost/%')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sr_email_oauth_states_workspace on public.sr_email_oauth_states (workspace_id);
create index if not exists sr_email_oauth_states_expires on public.sr_email_oauth_states (expires_at);

-- =========================================================== 6. server only

alter table public.sr_projects enable row level security;
alter table public.sr_ai_usage enable row level security;
alter table public.sr_mailboxes enable row level security;
alter table public.sr_email_oauth enable row level security;
alter table public.sr_email_oauth_states enable row level security;

revoke all on
  public.sr_projects, public.sr_ai_usage, public.sr_mailboxes, public.sr_email_oauth, public.sr_email_oauth_states
from public, anon, authenticated;

grant all on
  public.sr_projects, public.sr_ai_usage, public.sr_mailboxes, public.sr_email_oauth, public.sr_email_oauth_states
to service_role;

notify pgrst, 'reload schema';
