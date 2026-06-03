-- 127_crm_view_default.sql
-- Decision (research-backed, 2026-06-03): members get VIEW on Deals/Leads by
-- DEFAULT, not None. No benchmarked CRM (Salesforce, HubSpot, Zoho, Pipedrive,
-- Attio) defaults a member to zero access — the restrictive camp defaults to
-- view+edit-own, the permissive camp to view+edit-all. We split the difference:
-- read-all by default, edit is least-privilege (owner/admin or an explicit
-- 'edit' grant). This matches Salesforce "Public Read Only" / Zoho view-only.
--
-- Redefines has_module_access:
--   view (p_need_edit=false) → any org member (default-open read)
--   edit (p_need_edit=true)  → owner/admin, or an 'edit' grant row
-- RLS policies on deals/leads/etc. call this helper, so no policy changes are
-- needed. 'view'-level grant rows become redundant (view is the default); the
-- Team matrix now only writes 'edit' rows (View = no row).

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
  end;
$$;
