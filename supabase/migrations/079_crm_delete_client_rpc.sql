-- 079_crm_delete_client_rpc.sql
-- Reliable client deletion for the CRM UI. A direct DELETE can be filtered by
-- RLS and affect zero rows without returning an error, which made the client
-- disappear locally and then reappear on reload.

create or replace function public.crm_delete_client(
  p_organization_id uuid,
  p_client_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
begin
  if not public.is_org_admin_or_owner(p_organization_id) then
    raise exception 'Not authorized to delete clients' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.clients
    where organization_id = p_organization_id
      and client_id = p_client_id
  ) into v_exists;

  if not v_exists then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  delete from public.clients
  where organization_id = p_organization_id
    and client_id = p_client_id;
end;
$$;

grant execute on function public.crm_delete_client(uuid, uuid) to authenticated;
