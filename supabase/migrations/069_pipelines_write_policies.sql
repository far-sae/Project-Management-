-- supabase/migrations/069_pipelines_write_policies.sql
-- Migration 058 enabled RLS on pipelines + pipeline_stages but only added
-- SELECT policies, with a comment claiming writes would go through
-- SECURITY DEFINER functions. The actual frontend services
-- (createPipeline, updatePipeline, deletePipeline in
-- src/services/supabase/pipelines.ts) do direct table writes — which RLS
-- silently rejects. End result: clicking "Add pipeline" or renaming a
-- pipeline did nothing. This migration adds the missing write policies,
-- gated by is_org_admin_or_owner so members/viewers still can't write.

begin;

-- ============================================================
-- pipelines: insert / update / delete for org admins+owners
-- ============================================================
drop policy if exists "pipelines write for org admins" on public.pipelines;
create policy "pipelines write for org admins"
  on public.pipelines for all
  to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ============================================================
-- pipeline_stages: same gate. crm_replace_pipeline_stages is a
-- SECURITY DEFINER RPC and bypasses RLS, but bare direct writes
-- (used by some quick edits) need policies too.
-- ============================================================
drop policy if exists "pipeline_stages write for org admins" on public.pipeline_stages;
create policy "pipeline_stages write for org admins"
  on public.pipeline_stages for all
  to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

-- ============================================================
-- crm_project_templates: same — referenced from PipelinesSettingsTab
-- when admins manage per-pipeline project templates.
-- ============================================================
drop policy if exists "crm_project_templates write for org admins" on public.crm_project_templates;
create policy "crm_project_templates write for org admins"
  on public.crm_project_templates for all
  to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

commit;
