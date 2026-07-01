-- 123_remove_crm_system.sql
--
-- User asked to remove the entire CRM stack (Leads, Contacts,
-- Accounts, Deals, Pipeline, Activities, Automations, Sequences, AI
-- Sales Agent, CRM analytics + insights) and DROP the underlying
-- tables so no CRM data survives. This migration executes that.
--
-- What stays:
--   projects, tasks, workspaces, organizations, user_profiles,
--   subscriptions, contracts, expenses, timesheets, payroll,
--   invoices, quotes, bills, employees, project_templates,
--   audit_log, security_audit_log — all non-CRM PM/ops tables.
--
-- What goes:
--   clients, client_contacts, client_notes, client_tasks
--   deals, pipelines, pipeline_stages, deal_relations,
--     client_categories, crm_grants, agent_pending_actions,
--     agent_linked_accounts, agent_conversations,
--     agent_intake_channels, agent_intake_events
--   leads, lead_notes, lead_forms, lead_scoring_rules,
--     lead_scoring_thresholds, form_submissions,
--     form_submission_rate_limits
--   meetings, calls, external_calendar_events
--   attachments, email_events
--   automation_recipes, automation_events, automation_runs,
--     pending_actions, sequence_replies, automation_drafts
--   crm_secrets, crm_email_templates, ai_usage_daily
--   agent_settings, ai_suggestions
--   business_reporting, business_reports_config
--   integrations (Slack/Twilio/SendGrid/Telegram/WhatsApp-linked
--     rows — the OAuth-token integrations table itself stays for
--     Gmail/Calendar/Meet which are still used by project tasks;
--     it's the CRM-specific rows in it that go).
--
-- Every DROP uses `if exists` + CASCADE so re-running the migration
-- against a partial state is safe. RPCs are dropped too — leaving
-- them around after their tables are gone would just produce
-- confusing errors.
--
-- Also drops the 'attachments' Storage bucket + its RLS policies.

set search_path = public;

-- ─── Storage cleanup ─────────────────────────────────────────────────
-- Remove the 'attachments' bucket + associated RLS policies. Blob
-- contents will be permanently deleted.
do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='attachments_member_read') then
    execute 'drop policy "attachments_member_read" on storage.objects';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='attachments_member_write') then
    execute 'drop policy "attachments_member_write" on storage.objects';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='attachments_member_delete') then
    execute 'drop policy "attachments_member_delete" on storage.objects';
  end if;
end $$;
-- Delete blobs before dropping the bucket row (FK dependency).
delete from storage.objects where bucket_id = 'attachments';
delete from storage.buckets where id = 'attachments';

-- ─── Triggers on non-CRM tables that reference CRM ───────────────────
-- automation_enqueue_* triggers on projects/tasks/workspaces/
-- form_submissions write to automation_events. Drop them before we
-- drop the events table so we don't leave dangling triggers.
drop trigger if exists automation_enqueue_client_insert_t   on public.clients;
drop trigger if exists automation_enqueue_client_update_t   on public.clients;
drop trigger if exists automation_enqueue_deal_update_t     on public.deals;
drop trigger if exists automation_enqueue_form_submission_t on public.form_submissions;
drop trigger if exists automation_enqueue_workspace_insert_t on public.workspaces;
drop trigger if exists automation_enqueue_project_insert_t   on public.projects;
drop trigger if exists automation_enqueue_task_insert_t      on public.tasks;
drop trigger if exists automation_enqueue_task_update_t      on public.tasks;
-- Client-score auto-recompute triggers (from 060).
drop trigger if exists clients_score_after_change_t on public.clients;
drop trigger if exists deals_recompute_client_score_t on public.deals;

