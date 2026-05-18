-- 080_crm_full_client_delete.sql
-- Make client deletion remove the client-owned CRM surface, not just detach it.
-- In particular, deals use ON DELETE SET NULL, so they must be removed before
-- the client row or they survive as orphaned pipeline cards.

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
  v_deal_ids uuid[] := '{}'::uuid[];
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

  select coalesce(array_agg(deal_id), '{}'::uuid[])
    into v_deal_ids
  from public.deals
  where organization_id = p_organization_id
    and client_id = p_client_id;

  delete from public.client_tasks
  where organization_id = p_organization_id
    and (
      client_id = p_client_id
      or deal_id = any(v_deal_ids)
    );

  delete from public.form_submissions
  where organization_id = p_organization_id
    and (
      client_id = p_client_id
      or deal_id = any(v_deal_ids)
    );

  delete from public.automation_events
  where organization_id = p_organization_id
    and (
      (source_table = 'clients' and source_id = p_client_id)
      or (source_table = 'deals' and source_id = any(v_deal_ids))
      or payload ->> 'client_id' = p_client_id::text
      or payload ->> 'deal_id' = any(array(select unnest(v_deal_ids)::text))
    );

  delete from public.deals
  where organization_id = p_organization_id
    and client_id = p_client_id;

  -- Cascades remove contacts, notes, attachments metadata, sequences, pending
  -- actions, agent suggestions, and duplicate override rows tied to the client.
  delete from public.clients
  where organization_id = p_organization_id
    and client_id = p_client_id;
end;
$$;

grant execute on function public.crm_delete_client(uuid, uuid) to authenticated;
