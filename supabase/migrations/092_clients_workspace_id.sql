-- 092_clients_workspace_id.sql
-- Scope clients to a workspace so each workspace gets its own client list.
-- Existing rows are backfilled to each org's default workspace (or its first
-- workspace by created_at if no default exists). Orgs with clients but no
-- workspaces get a freshly created default workspace before backfill so the
-- final NOT NULL constraint can succeed.
--
-- Deals deliberately do NOT get their own workspace_id — they follow the
-- linked client's workspace. The app's Pipeline tab filters deals by
-- intersecting with the workspace-scoped client list, so no schema change is
-- required there.

-- 1. Add the column nullable so the backfill has room to operate.
alter table public.clients
  add column if not exists workspace_id uuid;

-- 2. Make sure every org that has clients also has at least one workspace —
--    otherwise we can't satisfy NOT NULL below. The role-enforcement trigger
--    short-circuits when auth.uid() is null (this migration runs without auth),
--    so the insert is allowed here.
do $$
declare
  r record;
begin
  for r in
    select distinct c.organization_id
    from public.clients c
    left join public.workspaces w on w.organization_id = c.organization_id
    where w.workspace_id is null
  loop
    insert into public.workspaces (workspace_id, name, organization_id, is_default, created_at, updated_at)
    values (gen_random_uuid(), 'Default', r.organization_id, true, now(), now());
  end loop;
end $$;

-- 3. Backfill existing client rows. Prefer the org's default workspace; fall
--    back to the oldest workspace in the org.
update public.clients c
set workspace_id = sub.workspace_id
from (
  select distinct on (organization_id)
    organization_id,
    workspace_id
  from public.workspaces
  order by organization_id, is_default desc nulls last, created_at asc
) sub
where c.workspace_id is null
  and sub.organization_id = c.organization_id;

-- 4. Lock it down. If any client is still unassigned at this point, the
--    migration intentionally fails — it means data is in an inconsistent
--    state that needs operator review.
alter table public.clients
  alter column workspace_id set not null;

-- 5. FK on delete restrict — deleting a workspace that still owns clients
--    should fail loudly so the operator moves the clients first.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_workspace_id_fkey'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_workspace_id_fkey
      foreign key (workspace_id)
      references public.workspaces(workspace_id)
      on delete restrict;
  end if;
end $$;

-- 6. Composite index so "all clients in this workspace" stays a single seek.
create index if not exists idx_clients_org_workspace
  on public.clients (organization_id, workspace_id);
