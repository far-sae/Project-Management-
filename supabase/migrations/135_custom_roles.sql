-- 135_custom_roles.sql
-- Owner-defined roles with per-page access (No access / View / Edit).
-- `permissions` is a jsonb map of { "<pageKey>": "view" | "edit" } — an absent
-- key means no access to that page. A member is assigned a role by storing
-- `customRoleId` on their entry in organizations.members (jsonb, no schema
-- change). Owner is always full and ignores roles entirely (resolved in app).
--
-- v1 enforcement is app-layer (sidebar + route + edit-control gating); these
-- rows are read by the client to resolve a member's page access. Underlying
-- data keeps its existing org/row-level rules. Per-page DB RLS is future work.

create table if not exists public.custom_roles (
  role_id          uuid not null default gen_random_uuid() primary key,
  organization_id  uuid not null references public.organizations(organization_id) on delete cascade,
  name             text not null,
  description      text,
  permissions      jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_custom_roles_org
  on public.custom_roles(organization_id);

alter table public.custom_roles enable row level security;

grant select, insert, update, delete on table public.custom_roles to authenticated;

drop policy if exists "members_view_custom_roles"  on public.custom_roles;
drop policy if exists "admin_manage_custom_roles"   on public.custom_roles;

-- Any org member may READ their org's roles (so the client can resolve the
-- current user's own page access + render the matrix). Only owner/admin write.
create policy "members_view_custom_roles" on public.custom_roles
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy "admin_manage_custom_roles" on public.custom_roles
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));
