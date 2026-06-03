-- 124_crm_module_grants.sql
-- Per-member access to CRM modules (deals, leads). Absence of a row = no
-- access. level='edit' implies view. Owner/admin bypass these rows entirely
-- (see has_module_access). Enforced in RLS on the deals/leads tables (125).

create table if not exists public.crm_module_grants (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  module          text not null check (module in ('deals','leads')),
  level           text not null check (level in ('view','edit')),
  granted_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id, module)
);

create index if not exists idx_crm_module_grants_user
  on public.crm_module_grants(user_id, organization_id);

alter table public.crm_module_grants enable row level security;

grant select, insert, update, delete on table public.crm_module_grants to authenticated;

drop policy if exists "members_view_grants" on public.crm_module_grants;
drop policy if exists "admin_manage_grants"  on public.crm_module_grants;

-- Any org member may READ grants in their org (so the UI can render the matrix
-- + the current user's own access). Only owner/admin may write.
create policy "members_view_grants" on public.crm_module_grants
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy "admin_manage_grants" on public.crm_module_grants
  for all to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ── Helpers ──────────────────────────────────────────────────────────────
-- User-explicit admin/owner check (mirrors is_org_member_for from migration 083).
create or replace function public.is_org_admin_or_owner_for(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organizations o
    where o.organization_id = p_org_id
      and (
        o.owner_id = p_user_id
        or exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = p_user_id
            and (m->>'role') in ('owner','admin')
        )
      )
  );
$$;

revoke execute on function public.is_org_admin_or_owner_for(uuid, uuid) from public, anon;
grant execute on function public.is_org_admin_or_owner_for(uuid, uuid) to authenticated, service_role;

-- The single gate used by every Deals/Leads RLS policy.
-- owner/admin → always true; else require a grant row of sufficient level.
create or replace function public.has_module_access(
  p_user_id uuid, p_org_id uuid, p_module text, p_need_edit boolean
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    public.is_org_admin_or_owner_for(p_user_id, p_org_id)
    or exists (
      select 1 from public.crm_module_grants g
      where g.organization_id = p_org_id
        and g.user_id = p_user_id
        and g.module = p_module
        and (not p_need_edit or g.level = 'edit')
    );
$$;

revoke execute on function public.has_module_access(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.has_module_access(uuid, uuid, text, boolean) to authenticated, service_role;
