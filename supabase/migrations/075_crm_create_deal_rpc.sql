-- Stable deal creation path for the app. The frontend calls this RPC first so
-- deal inserts stay aligned with pipeline_id/stage_id requirements.

-- Pipelines can define custom stage keys, so the denormalized deals.stage
-- column must be synced from pipeline_stages rather than limited to the old
-- hard-coded six-stage list.
alter table public.deals
  drop constraint if exists deals_stage_check;

create or replace function public.deals_sync_stage_text()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_stage public.pipeline_stages%rowtype;
begin
  if new.pipeline_id is null then
    select pipeline_id
      into new.pipeline_id
    from public.pipelines
    where organization_id = new.organization_id
      and is_default
    limit 1;
  end if;

  if new.pipeline_id is null then
    perform public.seed_default_pipeline_for_org(new.organization_id);

    select pipeline_id
      into new.pipeline_id
    from public.pipelines
    where organization_id = new.organization_id
      and is_default
    limit 1;
  end if;

  if new.pipeline_id is null then
    select pipeline_id
      into new.pipeline_id
    from public.pipelines
    where organization_id = new.organization_id
    order by position, created_at
    limit 1;
  end if;

  if new.stage_id is null and new.pipeline_id is not null then
    select *
      into v_stage
    from public.pipeline_stages
    where organization_id = new.organization_id
      and pipeline_id = new.pipeline_id
      and key = coalesce(nullif(new.stage, ''), 'lead')
    limit 1;

    if v_stage.stage_id is null then
      select *
        into v_stage
      from public.pipeline_stages
      where organization_id = new.organization_id
        and pipeline_id = new.pipeline_id
      order by position, created_at
      limit 1;
    end if;

    if v_stage.stage_id is not null then
      new.stage_id := v_stage.stage_id;
    end if;
  end if;

  if new.stage_id is not null then
    select *
      into v_stage
    from public.pipeline_stages
    where stage_id = new.stage_id
      and organization_id = new.organization_id;

    if v_stage.stage_id is not null then
      new.pipeline_id := v_stage.pipeline_id;
      new.stage := v_stage.key;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists deals_sync_stage_text_t on public.deals;
drop trigger if exists deals_00_sync_stage_text_t on public.deals;
create trigger deals_00_sync_stage_text_t
  before insert or update of stage_id, pipeline_id, stage on public.deals
  for each row execute function public.deals_sync_stage_text();

create or replace function public.deals_set_updated_at_and_close()
returns trigger language plpgsql as $$
declare
  v_default_probability int;
  v_is_won boolean;
  v_is_lost boolean;
begin
  new.updated_at := now();

  if new.stage_id is not null then
    select default_probability, is_won, is_lost
      into v_default_probability, v_is_won, v_is_lost
    from public.pipeline_stages
    where stage_id = new.stage_id;
  end if;

  if (tg_op = 'INSERT')
     or (new.stage is distinct from old.stage)
     or (new.stage_id is distinct from old.stage_id) then
    new.probability := coalesce(v_default_probability, public.deal_default_probability(new.stage));
  end if;

  if coalesce(v_is_won, new.stage = 'won') or coalesce(v_is_lost, new.stage = 'lost') then
    if new.closed_at is null then
      new.closed_at := now();
    end if;
    if new.closed_by is null then
      new.closed_by := auth.uid();
    end if;
    if new.actual_close_date is null then
      new.actual_close_date := current_date;
    end if;
  elsif tg_op = 'UPDATE'
    and (old.stage in ('won','lost') or old.closed_at is not null)
    and not coalesce(v_is_won, false)
    and not coalesce(v_is_lost, false)
    and new.stage not in ('won','lost') then
    new.closed_at := null;
    new.closed_by := null;
    new.actual_close_date := null;
    new.loss_reason := null;
  end if;

  return new;
end;
$$;

