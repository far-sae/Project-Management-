-- 094_deal_forecast_v_workspace.sql
-- Extend deal_forecast_v with client_id and workspace_id so the Forecast tab
-- can be filtered to only the deals belonging to the currently selected
-- workspace's clients (workspace scoping lives on clients, not deals — deals
-- inherit it via their linked client).
--
-- IMPORTANT: Postgres's CREATE OR REPLACE VIEW only allows APPENDING columns,
-- not reordering or inserting them in the middle of the existing column list.
-- So the new client_id / workspace_id columns are tacked on at the end —
-- callers that select * (the only consumer today) just get two extra fields.

create or replace view public.deal_forecast_v as
select
  d.organization_id,
  d.pipeline_id,
  d.owner_id,
  d.owner_name,
  d.currency,
  to_char(
    coalesce(d.actual_close_date, d.expected_close_date, d.created_at::date),
    'YYYY-MM'
  ) as month_bucket,
  d.value,
  d.value * (d.probability::numeric / 100.0) as weighted_value,
  s.is_won,
  s.is_lost,
  d.stage_id,
  d.stage,
  d.client_id,
  c.workspace_id
from public.deals d
join public.pipeline_stages s on s.stage_id = d.stage_id
left join public.clients c on c.client_id = d.client_id
where not s.is_lost;

grant select on public.deal_forecast_v to authenticated;
