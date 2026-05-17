-- 066_ai_blocks.sql
-- AI block actions for the automation engine: per-run telemetry +
-- per-org monthly soft cap.

create table if not exists public.ai_block_runs (
  run_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  recipe_id uuid references public.automation_recipes(recipe_id) on delete set null,
  automation_run_id uuid references public.automation_runs(run_id) on delete set null,
  action_type text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd_cents numeric(10,4),
  status text not null check (status in ('success','failure','skipped')),
  error_message text,
  duration_ms int,
  created_at timestamptz default now()
);

create index if not exists ai_block_runs_org_time_idx
  on public.ai_block_runs(organization_id, created_at desc);

create table if not exists public.ai_block_usage_caps (
  organization_id uuid primary key
    references public.organizations(organization_id) on delete cascade,
  monthly_run_cap int not null default 1000,
  current_month_runs int not null default 0,
  current_month_started_at date not null default date_trunc('month', current_date)::date
);

-- Atomic cap check + increment. Resets the counter on month rollover.
create or replace function public.check_and_increment_ai_cap(p_org uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_cap public.ai_block_usage_caps%rowtype;
  v_this_month date := date_trunc('month', current_date)::date;
begin
  insert into public.ai_block_usage_caps (organization_id) values (p_org)
    on conflict (organization_id) do nothing;
  select * into v_cap from public.ai_block_usage_caps
    where organization_id = p_org for update;
  if v_cap.current_month_started_at < v_this_month then
    update public.ai_block_usage_caps
    set current_month_runs = 0, current_month_started_at = v_this_month
    where organization_id = p_org;
    v_cap.current_month_runs := 0;
  end if;
  if v_cap.current_month_runs >= v_cap.monthly_run_cap then
    return false;
  end if;
  update public.ai_block_usage_caps
  set current_month_runs = current_month_runs + 1
  where organization_id = p_org;
  return true;
end;
$$;

grant execute on function public.check_and_increment_ai_cap(uuid) to service_role;

-- Admin-only RPC for the AI Usage tab.
create or replace function public.set_ai_block_cap(p_org uuid, p_cap int)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if not public.is_org_admin(p_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_cap < 0 or p_cap > 1000000 then
    raise exception 'Cap must be 0-1,000,000' using errcode = '22023';
  end if;
  insert into public.ai_block_usage_caps (organization_id, monthly_run_cap)
  values (p_org, p_cap)
  on conflict (organization_id) do update set monthly_run_cap = p_cap;
end;
$$;

grant execute on function public.set_ai_block_cap(uuid, int) to authenticated;

alter table public.ai_block_runs enable row level security;
alter table public.ai_block_usage_caps enable row level security;

drop policy if exists "ai_block_runs read for org members" on public.ai_block_runs;
create policy "ai_block_runs read for org members"
  on public.ai_block_runs for select
  using (public.is_org_member(organization_id));

drop policy if exists "ai_block_usage_caps read for org members" on public.ai_block_usage_caps;
create policy "ai_block_usage_caps read for org members"
  on public.ai_block_usage_caps for select
  using (public.is_org_member(organization_id));