create or replace function public.crm_create_deal(
  p_organization_id uuid,
  p_deal jsonb
) returns public.deals
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_created public.deals;
  v_tags text[] := '{}'::text[];
  v_client_id uuid := nullif(p_deal->>'client_id', '')::uuid;
  v_owner_id uuid := nullif(p_deal->>'owner_id', '')::uuid;
  v_pipeline_id uuid := nullif(p_deal->>'pipeline_id', '')::uuid;
  v_stage_id uuid := nullif(p_deal->>'stage_id', '')::uuid;
  v_stage_key text := coalesce(nullif(btrim(p_deal->>'stage'), ''), 'lead');
  v_stage public.pipeline_stages%rowtype;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organization' using errcode = '42501';
  end if;

  if public.is_org_viewer(p_organization_id) then
    raise exception 'Viewers have read-only access' using errcode = '42501';
  end if;

  if nullif(btrim(p_deal->>'title'), '') is null then
    raise exception 'Deal title is required' using errcode = '23514';
  end if;

  if v_client_id is not null and not exists (
    select 1
    from public.clients
    where client_id = v_client_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23503';
  end if;

  if jsonb_typeof(p_deal->'tags') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_tags
    from jsonb_array_elements_text(p_deal->'tags') as tag_value(value);
  end if;

  if v_stage_id is not null then
    select *
      into v_stage
    from public.pipeline_stages
    where stage_id = v_stage_id
      and organization_id = p_organization_id;

    if v_stage.stage_id is null then
      raise exception 'Pipeline stage does not belong to this organization' using errcode = '23503';
    end if;

    if v_pipeline_id is not null and v_stage.pipeline_id <> v_pipeline_id then
      raise exception 'Pipeline stage does not belong to the selected pipeline' using errcode = '23503';
    end if;

    v_pipeline_id := v_stage.pipeline_id;
    v_stage_key := v_stage.key;
  end if;

  if v_pipeline_id is null then
    select pipeline_id
      into v_pipeline_id
    from public.pipelines
    where organization_id = p_organization_id
      and is_default
    limit 1;
  end if;

  if v_pipeline_id is null then
    perform public.seed_default_pipeline_for_org(p_organization_id);

    select pipeline_id
      into v_pipeline_id
    from public.pipelines
    where organization_id = p_organization_id
      and is_default
    limit 1;
  end if;

  if v_pipeline_id is null then
    select pipeline_id
      into v_pipeline_id
    from public.pipelines
    where organization_id = p_organization_id
    order by position, created_at
    limit 1;
  end if;

  if v_pipeline_id is null then
    raise exception 'No sales pipeline is configured for this organization' using errcode = 'P0001';
  end if;

  if v_stage.stage_id is null then
    select *
      into v_stage
    from public.pipeline_stages
    where organization_id = p_organization_id
      and pipeline_id = v_pipeline_id
      and key = v_stage_key
    limit 1;
  end if;

  if v_stage.stage_id is null then
    select *
      into v_stage
    from public.pipeline_stages
    where organization_id = p_organization_id
      and pipeline_id = v_pipeline_id
    order by position, created_at
    limit 1;
  end if;

  if v_stage.stage_id is null then
    raise exception 'No stages are configured for this sales pipeline' using errcode = 'P0001';
  end if;

  insert into public.deals (
    organization_id,
    client_id,
    client_name,
    title,
    description,
    stage,
    value,
    currency,
    expected_close_date,
    owner_id,
    owner_name,
    source,
    tags,
    position,
    created_by,
    created_by_name,
    pipeline_id,
    stage_id
  ) values (
    p_organization_id,
    v_client_id,
    nullif(btrim(p_deal->>'client_name'), ''),
    nullif(btrim(p_deal->>'title'), ''),
    nullif(btrim(p_deal->>'description'), ''),
    v_stage.key,
    coalesce(nullif(p_deal->>'value', '')::numeric, 0),
    upper(coalesce(nullif(btrim(p_deal->>'currency'), ''), 'USD')),
    nullif(p_deal->>'expected_close_date', '')::date,
    coalesce(v_owner_id, v_actor),
    nullif(btrim(p_deal->>'owner_name'), ''),
    nullif(btrim(p_deal->>'source'), ''),
    v_tags,
    coalesce(nullif(p_deal->>'position', '')::numeric, extract(epoch from clock_timestamp()) * 1000),
    v_actor,
    nullif(btrim(p_deal->>'created_by_name'), ''),
    v_pipeline_id,
    v_stage.stage_id
  )
  returning * into v_created;

  return v_created;
end;
$$;

grant execute on function public.crm_create_deal(uuid, jsonb) to authenticated;
