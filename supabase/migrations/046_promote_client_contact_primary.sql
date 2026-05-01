-- Atomically demote other primaries for the same client and set this row primary
-- (single transaction; avoids races vs separate read + update + update).

create or replace function public.promote_client_contact_primary(
  p_organization_id uuid,
  p_contact_id uuid
)
returns public.client_contacts
language plpgsql
set search_path = public
as $$
declare
  cid uuid;
  r public.client_contacts;
begin
  select c.client_id into cid
  from public.client_contacts c
  where c.organization_id = p_organization_id
    and c.contact_id = p_contact_id
  for update;

  if cid is null then
    raise exception 'Contact not found' using errcode = 'P0002';
  end if;

  update public.client_contacts
  set
    is_primary = false,
    updated_at = now()
  where organization_id = p_organization_id
    and client_id = cid
    and contact_id <> p_contact_id
    and is_primary = true;

  update public.client_contacts
  set
    is_primary = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id
  returning * into strict r;

  return r;
end;
$$;

grant execute on function public.promote_client_contact_primary(uuid, uuid) to authenticated;
