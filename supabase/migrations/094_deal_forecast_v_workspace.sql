-- 094_deal_forecast_v_workspace.sql
-- Extend deal_forecast_v with client_id and workspace_id so the Forecast tab
-- can be filtered to only the deals belonging to the currently selected
-- workspace's clients (workspace scoping lives on clients, not deals — deals
-- inherit it via their linked client).

create or replace view public.deal_forecast_v as
select
  d.organization_id,
  d.pipeline_id,
  d.owner_id,
  d.owner_name,
  d.client_id,
  c.workspace_id,
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
  d.stage
from public.deals d
join public.pipeline_stages s on s.stage_id = d.stage_id
left join public.clients c on c.client_id = d.client_id
where not s.is_lost;

grant select on public.deal_forecast_v to authenticated;
