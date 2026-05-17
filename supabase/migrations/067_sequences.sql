-- Deferred actions queued by the wait handler. The worker drains rows where
-- fire_at <= now() each tick, resuming recipes from the next action.
create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  recipe_id uuid not null
    references public.automation_recipes(recipe_id) on delete cascade,
  -- The seed event so the resumed actions see the same payload they would
  -- have if they ran inline.
  source_event_id uuid references public.automation_events(event_id) on delete set null,
  -- Resume the recipe from this index in actions[].
  next_action_index int not null,
  fire_at timestamptz not null,
  -- aiOutputs accumulator carried over from pre-wait actions so {{ai.*}}
  -- placeholders in post-wait actions still resolve.
  ai_outputs jsonb not null default '{}'::jsonb,
  -- For stop conditions: which deal/client is this sequence about.
  deal_id uuid references public.deals(deal_id) on delete cascade,
  client_id uuid references public.clients(client_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','fired','cancelled','reply_received','stopped_by_admin','stopped_by_stage')),
  created_at timestamptz default now()
);

create index if not exists pending_actions_fire_idx
  on public.pending_actions(fire_at) where status = 'pending';

create index if not exists pending_actions_deal_idx
  on public.pending_actions(deal_id) where status = 'pending';

create index if not exists pending_actions_recipe_event_idx
  on public.pending_actions(recipe_id, source_event_id) where status = 'pending';

-- Inbound reply tracking. SendGrid POSTs here via the webhook; we log + flip
-- pending_actions for the matching recipe_run.
create table if not exists public.sequence_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recipe_run_id uuid references public.automation_runs(run_id) on delete set null,
  recipe_id uuid references public.automation_recipes(recipe_id) on delete set null,
  from_address text not null,
  subject text,
  body_preview text,
  received_at timestamptz default now(),
  raw_payload jsonb
);

create index if not exists sequence_replies_recipe_run_idx
  on public.sequence_replies(recipe_run_id, received_at desc);

create index if not exists sequence_replies_org_time_idx
  on public.sequence_replies(organization_id, received_at desc);

-- Send-window config on recipes. NULL = "any time".
alter table public.automation_recipes
  add column if not exists send_window jsonb;
-- send_window shape: { hours: [9, 18], days: [1,2,3,4,5], timezone: "Europe/London" }
--   hours: [start, end] — inclusive start, exclusive end, 0..24
--   days:  ISO weekday integers (1=Mon .. 7=Sun)
--   timezone: IANA TZ string

-- Org default timezone (used when recipe.send_window omits one).
alter table public.organizations
  add column if not exists default_timezone text not null default 'UTC';

-- Stop trigger: cancel pending actions when a deal moves to a won/lost stage.
create or replace function public.cancel_pending_actions_on_close()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_new_stage public.pipeline_stages%rowtype;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select * into v_new_stage from public.pipeline_stages where stage_id = new.stage_id;
  if v_new_stage.is_won or v_new_stage.is_lost then
    update public.pending_actions
    set status = 'stopped_by_stage'
    where status = 'pending' and deal_id = new.deal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_pending_actions_on_close_t on public.deals;
create trigger cancel_pending_actions_on_close_t
  after update of stage_id on public.deals
  for each row execute function public.cancel_pending_actions_on_close();

-- Admin-only RPC for the Stop button in the Sequences UI.
create or replace function public.stop_pending_actions_for_run(p_run_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_recipe uuid;
  v_event uuid;
  v_count int;
begin
  select organization_id, recipe_id, event_id into v_org, v_recipe, v_event
  from public.automation_runs where run_id = p_run_id;
  if v_org is null then return 0; end if;
  if not public.is_org_admin(v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.pending_actions
  set status = 'stopped_by_admin'
  where status = 'pending' and recipe_id = v_recipe and source_event_id = v_event;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.stop_pending_actions_for_run(uuid) to authenticated;

-- Extend crm_upsert_recipe to accept send_window. Drop + recreate to add the
-- new parameter; the new signature is backwards-compatible because callers
-- pass NULL when not setting a window.
drop function if exists public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean);

create or replace function public.crm_upsert_recipe(
  p_recipe_id uuid,
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_enabled boolean,
  p_send_window jsonb default null
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
      conditions, actions, enabled, send_window, created_by
    ) values (
      p_organization_id, btrim(p_name), p_description, p_trigger_type,
      coalesce(p_trigger_config, '{}'::jsonb),
      coalesce(p_conditions, '[]'::jsonb),
      p_actions,
      coalesce(p_enabled, true),
      p_send_window,
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
        send_window = p_send_window,
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

grant execute on function public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb)
  to authenticated;

-- RLS — pending_actions + sequence_replies readable by org members; no write
-- policies (service role only via the worker / webhook).
alter table public.pending_actions enable row level security;
alter table public.sequence_replies enable row level security;

drop policy if exists "pending_actions read for org members" on public.pending_actions;
create policy "pending_actions read for org members"
  on public.pending_actions for select
  using (public.is_org_member(organization_id));

drop policy if exists "sequence_replies read for org members" on public.sequence_replies;
create policy "sequence_replies read for org members"
  on public.sequence_replies for select
  using (public.is_org_member(organization_id));
