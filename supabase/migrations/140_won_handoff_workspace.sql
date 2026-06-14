-- 140_won_handoff_workspace.sql
--
-- Fix: closing a deal to "won" failed with
--   23502 null value in column "workspace_id" of relation "projects"
--
-- CRM is org-global now (deals/clients aren't bound to a workspace), so the
-- deal-won handoff had no workspace to put the delivery project in and inserted
-- workspace_id = null — which projects.workspace_id (NOT NULL) rejects.
--
-- Per the product model ("after a deal is won, make the workspace AND the
-- project"), the handoff now creates (or reuses) a delivery workspace for the
-- account and files the project under it.
--
-- Two changes:
--   1. workspaces_enforce_admin_create_delete: allow an INSERT during the
--      vetted won-handoff (app.crm_won_handoff = 'true') by a non-viewer org
--      member — mirrors the same bypass the projects trigger already has.
--   2. crm_close_deal_to_won: find-or-create the workspace, then insert the
--      project WITH workspace_id.

-- 1. Let the won-handoff create a workspace (same shape as the projects trigger).
create or replace function public.workspaces_enforce_admin_create_delete()
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

  -- Vetted CRM won-handoff: a non-viewer member may create the delivery
  -- workspace as part of closing a deal to won.
  if TG_OP = 'INSERT'
     and current_setting('app.crm_won_handoff', true) = 'true'
     and public.is_org_member(v_org)
     and not public.is_org_viewer(v_org) then
    return new;
  end if;

  if not public.is_org_admin_or_owner(v_org) then
    if TG_OP = 'INSERT' then
      raise exception 'Only the organization owner or an admin can create a workspace.'
        using errcode = '42501';
    else
      raise exception 'Only the organization owner or an admin can delete a workspace.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

-- 2. Recreate the handoff RPC: create/reuse a workspace, file the project in it.
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
  v_workspace uuid;
  v_ws_name text;
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

  -- Delivery workspace: caller-provided name, else the account name, else the
  -- project/deal title. Reuse an existing workspace of that name so repeated
  -- wins for the same account don't spawn duplicates.
  v_ws_name := coalesce(
    nullif(btrim(p_project_input ->> 'workspace_name'), ''),
    nullif(btrim(v_deal.client_name), ''),
    nullif(btrim(p_project_input ->> 'name'), ''),
    v_deal.title,
    'Delivery'
  );

  select workspace_id into v_workspace
  from public.workspaces
  where organization_id = v_org and lower(name) = lower(v_ws_name)
  limit 1;

  if v_workspace is null then
    insert into public.workspaces (workspace_id, name, organization_id, is_default, created_at, updated_at)
    values (gen_random_uuid(), v_ws_name, v_org, false, v_now, v_now)
    returning workspace_id into v_workspace;
  end if;

  insert into public.projects (organization_id, workspace_id, name, owner_id, start_date, end_date, client_id)
  values (
    v_org,
    v_workspace,
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

  return jsonb_build_object('deal_id', p_deal_id, 'project_id', v_project, 'workspace_id', v_workspace);
end;
$$;

grant execute on function public.crm_close_deal_to_won(uuid, jsonb) to authenticated;
