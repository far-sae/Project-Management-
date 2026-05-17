-- Stable deal update path for the app. Direct PATCH requests are restricted by
-- deal-owner RLS; this RPC explicitly allows non-viewer org members to move and
-- edit CRM deals while still validating organization boundaries.

create or replace function public.crm_update_deal(
  p_organization_id uuid,
  p_deal_id uuid,
  p_patch jsonb
) returns public.deals
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.deals%rowtype;
  v_updated public.deals;
  v_client_id uuid;
  v_stage_id uuid;
  v_pipeline_id uuid;
  v_tags text[];
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

  select *
    into v_existing
  from public.deals
  where deal_id = p_deal_id
    and organization_id = p_organization_id;

  if v_existing.deal_id is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'client_id' then
    v_client_id := nullif(p_patch->>'client_id', '')::uuid;
    if v_client_id is not null and not exists (
      select 1
      from public.clients
      where client_id = v_client_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Client does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_client_id := v_existing.client_id;
  end if;

  if p_patch ? 'stage_id' then
    v_stage_id := nullif(p_patch->>'stage_id', '')::uuid;
    if v_stage_id is not null and not exists (
      select 1
      from public.pipeline_stages
      where stage_id = v_stage_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Pipeline stage does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_stage_id := v_existing.stage_id;
  end if;

  if p_patch ? 'pipeline_id' then
    v_pipeline_id := nullif(p_patch->>'pipeline_id', '')::uuid;
    if v_pipeline_id is not null and not exists (
      select 1
      from public.pipelines
      where pipeline_id = v_pipeline_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Pipeline does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_pipeline_id := v_existing.pipeline_id;
  end if;

  if v_stage_id is not null and v_pipeline_id is not null and not exists (
    select 1
    from public.pipeline_stages
    where stage_id = v_stage_id
      and pipeline_id = v_pipeline_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Pipeline stage does not belong to the selected pipeline' using errcode = '23503';
  end if;

  if p_patch ? 'tags' then
    if jsonb_typeof(p_patch->'tags') = 'array' then
      select coalesce(array_agg(value), '{}'::text[])
        into v_tags
      from jsonb_array_elements_text(p_patch->'tags') as tag_value(value);
    else
      v_tags := '{}'::text[];
    end if;
  else
    v_tags := v_existing.tags;
  end if;

  update public.deals
  set
    client_id = case when p_patch ? 'client_id' then v_client_id else client_id end,
    client_name = case when p_patch ? 'client_name' then nullif(btrim(p_patch->>'client_name'), '') else client_name end,
    title = case when p_patch ? 'title' then nullif(btrim(p_patch->>'title'), '') else title end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch->>'description'), '') else description end,
    stage = case when p_patch ? 'stage' then nullif(btrim(p_patch->>'stage'), '') else stage end,
    value = case when p_patch ? 'value' then coalesce(nullif(p_patch->>'value', '')::numeric, 0) else value end,
    currency = case when p_patch ? 'currency' then upper(coalesce(nullif(btrim(p_patch->>'currency'), ''), currency)) else currency end,
    probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::int else probability end,
    expected_close_date = case when p_patch ? 'expected_close_date' then nullif(p_patch->>'expected_close_date', '')::date else expected_close_date end,
    actual_close_date = case when p_patch ? 'actual_close_date' then nullif(p_patch->>'actual_close_date', '')::date else actual_close_date end,
    owner_id = case when p_patch ? 'owner_id' then nullif(p_patch->>'owner_id', '')::uuid else owner_id end,
    owner_name = case when p_patch ? 'owner_name' then nullif(btrim(p_patch->>'owner_name'), '') else owner_name end,
    source = case when p_patch ? 'source' then nullif(btrim(p_patch->>'source'), '') else source end,
    tags = v_tags,
    position = case when p_patch ? 'position' then nullif(p_patch->>'position', '')::numeric else position end,
    loss_reason = case when p_patch ? 'loss_reason' then nullif(btrim(p_patch->>'loss_reason'), '') else loss_reason end,
    pipeline_id = case when p_patch ? 'pipeline_id' then v_pipeline_id else pipeline_id end,
    stage_id = case when p_patch ? 'stage_id' then v_stage_id else stage_id end
  where deal_id = p_deal_id
    and organization_id = p_organization_id
  returning * into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.crm_update_deal(uuid, uuid, jsonb) to authenticated;

-- Deal-won handoff needs to create a delivery project from a CRM workflow.
-- Keep normal project creation admin-only, but allow this vetted SECURITY
-- DEFINER path to pass the project insert trigger after it validates org
-- membership and viewer read-only rules.
create or replace function public.projects_enforce_admin_create_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  if TG_OP = 'INSERT' then
    v_org := new.organization_id;
  else
    v_org := old.organization_id;
  end if;

  if v_org is null then
    return coalesce(new, old);
  end if;

  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if TG_OP = 'INSERT'
     and current_setting('app.crm_won_handoff', true) = 'true'
     and public.is_org_member(v_org)
     and not public.is_org_viewer(v_org) then
    return new;
  end if;

  if not public.is_org_admin_or_owner(v_org) then
    if TG_OP = 'INSERT' then
      raise exception 'Only the organization owner or an admin can create a project.'
        using errcode = '42501';
    else
      raise exception 'Only the organization owner or an admin can delete a project.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

create or replace function public.crm_close_deal_to_won(
  p_deal_id uuid,
  p_project_input jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_won_stage uuid;
  v_project uuid;
  v_template uuid;
  v_org uuid;
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_task jsonb;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_deal from public.deals where deal_id = p_deal_id;
  if v_deal is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  v_org := v_deal.organization_id;

  if not public.is_org_member(v_org) then
    raise exception 'You are not a member of this organization' using errcode = '42501';
  end if;

  if public.is_org_viewer(v_org) then
    raise exception 'Viewers have read-only access' using errcode = '42501';
  end if;

  select stage_id into v_won_stage
  from public.pipeline_stages
  where pipeline_id = v_deal.pipeline_id and is_won;

  if v_won_stage is null then
    raise exception 'No won stage is configured for this pipeline' using errcode = 'P0001';
  end if;

  update public.deals
  set stage_id = v_won_stage,
      probability = 100,
      actual_close_date = v_now::date,
      closed_at = v_now,
      closed_by = v_actor,
      updated_at = v_now
  where deal_id = p_deal_id;

  if (p_project_input ->> 'skip')::boolean is true then
    return jsonb_build_object('deal_id', p_deal_id, 'project_id', null);
  end if;

  perform set_config('app.crm_won_handoff', 'true', true);

  insert into public.projects (organization_id, name, owner_id, start_date, end_date, client_id)
  values (
    v_org,
    coalesce(nullif(btrim(p_project_input ->> 'name'), ''), v_deal.title),
    coalesce(nullif(p_project_input ->> 'owner_id', '')::uuid, v_deal.owner_id, v_actor),
    coalesce(nullif(p_project_input ->> 'start_date', '')::date, current_date),
    coalesce(nullif(p_project_input ->> 'due_date', '')::date, (current_date + interval '30 days')::date),
    v_deal.client_id
  )
  returning project_id into v_project;

  v_template := nullif(p_project_input ->> 'template_id', '')::uuid;
  if v_template is not null then
    for v_task in
      select * from jsonb_array_elements(
        (select task_definitions from public.crm_project_templates
          where template_id = v_template and organization_id = v_org)
      )
    loop
      insert into public.tasks (organization_id, project_id, title, due_date, created_by)
      values (
        v_org, v_project,
        v_task ->> 'title',
        (current_date + ((v_task ->> 'offsetDays')::int) * interval '1 day')::date,
        v_actor
      );
    end loop;
  end if;

  return jsonb_build_object('deal_id', p_deal_id, 'project_id', v_project);
end;
$$;

grant execute on function public.crm_close_deal_to_won(uuid, jsonb) to authenticated;
