-- Leads: saved views the whole team can use.
--
-- A saved view (a name for a search, filters and sorting) was kept in one
-- person's browser. A view can now be shared: it is kept here, and everybody
-- who can open the workspace's CRM finds it in their list.
--
-- One table is added. Views kept in a browser stay where they are.
--
-- Who can do what: everybody in the workspace's CRM reads the shared views;
-- everybody but viewers can add one; the person who made a view, or the owner
-- or an admin, can remove it.
--
-- Safe to run more than once.

create table if not exists public.crm_saved_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  workspace_id uuid not null references public.workspaces (workspace_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One shared view of a name per workspace, whatever the capitals.
create unique index if not exists crm_saved_views_name on public.crm_saved_views (workspace_id, lower(btrim(name)));

alter table public.crm_saved_views enable row level security;
revoke all on public.crm_saved_views from anon, authenticated;
grant select, insert, delete on public.crm_saved_views to authenticated;
grant all on public.crm_saved_views to service_role;

drop policy if exists "crm_saved_views_read" on public.crm_saved_views;
create policy "crm_saved_views_read" on public.crm_saved_views
  for select to authenticated
  using (public.can_access_crm_scope(organization_id, workspace_id));

drop policy if exists "crm_saved_views_add" on public.crm_saved_views;
create policy "crm_saved_views_add" on public.crm_saved_views
  for insert to authenticated
  with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id));

drop policy if exists "crm_saved_views_remove" on public.crm_saved_views;
create policy "crm_saved_views_remove" on public.crm_saved_views
  for delete to authenticated
  using (
    public.can_access_crm_scope(organization_id, workspace_id)
    and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))
  );

-- Tell the API about the new table straight away.
notify pgrst, 'reload schema';
