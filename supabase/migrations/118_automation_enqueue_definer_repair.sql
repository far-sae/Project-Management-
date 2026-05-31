-- 118_automation_enqueue_definer_repair.sql
--
-- Self-healing repair for the SECURITY DEFINER ALTER applied in
-- migration 112. The user is still seeing
--   ERROR: 42501: new row violates row-level security policy for
--          table "automation_events"
-- in production, which means 112 either didn't run or a newer trigger
-- function snuck in after it that isn't covered.
--
-- This migration discovers every public.automation_enqueue_* function
-- at apply time and idempotently ALTERs each one to SECURITY DEFINER
-- with a pinned search_path. Re-running the migration is safe (ALTER
-- FUNCTION on something already SECURITY DEFINER is a no-op), and
-- future-proof — any new automation_enqueue_* function added later
-- gets the right setting when the migration is re-run.
--
-- Why SECURITY DEFINER is required:
--   * automation_events has RLS enabled with NO insert policy (events
--     are owned by the service role + the worker; reps don't write
--     directly).
--   * The enqueue triggers fire on AFTER INSERT/UPDATE of clients /
--     deals / tasks / workspaces / projects / form_submissions —
--     under the inserting USER's role.
--   * Without SECURITY DEFINER, the trigger's INSERT into
--     automation_events runs as the user, hits the RLS gate, and
--     rolls the whole transaction back. Net effect: members can't
--     even create a Client / Deal / Task. Critical.
--
-- The function bodies themselves are untouched.

do $$
declare
  r record;
begin
  for r in
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ident
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'automation_enqueue%'
  loop
    -- ALTER FUNCTION is idempotent w.r.t. SECURITY DEFINER + search_path:
    -- if the function already has them set, this is a no-op.
    execute format(
      'alter function %s security definer set search_path = public, pg_catalog',
      r.ident
    );
    raise notice 'Hardened % to SECURITY DEFINER', r.ident;
  end loop;
end
$$;
