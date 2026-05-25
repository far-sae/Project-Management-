-- 093_crm_create_client_rpc_workspace.sql
-- Update crm_create_client to accept the new workspace_id column (added in
-- 092). Also folds in the `category` column the previous version forgot, so
-- the frontend stops falling through to a direct insert whenever a category
-- is set.
--
-- The RPC requires workspace_id; the app is expected to pick the current
-- workspace from the sidebar selector before creating clients.

create or replace function public.crm_create_client(
  p_organization_id uuid,
  p_client jsonb
) returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_created public.clients;
  v_tags text[] := '{}'::text[];
  v_workspace uuid;
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

  if nullif(btrim(p_client->>'name'), '') is null then
    raise exception 'Client name is required' using errcode = '23514';
  end if;

  -- Workspace is required. Fall back to the org's default workspace if the
  -- caller didn't supply one — keeps older builds working while the UI
  -- learns to pass workspace_id explicitly.
  v_workspace := nullif(p_client->>'workspace_id', '')::uuid;
  if v_workspace is null then
    select workspace_id into v_workspace
    from public.workspaces
    where organization_id = p_organization_id
    order by is_default desc nulls last, created_at asc
    limit 1;
  end if;
  if v_workspace is null then
    raise exception 'Cannot create a client: this organization has no workspace yet.'
      using errcode = '23502';
  end if;

  -- Sanity-check the workspace belongs to the same organization.
  if not exists (
    select 1 from public.workspaces
    where workspace_id = v_workspace
      and organization_id = p_organization_id
  ) then
    raise exception 'Workspace does not belong to this organization'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_client->'tags') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_tags
    from jsonb_array_elements_text(p_client->'tags') as tag_value(value);
  end if;

  insert into public.clients (
    organization_id,
    workspace_id,
    name,
    legal_name,
    industry,
    type,
    status,
    website,
    email,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    annual_revenue,
    employee_count,
    rating,
    source,
    description,
    category,
    tags,
    account_owner_id,
    account_owner_name,
    custom_fields,
    created_by,
    created_by_name
  ) values (
    p_organization_id,
    v_workspace,
    nullif(btrim(p_client->>'name'), ''),
    nullif(btrim(p_client->>'legal_name'), ''),
    nullif(btrim(p_client->>'industry'), ''),
    coalesce(nullif(btrim(p_client->>'type'), ''), 'customer'),
    coalesce(nullif(btrim(p_client->>'status'), ''), 'active'),
    nullif(btrim(p_client->>'website'), ''),
    nullif(btrim(p_client->>'email'), ''),
    nullif(btrim(p_client->>'phone'), ''),
    nullif(btrim(p_client->>'address_line1'), ''),
    nullif(btrim(p_client->>'address_line2'), ''),
    nullif(btrim(p_client->>'city'), ''),
    nullif(btrim(p_client->>'state'), ''),
    nullif(btrim(p_client->>'postal_code'), ''),
    nullif(btrim(p_client->>'country'), ''),
    nullif(p_client->>'annual_revenue', '')::numeric,
    nullif(p_client->>'employee_count', '')::integer,
    nullif(btrim(p_client->>'rating'), ''),
    nullif(btrim(p_client->>'source'), ''),
    nullif(btrim(p_client->>'description'), ''),
    nullif(btrim(p_client->>'category'), ''),
    v_tags,
    coalesce(nullif(p_client->>'account_owner_id', '')::uuid, v_actor),
    nullif(btrim(p_client->>'account_owner_name'), ''),
    coalesce(p_client->'custom_fields', '{}'::jsonb),
    v_actor,
    nullif(btrim(p_client->>'created_by_name'), '')
  )
  returning * into v_created;

  return v_created;
end;
$$;

grant execute on function public.crm_create_client(uuid, jsonb) to authenticated;
