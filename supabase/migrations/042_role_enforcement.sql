-- Server-side enforcement for the role gates the app already enforces in UI.
--
-- Background: the React app hides "New project", "New workspace", and task
-- edit/delete buttons from members. That's good UX but a determined member
-- could still call PostgREST directly. This migration locks those operations
-- at the database layer.
--
--  • projects   : only org owner + admin can INSERT or DELETE
--  • workspaces : only org owner + admin can INSERT or DELETE
--  • tasks      : UPDATE/DELETE allowed for creator, assignee, project
--                 owner, OR org admin/owner (new) — not other plain members
--
-- Relies on `is_org_admin_or_owner(uuid)` from migration 036.

-- ---------------------------------------------------------------------------
-- projects: trigger-based gate (RLS isn't enabled on `projects`, so a trigger
-- is the safest non-disruptive way to enforce this without touching every
-- existing read path).
-- ---------------------------------------------------------------------------
create or replace function public.projects_enforce_admin_create_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  if TG_OP = 'INSERT' then
    v_org := new.organization_id;
  else
    v_org := old.organization_id;
  end if;

  -- No org id (legacy / local-only data, or service-role inserts that null
  -- the column) — let it through; admin-tools should bypass anyway.
  if v_org is null then
    return coalesce(new, old);
  end if;

  -- Skip the check when no auth context is present (e.g. service role,
  -- migrations, seed scripts). Real client calls always carry auth.uid().
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if not public.is_org_admin_or_owner(v_org) then
    if TG_OP = 'INSERT' then
      raise exception 'Only the organization owner or an admin can create a project.'
        using errcode = '42501';
    else
      raise exception 'Only the organization owner or an admin can delete a project.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists projects_enforce_admin_create_delete_trg on public.projects;
create trigger projects_enforce_admin_create_delete_trg
  before insert or delete on public.projects
  for each row
  execute function public.projects_enforce_admin_create_delete();

-- ---------------------------------------------------------------------------
-- workspaces: same pattern as projects.
-- ---------------------------------------------------------------------------
create or replace function public.workspaces_enforce_admin_create_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $fn$
declare
  v_org uuid;
begin
  if TG_OP = 'INSERT' then
    v_org := new.organization_id;
  else
    v_org := old.organization_id;
  end if;

  if v_org is null then
    return coalesce(new, old);
  end if;

  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if not public.is_org_admin_or_owner(v_org) then
    if TG_OP = 'INSERT' then
      raise exception 'Only the organization owner or an admin can create a workspace.'
        using errcode = '42501';
    else
      raise exception 'Only the organization owner or an admin can delete a workspace.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists workspaces_enforce_admin_create_delete_trg on public.workspaces;
create trigger workspaces_enforce_admin_create_delete_trg
  before insert or delete on public.workspaces
  for each row
  execute function public.workspaces_enforce_admin_create_delete();

-- ---------------------------------------------------------------------------
-- tasks: extend the existing UPDATE/DELETE policies so org owner+admin can
-- always edit/delete (covers cleanup + cross-project moderation), while plain
-- members are still locked to their own / assigned tasks.
--
-- These helpers were originally created in migration 006, but some remote DBs
-- never received them (or had them dropped). Re-defining here makes 042
-- self-contained — `create or replace` is a safe no-op if they already exist
-- with the same signature.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_user_is_assignee(assignees jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(assignees, '[]'::jsonb)) elem
    where coalesce(elem->>'userId', elem->>'user_id') = auth.uid()::text
  );
$$;

create or replace function public.tasks_user_is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.projects p
    where p.project_id = p_project_id and p.owner_id = auth.uid()
  );
$$;

create or replace function public.tasks_user_is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when p_org is null then false
    else public.is_org_admin_or_owner(p_org)
  end;
$$;

grant execute on function public.tasks_user_is_assignee(jsonb)    to anon, authenticated;
grant execute on function public.tasks_user_is_project_owner(uuid) to anon, authenticated;
grant execute on function public.tasks_user_is_org_admin(uuid)    to anon, authenticated;

-- Make sure RLS is on (006 enabled it, but if 006 was skipped this matters).
alter table if exists public.tasks enable row level security;

drop policy if exists "tasks_update_authorized" on public.tasks;
create policy "tasks_update_authorized" on public.tasks
  for update
  using (
    auth.uid() is not null
    and (
      coalesce(is_locked, false) = false
      or created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  )
  with check (
    auth.uid() is not null
    and (
      created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  );

drop policy if exists "tasks_delete_authorized" on public.tasks;
create policy "tasks_delete_authorized" on public.tasks
  for delete
  using (
    auth.uid() is not null
    and (
      created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
      or public.tasks_user_is_org_admin(organization_id)
    )
  );
