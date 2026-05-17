-- Stable client task creation path for the app. The frontend calls this RPC
-- first so task creation does not depend on direct table insert RLS behavior.

create or replace function public.crm_create_client_task(
  p_organization_id uuid,
  p_task jsonb
) returns public.client_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_created public.client_tasks;
  v_client_id uuid := nullif(p_task->>'client_id', '')::uuid;
  v_deal_id uuid := nullif(p_task->>'deal_id', '')::uuid;
  v_assigned_to uuid := nullif(p_task->>'assigned_to', '')::uuid;
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

  if v_deal_id is not null and not exists (
    select 1
    from public.deals
    where deal_id = v_deal_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Deal does not belong to this organization' using errcode = '23503';
  end if;

  insert into public.client_tasks (
    organization_id,
    client_id,
    deal_id,
    title,
    description,
    type,
    status,
    due_at,
    assigned_to,
    assigned_to_name,
    created_by,
    created_by_name
  ) values (
    p_organization_id,
    v_client_id,
    v_deal_id,
    nullif(btrim(p_task->>'title'), ''),
    nullif(btrim(p_task->>'description'), ''),
    coalesce(nullif(btrim(p_task->>'type'), ''), 'todo'),
    'pending',
    nullif(p_task->>'due_at', '')::timestamptz,
    coalesce(v_assigned_to, v_actor),
    nullif(btrim(p_task->>'assigned_to_name'), ''),
    v_actor,
    nullif(btrim(p_task->>'created_by_name'), '')
  )
  returning * into v_created;

  return v_created;
end;
$$;

grant execute on function public.crm_create_client_task(uuid, jsonb) to authenticated;
