-- 065_automation_engine.sql
-- CRM automation engine: per-org recipes, event queue, run history, worker heartbeat.
-- DB triggers + cleanup hooks land in a later append within this same file.

create table if not exists public.automation_recipes (
  recipe_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null,
  enabled boolean not null default true,
  run_count int not null default 0,
  fail_count int not null default 0,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (organization_id, name)
);

create index if not exists automation_recipes_org_enabled_idx
  on public.automation_recipes(organization_id, trigger_type)
  where enabled;

create table if not exists public.automation_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  source_table text,
  source_id uuid,
  depth int not null default 0,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists automation_events_pending_idx
  on public.automation_events(organization_id, enqueued_at)
  where processed_at is null;

create table if not exists public.automation_runs (
  run_id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null
    references public.automation_recipes(recipe_id) on delete cascade,
  event_id uuid references public.automation_events(event_id) on delete set null,
  organization_id uuid not null,
  status text not null check (status in ('success','failure','skipped','partial')),
  action_results jsonb not null default '[]'::jsonb,
  started_at timestamptz not null,
  finished_at timestamptz not null
);

create index if not exists automation_runs_recipe_time_idx
  on public.automation_runs(recipe_id, started_at desc);

create index if not exists automation_runs_org_time_idx
  on public.automation_runs(organization_id, started_at desc);

create table if not exists public.automation_worker_heartbeat (
  id smallint primary key default 1 check (id = 1),
  last_run_at timestamptz not null,
  last_batch_size int not null,
  last_duration_ms int not null
);

-- Atomic counter bump used by the worker after each recipe run.
create or replace function public.increment_recipe_counters(
  p_recipe_id uuid,
  p_failed boolean
) returns void
language sql security definer
set search_path = public, pg_temp as $$
  update public.automation_recipes
  set run_count  = run_count + 1,
      fail_count = fail_count + (case when p_failed then 1 else 0 end),
      last_run_at = now(),
      updated_at  = now()
  where recipe_id = p_recipe_id;
$$;

grant execute on function public.increment_recipe_counters(uuid, boolean)
  to service_role;

-- Auto-disable used by the worker when burst detection trips.
create or replace function public.disable_recipe_for_runaway(p_recipe_id uuid)
returns void
language sql security definer
set search_path = public, pg_temp as $$
  update public.automation_recipes
  set enabled = false, updated_at = now()
  where recipe_id = p_recipe_id;
$$;

grant execute on function public.disable_recipe_for_runaway(uuid)
  to service_role;

-- Admin-only CRUD via SECURITY DEFINER. The frontend calls these; direct
-- writes through PostgREST are forbidden by the absence of write policies.
create or replace function public.crm_upsert_recipe(
  p_recipe_id uuid,             -- null on create
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_enabled boolean
) returns public.automation_recipes
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_row public.automation_recipes;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Recipe name is required' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) = 0 then
    raise exception 'Recipe must have at least one action' using errcode = '22023';
  end if;

  if p_recipe_id is null then
    insert into public.automation_recipes (
      organization_id, name, description, trigger_type, trigger_config,
      conditions, actions, enabled, created_by
    ) values (
      p_organization_id, btrim(p_name), p_description, p_trigger_type,
      coalesce(p_trigger_config, '{}'::jsonb),
      coalesce(p_conditions, '[]'::jsonb),
      p_actions,
      coalesce(p_enabled, true),
      auth.uid()
    )
    returning * into v_row;
  else
    update public.automation_recipes
    set name = btrim(p_name),
        description = p_description,
        trigger_type = p_trigger_type,
        trigger_config = coalesce(p_trigger_config, '{}'::jsonb),
        conditions = coalesce(p_conditions, '[]'::jsonb),
        actions = p_actions,
        enabled = coalesce(p_enabled, true),
        updated_at = now()
    where recipe_id = p_recipe_id
      and organization_id = p_organization_id
    returning * into v_row;
    if v_row.recipe_id is null then
      raise exception 'Recipe not found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean)
  to authenticated;

create or replace function public.crm_delete_recipe(p_recipe_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.automation_recipes where recipe_id = p_recipe_id;
  if v_org is null then return; end if;
  if not public.is_org_admin(v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.automation_recipes where recipe_id = p_recipe_id;
end;
$$;

grant execute on function public.crm_delete_recipe(uuid) to authenticated;

-- RLS: members read, no direct writes (use the RPCs above).
alter table public.automation_recipes enable row level security;
alter table public.automation_runs    enable row level security;

drop policy if exists "automation_recipes read for org members" on public.automation_recipes;
create policy "automation_recipes read for org members"
  on public.automation_recipes for select
  using (public.is_org_member(organization_id));

drop policy if exists "automation_runs read for org members" on public.automation_runs;
create policy "automation_runs read for org members"
  on public.automation_runs for select
  using (public.is_org_member(organization_id));

-- automation_events: service role only, no public access. RLS enabled with no
-- policies means PostgREST consumers see nothing.
alter table public.automation_events enable row level security;
