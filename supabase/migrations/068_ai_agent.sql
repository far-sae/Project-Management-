-- supabase/migrations/068_ai_agent.sql
-- Batch 2d: AI Sales Agent — suggestions, Apollo cache, pipeline staleness,
-- org-level enablement, snooze/expire revival RPC, stale-deal finder RPC.

begin;

-- ============================================================
-- agent_suggestions: one row per draft awaiting human action
-- ============================================================
create table public.agent_suggestions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id) on delete cascade,
  trigger_type    text not null check (trigger_type in ('intake','re_engagement')),
  client_id       uuid references clients(client_id) on delete cascade,
  deal_id         uuid references deals(deal_id) on delete cascade,
  source_event_id uuid references events_queue(id) on delete set null,
  draft           jsonb not null default '{}'::jsonb,
  enrichment_snapshot jsonb,
  confidence      numeric(4,3),
  reasoning       text,
  suggested_next_stage_id uuid references pipeline_stages(stage_id) on delete set null,
  status          text not null default 'pending' check (status in (
                    'pending','approved','sent','rejected','snoozed','expired',
                    'failed','cap_reached')),
  snooze_until    timestamptz,
  rejected_reasons text[],
  rejected_note   text,
  sent_message_id text,
  decided_by      uuid references users(user_id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (client_id is not null or deal_id is not null)
);

create index agent_suggestions_queue_idx
  on agent_suggestions (organization_id, status, created_at desc)
  where status in ('pending','snoozed');
create index agent_suggestions_revival_idx
  on agent_suggestions (snooze_until)
  where status = 'snoozed';
create index agent_suggestions_deal_idx
  on agent_suggestions (deal_id, decided_at desc)
  where deal_id is not null;
create index agent_suggestions_expire_idx
  on agent_suggestions (created_at)
  where status = 'pending';

-- ============================================================
-- apollo_lookups: 30-day enrichment cache
-- ============================================================
create table public.apollo_lookups (
  lookup_key_hash text primary key,
  lookup_key      text not null,
  data            jsonb,
  fetched_at      timestamptz not null default now()
);
create index apollo_lookups_ttl_idx on apollo_lookups (fetched_at);

-- ============================================================
-- pipelines.stale_after_days
-- ============================================================
alter table public.pipelines
  add column if not exists stale_after_days int not null default 14
  check (stale_after_days between 1 and 365);

-- ============================================================
-- organizations: agent toggle + per-day caps
-- ============================================================
alter table public.organizations
  add column if not exists ai_agent_enabled boolean not null default false,
  add column if not exists ai_agent_apollo_daily_cap int not null default 20,
  add column if not exists ai_agent_draft_daily_cap int not null default 50;

-- ============================================================
-- deals.last_activity_at: needed by stuck-deal scanner.
-- Backfill from updated_at if missing.
-- ============================================================
alter table public.deals
  add column if not exists last_activity_at timestamptz not null default now();
update public.deals
   set last_activity_at = updated_at
 where updated_at is not null
   and last_activity_at = created_at;

-- ============================================================
-- RLS
-- ============================================================
alter table public.agent_suggestions enable row level security;

create policy agent_suggestions_org_read on public.agent_suggestions
  for select using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));

create policy agent_suggestions_member_write on public.agent_suggestions
  for update using (organization_id in (
    select organization_id from organization_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

-- No insert policy: rows only created by service-role (Edge Function).

alter table public.apollo_lookups enable row level security;
-- No SELECT/INSERT policy => only service-role can touch this cache.

-- ============================================================
-- revive_agent_snoozes(): hourly cron flips snoozed→pending and
-- expires pending suggestions older than 14d.
-- ============================================================
create or replace function public.revive_agent_snoozes()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  revived_count int := 0;
  expired_count int := 0;
begin
  with revived as (
    update agent_suggestions
       set status = 'pending', snooze_until = null
     where status = 'snoozed' and snooze_until <= now()
    returning 1
  )
  select count(*) into revived_count from revived;

  with expired as (
    update agent_suggestions
       set status = 'expired'
     where status = 'pending'
       and created_at < now() - interval '14 days'
    returning 1
  )
  select count(*) into expired_count from expired;

  return revived_count + expired_count;
end
$$;

revoke all on function public.revive_agent_snoozes() from public;
grant execute on function public.revive_agent_snoozes() to service_role;

-- ============================================================
-- find_stale_deals(): per-org query for the nightly scanner.
-- ============================================================
create or replace function public.find_stale_deals(
  p_organization_id uuid,
  p_limit int default 100
) returns table (deal_id uuid, organization_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select d.deal_id, d.organization_id
    from deals d
    join pipelines p on p.pipeline_id = d.pipeline_id
   where d.organization_id = p_organization_id
     and d.status = 'open'
     and d.last_activity_at < now() - (p.stale_after_days || ' days')::interval
     and not exists (
       select 1 from agent_suggestions s
        where s.deal_id = d.deal_id
          and s.status in ('pending','snoozed')
     )
     and not exists (
       select 1 from agent_suggestions s
        where s.deal_id = d.deal_id
          and s.decided_at > now() - interval '30 days'
     )
   limit p_limit
$$;

revoke all on function public.find_stale_deals(uuid, int) from public;
grant execute on function public.find_stale_deals(uuid, int) to service_role;

commit;