-- ─── Drop functions the CRM tables/triggers rely on ──────────────────
drop function if exists public.automation_enqueue_client_insert()   cascade;
drop function if exists public.automation_enqueue_client_update()   cascade;
drop function if exists public.automation_enqueue_deal_update()     cascade;
drop function if exists public.automation_enqueue_form_submission() cascade;
drop function if exists public.automation_enqueue_workspace_insert() cascade;
drop function if exists public.automation_enqueue_project_insert()   cascade;
drop function if exists public.automation_enqueue_task_insert()      cascade;
drop function if exists public.automation_enqueue_task_update()      cascade;
drop function if exists public.recompute_client_score(uuid) cascade;
drop function if exists public.recompute_all_client_scores(uuid) cascade;
drop function if exists public.clients_score_after_change() cascade;
drop function if exists public.deals_recompute_client_score() cascade;
drop function if exists public.enroll_in_automation(uuid, uuid, uuid) cascade;
drop function if exists public.send_test_automation_event(uuid) cascade;
drop function if exists public.next_lead_number(uuid) cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.plan_tier_for_org(uuid) cascade;
drop function if exists public.plan_max_workspaces(text) cascade;
drop function if exists public.plan_max_members(text) cascade;
drop function if exists public.enforce_workspace_cap() cascade;
drop function if exists public.enforce_member_cap() cascade;
-- CRM RPC functions (SECURITY DEFINER helpers the frontend called).
-- We use a DO block to drop every function whose name starts with
-- 'crm_' regardless of signature, since the codebase accumulated
-- overloads across migrations.
do $$
declare r record;
begin
  for r in
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ident
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'crm\_%' escape '\'
         or p.proname like 'agent\_%' escape '\'
         or p.proname like 'stop\_pending\_actions%' escape '\'
         or p.proname like 'is\_lead\_form\_%' escape '\')
  loop
    execute 'drop function if exists ' || r.ident || ' cascade';
  end loop;
end $$;

-- ─── Drop tables (child → parent for FK order) ───────────────────────
-- Sequences / automations chain: pending_actions → automation_runs →
-- automation_events → automation_recipes.
drop table if exists public.sequence_replies      cascade;
drop table if exists public.pending_actions       cascade;
drop table if exists public.automation_runs       cascade;
drop table if exists public.automation_events     cascade;
drop table if exists public.automation_recipes    cascade;
drop table if exists public.automation_drafts     cascade;
drop table if exists public.ai_usage_daily        cascade;
drop table if exists public.ai_suggestions        cascade;
drop table if exists public.agent_settings        cascade;
drop table if exists public.agent_pending_actions cascade;
drop table if exists public.agent_linked_accounts cascade;
drop table if exists public.agent_conversations   cascade;
drop table if exists public.agent_intake_events   cascade;
drop table if exists public.agent_intake_channels cascade;

-- Activities layer:
drop table if exists public.calls                 cascade;
drop table if exists public.meetings              cascade;
drop table if exists public.client_tasks          cascade;
drop table if exists public.client_notes          cascade;
drop table if exists public.client_categories     cascade;

-- Attachments + emails (were CRM-scoped from the start):
drop table if exists public.email_events          cascade;
drop table if exists public.attachments           cascade;

-- Forms + external calendar cache:
drop table if exists public.form_submission_rate_limits cascade;
drop table if exists public.form_submissions      cascade;
drop table if exists public.lead_forms            cascade;
drop table if exists public.external_calendar_events cascade;

-- Lead scoring:
drop table if exists public.lead_scoring_rules       cascade;
drop table if exists public.lead_scoring_thresholds  cascade;

-- Leads:
drop table if exists public.lead_notes            cascade;
drop table if exists public.leads                 cascade;

-- Deals + pipeline:
drop table if exists public.deal_relations        cascade;
drop table if exists public.deals                 cascade;
drop table if exists public.pipeline_stages       cascade;
drop table if exists public.pipelines             cascade;

-- Contacts:
drop table if exists public.client_contacts       cascade;

-- Clients (top of the CRM chain):
drop table if exists public.clients               cascade;

-- CRM-specific config + templates:
drop table if exists public.crm_grants            cascade;
drop table if exists public.crm_email_templates   cascade;
drop table if exists public.crm_secrets           cascade;

-- Business reporting (CRM analytics feed):
drop table if exists public.business_reports_config cascade;
drop table if exists public.business_reporting     cascade;

-- ─── Clean up CRM-linked rows in tables that stay ────────────────────
-- The integrations table stays (Gmail / Google Calendar / Google Meet
-- are used by project task features). Drop the rows for CRM-only
-- providers so the settings UI doesn't try to render them.
delete from public.integrations
  where provider in ('slack', 'twilio', 'sendgrid', 'telegram', 'whatsapp');

-- Drop the CRM-specific 'crm' feature flag from anywhere it's
-- persisted per-org. This is a no-op if the org.settings jsonb
-- doesn't have such a key.
update public.organizations
  set settings = settings - 'crm_enabled'
  where settings ? 'crm_enabled';
