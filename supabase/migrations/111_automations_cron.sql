-- 111_automations_cron.sql
-- Until now the crm-run-automations edge function only ran when a browser
-- tab was open (App.tsx + useAutomations both poll every 30s with
-- kickAutomationWorker). That means: close the laptop, an event queues
-- in automation_events, and the recipe never fires until someone opens
-- the app again. Reps reasonably reported "automations don't work."
--
-- This migration schedules the function server-side via pg_cron so
-- automation_events get drained on a steady cadence regardless of whether
-- anyone has the app open.

-- pg_cron + pg_net should already be enabled by Supabase; the create
-- extension is idempotent and safe to re-run.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Helper: invoke the crm-run-automations function with the service role
-- key. The function URL + key live in the database via the
-- vault.decrypted_secrets table (preferred) OR a one-off settings table
-- if vault isn't available in this project — both paths are guarded so
-- the migration doesn't crash on smaller projects.
create or replace function public.crm_kick_automation_worker()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_key text;
begin
  -- Resolve project URL + service role key. Two storage paths supported:
  --   1) Supabase Vault (recommended)        : vault.decrypted_secrets
  --   2) Per-org app_secrets KV table        : public.app_secrets(key,value)
  -- If neither has the values, the cron will no-op with a NOTICE — reps
  -- can still drive the worker from the app's 30s polling.
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_url := null; v_key := null;
  end;

  if v_url is null then
    begin
      select value into v_url from public.app_secrets where key = 'project_url';
      select value into v_key from public.app_secrets where key = 'service_role_key';
    exception when others then null;
    end;
  end if;

  if v_url is null or v_key is null then
    raise notice 'crm_kick_automation_worker: project_url or service_role_key not configured; skipping.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/crm-run-automations',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('force', true)
  );
end;
$$;

-- Optional KV table for projects that don't use Vault yet. Owner of the
-- project supplies the secrets here once; the cron picks them up.
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- Reps must never read this table, but admins managing the project may
-- need to during initial setup.
alter table public.app_secrets enable row level security;
drop policy if exists "app_secrets_no_one" on public.app_secrets;
create policy "app_secrets_no_one"
  on public.app_secrets for all to authenticated using (false) with check (false);

-- Schedule the cron every minute. Drop+create so re-running the migration
-- doesn't stack duplicate schedules.
do $$
begin
  perform cron.unschedule('crm_automation_worker_minute');
exception when others then null;
end $$;

select cron.schedule(
  'crm_automation_worker_minute',
  '* * * * *',
  $$ select public.crm_kick_automation_worker(); $$
);
