-- Allow regular org members to add/import clients while keeping edit/delete
-- restricted to admins and owners. This matches deals: reps can log new
-- opportunities/accounts, but they cannot remove or globally rewrite CRM data.

drop policy if exists "owner_admin_insert_clients" on public.clients;
drop policy if exists "members_insert_clients" on public.clients;

create policy "members_insert_clients"
  on public.clients for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by is null or created_by = auth.uid())
  );
