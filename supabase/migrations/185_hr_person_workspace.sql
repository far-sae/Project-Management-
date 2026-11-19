-- ============================================================================
-- 185 — HR: which workspace each person belongs to.
--
-- HR follows the workspace picked in the sidebar. Each person is in at most
-- one workspace; a person with no row here has no workspace yet and shows
-- under "Unassigned" and "All workspaces" only.
--
-- Safe to run more than once. Only adds a new table; nothing existing is
-- changed. Uses the helpers from migration 036:
--   public.is_org_admin_or_owner(uuid), public.is_org_member(uuid).
--
-- Who can do what
--   Everyone in the organization : read who is in which workspace.
--   Owner / admin                : put people in a workspace, move them,
--                                  take them out.
-- ============================================================================

create table if not exists public.hr_person_workspaces (
  organization_id  uuid not null,
  user_id          uuid not null,                         -- the person
  workspace_id     uuid not null
                     references public.workspaces(workspace_id) on delete cascade,
  assigned_by      uuid,                                  -- who last changed it
  updated_at       timestamptz default now(),
  primary key (organization_id, user_id)
);

-- "Everyone in this workspace" is the lookup every HR tab makes.
create index if not exists idx_hr_person_workspaces_workspace
  on public.hr_person_workspaces (workspace_id);

alter table public.hr_person_workspaces enable row level security;

grant select, insert, update, delete on table public.hr_person_workspaces to authenticated;
grant all on table public.hr_person_workspaces to service_role;

drop policy if exists "hr_person_workspaces_select" on public.hr_person_workspaces;
drop policy if exists "hr_person_workspaces_insert" on public.hr_person_workspaces;
drop policy if exists "hr_person_workspaces_update" on public.hr_person_workspaces;
drop policy if exists "hr_person_workspaces_delete" on public.hr_person_workspaces;

create policy "hr_person_workspaces_select"
  on public.hr_person_workspaces for select to authenticated
  using (public.is_org_member(organization_id));

-- A person can only be put in a workspace of the same organization.
create policy "hr_person_workspaces_insert"
  on public.hr_person_workspaces for insert to authenticated
  with check (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.workspaces w
      where w.workspace_id = hr_person_workspaces.workspace_id
        and w.organization_id = hr_person_workspaces.organization_id
    )
  );

create policy "hr_person_workspaces_update"
  on public.hr_person_workspaces for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.workspaces w
      where w.workspace_id = hr_person_workspaces.workspace_id
        and w.organization_id = hr_person_workspaces.organization_id
    )
  );

create policy "hr_person_workspaces_delete"
  on public.hr_person_workspaces for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- Open HR pages pick up a change straight away.
do $$
begin
  alter publication supabase_realtime add table public.hr_person_workspaces;
exception
  when others then null; -- already in the publication
end $$;

-- Make the new table visible to the API straight away.
notify pgrst, 'reload schema';
