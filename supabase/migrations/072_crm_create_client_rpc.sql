-- Stable client creation path for the app. Direct table inserts are easy to
-- break when RLS policies change, so the frontend calls this RPC first. The
-- function still enforces membership and viewer read-only rules explicitly.

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

  if jsonb_typeof(p_client->'tags') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
      into v_tags
    from jsonb_array_elements_text(p_client->'tags') as tag_value(value);
  end if;

  insert into public.clients (
    organization_id,
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
    tags,
    account_owner_id,
    account_owner_name,
    custom_fields,
    created_by,
    created_by_name
  ) values (
    p_organization_id,
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
