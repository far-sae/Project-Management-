-- 152_email_marketing_schema.sql
--
-- Email marketing: users connect their own SMTP account and send single or
-- bulk personalized email. See
-- docs/superpowers/specs/2026-09-18-email-marketing-design.md
--
-- Secrets live in email_account_secrets, a separate table with a deny-all
-- RLS policy (the app_secrets pattern from migration 111), so the encrypted
-- SMTP password is never reachable from a browser session at all — only the
-- service role, used by the Vercel worker, can read it.

-- ── Sending accounts ────────────────────────────────────────────────
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  label text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  smtp_host text not null,
  smtp_port integer not null default 587,
  smtp_secure boolean not null default false,
  smtp_username text not null,
  daily_limit integer not null default 500,
  hourly_limit integer not null default 60,
  status text not null default 'unverified'
    check (status in ('unverified','active','error')),
  last_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_accounts enable row level security;
grant select, insert, update, delete on public.email_accounts to authenticated;
grant all on public.email_accounts to service_role;
create index if not exists idx_email_accounts_org on public.email_accounts(organization_id);

drop policy if exists "email_accounts_read" on public.email_accounts;
create policy "email_accounts_read" on public.email_accounts
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "email_accounts_write" on public.email_accounts;
create policy "email_accounts_write" on public.email_accounts
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ── Secrets (never readable by a browser) ───────────────────────────
create table if not exists public.email_account_secrets (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  secret_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.email_account_secrets enable row level security;
grant all on public.email_account_secrets to service_role;

drop policy if exists "email_account_secrets_no_one" on public.email_account_secrets;
create policy "email_account_secrets_no_one" on public.email_account_secrets
  for all to authenticated using (false) with check (false);

-- ── Campaigns ───────────────────────────────────────────────────────
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  workspace_id uuid references public.workspaces(workspace_id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  account_id uuid not null references public.email_accounts(id) on delete restrict,
  kind text not null default 'bulk' check (kind in ('single','bulk')),
  name text not null,
  subject text not null,
  body_html text not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','sending','paused','sent','failed')),
  scheduled_at timestamptz,
  rate_per_hour integer not null default 60,
  queued_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  suppressed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_campaigns enable row level security;
grant select, insert, update, delete on public.email_campaigns to authenticated;
grant all on public.email_campaigns to service_role;
create index if not exists idx_email_campaigns_org on public.email_campaigns(organization_id, created_at desc);

drop policy if exists "email_campaigns_rw" on public.email_campaigns;
create policy "email_campaigns_rw" on public.email_campaigns
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ── Outbox ──────────────────────────────────────────────────────────
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  to_email text not null,
  to_name text,
  merge_data jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','sending','sent','failed','suppressed')),
  attempts integer not null default 0,
  last_error text,
  provider_message_id text,
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_messages enable row level security;
grant select on public.email_messages to authenticated;
grant insert on public.email_messages to authenticated;
grant all on public.email_messages to service_role;
-- The worker's claim query drives this index.
create index if not exists idx_email_messages_claim
  on public.email_messages(status, send_after);
create index if not exists idx_email_messages_campaign
  on public.email_messages(campaign_id);

drop policy if exists "email_messages_read" on public.email_messages;
create policy "email_messages_read" on public.email_messages
  for select to authenticated using (public.is_org_member(organization_id));

-- Members may enqueue, but never edit a row afterwards: status is the
-- worker's to own, so a client cannot mark its own mail as sent.
drop policy if exists "email_messages_insert" on public.email_messages;
create policy "email_messages_insert" on public.email_messages
  for insert to authenticated with check (public.is_org_member(organization_id));

-- ── Suppressions ────────────────────────────────────────────────────
create table if not exists public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  email text not null,
  reason text not null default 'unsubscribed'
    check (reason in ('unsubscribed','bounced','complaint','manual')),
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
alter table public.email_suppressions enable row level security;
grant select, insert, delete on public.email_suppressions to authenticated;
grant all on public.email_suppressions to service_role;
create index if not exists idx_email_suppressions_org on public.email_suppressions(organization_id);

drop policy if exists "email_suppressions_rw" on public.email_suppressions;
create policy "email_suppressions_rw" on public.email_suppressions
  for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

notify pgrst, 'reload schema';
