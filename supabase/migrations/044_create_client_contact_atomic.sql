-- Atomically demote existing primary + insert contact (avoids race between two
-- concurrent "set as primary" creates tripping ux_client_contacts_primary).

create or replace function public.create_client_contact(
  p_organization_id uuid,
  p_client_id uuid,
  p_created_by uuid,
  p_first_name text,
  p_last_name text,
  p_title text,
  p_department text,
  p_email text,
  p_phone text,
  p_mobile text,
  p_is_primary boolean,
  p_notes text
)
returns public.client_contacts
language plpgsql
set search_path = public
as $$
declare
  r public.client_contacts;
begin
  if coalesce(p_is_primary, false) then
    update public.client_contacts
    set
      is_primary = false,
      updated_at = now()
    where organization_id = p_organization_id
      and client_id = p_client_id
      and is_primary = true;
  end if;

  insert into public.client_contacts (
    client_id,
    organization_id,
    first_name,
    last_name,
    title,
    department,
    email,
    phone,
    mobile,
    is_primary,
    notes,
    created_by
  )
  values (
    p_client_id,
    p_organization_id,
    p_first_name,
    p_last_name,
    p_title,
    p_department,
    p_email,
    p_phone,
    p_mobile,
    coalesce(p_is_primary, false),
    p_notes,
    p_created_by
  )
  returning * into strict r;

  return r;
end;
$$;

grant execute on function public.create_client_contact(
  uuid, uuid, uuid,
  text, text, text, text, text, text, text, boolean, text
) to authenticated;
