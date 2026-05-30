-- 112_automation_enqueue_definer.sql
-- The automation_enqueue_* trigger functions from migrations 065 + 077
-- run as the invoking user. They INSERT into public.automation_events,
-- which has RLS enabled but no INSERT policy (events are owned by the
-- service role + the worker). Result: any rep create/update on
-- clients / deals / tasks / workspaces / projects / form_submissions
-- bombs with
--   ERROR: 42501: new row violates row-level security policy for
--          table "automation_events"
-- and the user's create rolls back through the trigger.
--
-- Fix: promote each function to SECURITY DEFINER so it runs as its
-- owner (postgres / the migration runner), which bypasses RLS on
-- automation_events. The function bodies are unchanged — we only flip
-- the security mode and pin search_path so the definer context is safe.
-- This is the standard pattern for "system" triggers that need to
-- write to a service-role-only table.

alter function public.automation_enqueue_deal_update()       security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_client_insert()     security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_client_update()     security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_form_submission()   security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_workspace_insert()  security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_project_insert()    security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_task_insert()       security definer set search_path = public, pg_catalog;
alter function public.automation_enqueue_task_update()       security definer set search_path = public, pg_catalog;
