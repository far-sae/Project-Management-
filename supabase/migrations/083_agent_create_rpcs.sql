-- 083_agent_create_rpcs.sql
-- Security-definer RPCs the Telegram/WhatsApp webhook uses to write entities
-- on behalf of a linked user. Each function takes p_user_id explicitly and
-- re-verifies org membership.
--
-- Membership in this codebase is encoded as a jsonb members[] on organizations
-- plus the owner_id column (see migration 036). The existing is_org_member()
-- helper uses auth.uid(); we add a 2-arg variant for service-role callers.

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: org-membership for an explicit user_id.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.is_org_member_for(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organizations o
    where o.organization_id = p_org_id
      and (
        o.owner_id = p_user_id
        or exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = p_user_id
        )
      )
  );
$$;

revoke execute on function public.is_org_member_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_org_member_for(uuid, uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_workspace
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_workspace(
  p_user_id uuid,
  p_organization_id uuid,
  p_name text
) returns public.workspaces
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.workspaces;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Workspace name is required' using errcode = '23514';
  end if;

  insert into public.workspaces (workspace_id, name, organization_id, is_default, created_at, updated_at)
  values (gen_random_uuid(), btrim(p_name), p_organization_id, false, now(), now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_workspace(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agent_create_workspace(uuid, uuid, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_project
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_project(
  p_user_id uuid,
  p_organization_id uuid,
  p_workspace_id uuid,
  p_name text,
  p_description text default null
) returns public.projects
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.projects;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Project name is required' using errcode = '23514';
  end if;
  if p_workspace_id is not null and not exists (
    select 1 from public.workspaces
    where workspace_id = p_workspace_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Workspace does not belong to this organization' using errcode = '23503';
  end if;

  insert into public.projects (project_id, name, description, owner_id, organization_id, workspace_id, created_by, created_at, updated_at)
  values (gen_random_uuid(), btrim(p_name), nullif(btrim(p_description), ''), p_user_id, p_organization_id, p_workspace_id, p_user_id, now(), now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_project(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_create_project(uuid, uuid, uuid, text, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_task
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_task(
  p_user_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_due_at timestamptz default null,
  p_description text default null
) returns public.tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.tasks;
  v_position int;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'Task title is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.projects
    where project_id = p_project_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Project does not belong to this organization' using errcode = '23503';
  end if;

  select coalesce(max(position), -1) + 1
    into v_position
    from public.tasks
   where project_id = p_project_id
     and status = 'undefined';

  insert into public.tasks (
    task_id, project_id, organization_id, title, description, status, priority,
    position, due_date, created_by, created_at, updated_at
  ) values (
    gen_random_uuid(), p_project_id, p_organization_id, btrim(p_title),
    nullif(btrim(p_description), ''), 'undefined', 'medium',
    v_position, p_due_at, p_user_id, now(), now()
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_task(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.agent_create_task(uuid, uuid, uuid, text, timestamptz, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- crm_create_client_as: p_user_id variant of crm_create_client.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_create_client_as(
  p_user_id uuid,
  p_organization_id uuid,
  p_client jsonb
) returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.clients;
begin
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_client->>'name'), '') is null then
    raise exception 'Client name is required' using errcode = '23514';
  end if;
  insert into public.clients (organization_id, name, created_by)
  values (p_organization_id, btrim(p_client->>'name'), p_user_id)
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.crm_create_client_as(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_create_client_as(uuid, uuid, jsonb) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- crm_create_client_task_as: p_user_id variant of crm_create_client_task.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.crm_create_client_task_as(
  p_user_id uuid,
  p_organization_id uuid,
  p_task jsonb
) returns public.client_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.client_tasks;
  v_client_id uuid := nullif(p_task->>'client_id', '')::uuid;
begin
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_task->>'title'), '') is null then
    raise exception 'Task title is required' using errcode = '23514';
  end if;
  if v_client_id is not null and not exists (
    select 1
    from public.clients
    where client_id = v_client_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Client does not belong to this organization' using errcode = '23503';
  end if;
  insert into public.client_tasks (
    organization_id, client_id, title, description, type, status, due_at,
    assigned_to, created_by
  ) values (
    p_organization_id, v_client_id,
    btrim(p_task->>'title'),
    nullif(btrim(p_task->>'description'), ''),
    coalesce(nullif(btrim(p_task->>'type'), ''), 'todo'),
    'pending',
    nullif(p_task->>'due_at', '')::timestamptz,
    p_user_id,
    p_user_id
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.crm_create_client_task_as(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.crm_create_client_task_as(uuid, uuid, jsonb) to service_role;
