-- 057_integrations_tables.sql
-- Adds the integrations + integration_events tables that support
-- Google Meet, Gmail, Slack and future third-party integrations.
--
-- Uses the existing public.is_org_member(uuid) helper from migration 036
-- to gate org-level reads. The organizations table's primary key is
-- organization_id (not id) -- see migration 036.

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(organization_id) on delete cascade,
  provider text not null check (provider in ('google','gmail','slack')),
  scopes text[] not null default '{}',
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  status text not null default 'active'
      check (status in ('active','revoked','error','pending')),
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists integrations_org_provider_idx
  on public.integrations(org_id, provider);

create index if not exists integrations_user_provider_idx
  on public.integrations(user_id, provider);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

-- RLS

alter table public.integrations enable row level security;

create policy "users read own user-level integrations"
  on public.integrations for select
  using (auth.uid() = user_id and org_id is null);

create policy "org members read org-level integrations"
  on public.integrations for select
  using (org_id is not null and public.is_org_member(org_id));

-- All writes go through Edge Functions using the service-role key,
-- so we do not add INSERT/UPDATE/DELETE policies. End-user clients
-- cannot mutate this table directly.

-- Add Google Meet columns to tasks (used by the Meet plan, but the
-- columns belong with the integrations migration so future migrations
-- can rely on them).

alter table public.tasks
  add column if not exists google_meet_link text,
  add column if not exists google_event_id text;
