-- 139_module_access_custom_roles.sql
--
-- CRM module access (Deals/Leads) is now governed by a member's assigned
-- CUSTOM ROLE, not the per-member grant matrix (which the Team UI dropped).
-- The role stores per-page access; 'crm' = 'edit' means the member may edit
-- Deals/Leads.
--
-- This redefines has_module_access so EDIT is allowed for:
--   • owners / admins (always), OR
--   • a member whose assigned custom role grants 'crm' = 'edit', OR
--   • a legacy 'edit' grant row (kept for backward compatibility so any
--     pre-existing grants keep working until roles are assigned).
-- VIEW stays default-open for any org member (unchanged).
--
-- The member→role link is `customRoleId` on the member's entry in
-- organizations.members (jsonb); the role's permissions live in
-- custom_roles.permissions (jsonb, e.g. {"crm":"edit"}). We compare role ids
-- as TEXT to avoid casting a possibly-absent jsonb value to uuid.

create or replace function public.has_module_access(
  p_user_id uuid, p_org_id uuid, p_module text, p_need_edit boolean
) returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when not p_need_edit then public.is_org_member_for(p_user_id, p_org_id)
    else
      public.is_org_admin_or_owner_for(p_user_id, p_org_id)
      or exists (
        select 1 from public.crm_module_grants g
        where g.organization_id = p_org_id
          and g.user_id = p_user_id
          and g.module = p_module
          and g.level = 'edit'
      )
      or exists (
        select 1
        from public.organizations o
        cross join lateral jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
        join public.custom_roles cr
          on cr.organization_id = p_org_id
         and cr.role_id::text = (m->>'customRoleId')
        where o.organization_id = p_org_id
          and coalesce(m->>'userId', m->>'user_id') = p_user_id::text
          and cr.permissions->>'crm' = 'edit'
      )
  end;
$$;
