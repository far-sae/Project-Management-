-- CRM: "each person sees only their own leads and deals", per workspace.
--
-- Everybody who can open a workspace's CRM saw every lead and deal in it. A
-- workspace can now be switched to "own only": a member then sees the leads
-- and deals they own, the follow-ups given to them, and the timeline of those.
-- The organisation's owner and admins still see everything.
--
-- How it is done: one small table holds the switch, and one extra rule on each
-- of four tables narrows what is shown. The rules are RESTRICTIVE: they can
-- only hide rows, never show a row the existing rules do not already allow.
-- While the switch is off (the default) they hide nothing.
--
-- Not covered: companies stay visible to everybody in the workspace, and the
-- server (web forms, automation, email) is not affected.
--
-- Safe to run more than once.

create table if not exists public.crm_visibility (
  workspace_id uuid primary key references public.workspaces (workspace_id) on delete cascade,
  organization_id uuid not null references public.organizations (organization_id) on delete cascade,
  own_only boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.crm_visibility enable row level security;
revoke all on public.crm_visibility from anon, authenticated;
grant select, insert, update on public.crm_visibility to authenticated;
grant all on public.crm_visibility to service_role;

drop policy if exists "crm_visibility_read" on public.crm_visibility;
create policy "crm_visibility_read" on public.crm_visibility
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "crm_visibility_insert" on public.crm_visibility;
create policy "crm_visibility_insert" on public.crm_visibility
  for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

drop policy if exists "crm_visibility_update" on public.crm_visibility;
create policy "crm_visibility_update" on public.crm_visibility
  for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- True when the person asking may see every lead and deal of the workspace:
-- the switch is off, or they are the owner or an admin.
create or replace function public.crm_sees_all(p_org uuid, p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select v.own_only from public.crm_visibility v where v.workspace_id = p_workspace), false)
      or public.is_org_admin_or_owner(p_org);
$$;

revoke all on function public.crm_sees_all(uuid, uuid) from public, anon;
grant execute on function public.crm_sees_all(uuid, uuid) to authenticated, service_role;

drop policy if exists "crm_contacts_own_only" on public.crm_contacts;
create policy "crm_contacts_own_only" on public.crm_contacts
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or owner_id = auth.uid());

drop policy if exists "crm_deals_own_only" on public.crm_deals;
create policy "crm_deals_own_only" on public.crm_deals
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or owner_id = auth.uid());

drop policy if exists "crm_tasks_own_only" on public.crm_tasks;
create policy "crm_tasks_own_only" on public.crm_tasks
  as restrictive for select to authenticated
  using (public.crm_sees_all(organization_id, workspace_id) or assigned_to = auth.uid() or owner_id = auth.uid());

-- A timeline entry is shown to the person who wrote it, and to the owner of the
-- lead or the deal it is about.
drop policy if exists "crm_activities_own_only" on public.crm_activities;
create policy "crm_activities_own_only" on public.crm_activities
  as restrictive for select to authenticated
  using (
    public.crm_sees_all(organization_id, workspace_id)
    or user_id = auth.uid()
    or exists (select 1 from public.crm_contacts c where c.id = crm_activities.contact_id and c.owner_id = auth.uid())
    or exists (select 1 from public.crm_deals d where d.id = crm_activities.deal_id and d.owner_id = auth.uid())
  );

-- Tell the API about the new table and function straight away.
notify pgrst, 'reload schema';
