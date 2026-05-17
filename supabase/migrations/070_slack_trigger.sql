-- supabase/migrations/070_slack_trigger.sql
-- Slack message trigger: dedupe cache for Slack's retry behavior +
-- team_id lookup index on integrations + gc helper.

begin;

-- ============================================================
-- slack_event_dedupe: idempotency cache. Slack retries unsigned/timeout
-- deliveries up to 3 times; we INSERT … ON CONFLICT DO NOTHING and
-- return 200 immediately if the event_id was already seen.
-- ============================================================
create table public.slack_event_dedupe (
  event_id   text primary key,
  seen_at    timestamptz not null default now()
);
create index slack_event_dedupe_ttl_idx on public.slack_event_dedupe (seen_at);

alter table public.slack_event_dedupe enable row level security;
-- service-role only; no policies = no PostgREST access.

-- ============================================================
-- integrations: partial expression index on metadata->>'team_id' so the
-- slack-events function can resolve incoming team_id -> org in O(1).
-- ============================================================
create index if not exists integrations_slack_team_id_idx
  on public.integrations ((metadata ->> 'team_id'))
  where provider = 'slack' and status = 'active';

-- ============================================================
-- gc_slack_event_dedupe(): trim rows older than 1 hour.
-- Called opportunistically from the slack-events function (cheap; the
-- TTL index makes the delete fast) so we don't need another cron.
-- ============================================================
create or replace function public.gc_slack_event_dedupe()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  with d as (
    delete from public.slack_event_dedupe
     where seen_at < now() - interval '1 hour'
    returning 1
  )
  select count(*) into removed from d;
  return removed;
end
$$;

revoke all on function public.gc_slack_event_dedupe() from public;
grant execute on function public.gc_slack_event_dedupe() to service_role;

commit;
