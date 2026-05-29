-- 101_leads_viewer_readonly.sql
-- Migration 100 shipped leads + lead_notes RLS that only checks is_org_member
-- but never excludes viewers, breaking the "viewer is read-only at the DB"
-- contract that 043_viewer_readonly.sql + 071_clients_member_create_policy.sql
-- establish for the rest of the CRM. Lock viewers out of write paths here.

-- public.leads ──────────────────────────────────────────────────────────────

drop policy if exists "members_insert_leads"            on public.leads;
drop policy if exists "author_or_admin_update_leads"    on public.leads;
drop policy if exists "author_or_admin_delete_leads"    on public.leads;

create policy "members_insert_leads"
  on public.leads for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (created_by = auth.uid() or created_by is null)
  );

create policy "author_or_admin_update_leads"
  on public.leads for update to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (
      created_by = auth.uid()
      or lead_owner_id = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  )
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (
      created_by = auth.uid()
      or lead_owner_id = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  );

create policy "author_or_admin_delete_leads"
  on public.leads for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (
      created_by = auth.uid()
      or public.is_org_admin_or_owner(organization_id)
    )
  );

-- public.lead_notes ─────────────────────────────────────────────────────────

drop policy if exists "members_insert_lead_notes"            on public.lead_notes;
drop policy if exists "author_or_admin_update_lead_notes"    on public.lead_notes;
drop policy if exists "author_or_admin_delete_lead_notes"    on public.lead_notes;

create policy "members_insert_lead_notes"
  on public.lead_notes for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (author_id = auth.uid() or author_id is null)
  );

create policy "author_or_admin_update_lead_notes"
  on public.lead_notes for update to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  )
  with check (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

create policy "author_or_admin_delete_lead_notes"
  on public.lead_notes for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and not public.is_org_viewer(organization_id)
    and (author_id = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );
