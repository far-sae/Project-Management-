-- Fix: every new signup is stuck on "Loading your workspace…".
--
-- Migration 143 dropped the old CRM tables (lead_scoring_thresholds,
-- lead_scoring_rules, pipelines, pipeline_stages, crm_project_templates) but
-- left behind the two AFTER INSERT triggers on public.organizations that seed
-- those tables for each new org:
--   lead_scoring_seed_on_org_insert_t -> seed_lead_scoring_for_org
--   pipelines_seed_on_org_insert_t    -> seed_default_pipeline_for_org
--
-- plpgsql bodies are not tracked as dependencies, so `drop table ... cascade`
-- did not remove them. On signup, ensureOrganizationExists() inserts into
-- organizations, the trigger hits the missing table, Postgres raises 42P01
-- ("relation public.lead_scoring_thresholds does not exist"), PostgREST
-- returns 404, the org insert rolls back, and the user never gets an org.
-- Existing users are unaffected because their org already exists.
--
-- Nothing in the current app uses these seeds; the new CRM hub seeds its own
-- stages on demand via crm_seed_default_stages().

drop trigger if exists lead_scoring_seed_on_org_insert_t on public.organizations;
drop trigger if exists pipelines_seed_on_org_insert_t    on public.organizations;

drop function if exists public.lead_scoring_seed_on_org_insert();
drop function if exists public.pipelines_seed_on_org_insert();
drop function if exists public.seed_lead_scoring_for_org(uuid);
drop function if exists public.seed_default_pipeline_for_org(uuid);

notify pgrst, 'reload schema';
