-- 121_send_test_automation_event.sql
--
-- Diagnostic helper for the Automations settings tab: drops a no-op
-- 'manual_test' event into automation_events so reps can verify the
-- queue is alive and the worker is processing rows.
--
-- Why this needs an RPC instead of a client-side INSERT:
--   automation_events has RLS enabled with NO insert policy for
--   authenticated roles — events are owned by the service role + the
--   worker. A direct supabase.from('automation_events').insert(...)
--   from the browser fails with 42501 (the same RLS gate migration
--   118 fixed for trigger-driven inserts). SECURITY DEFINER lets the
--   RPC slip the gate after an org-membership check.
--
-- The event uses event_type='manual_test' which no recipe matches.
-- The worker drains it and bumps the "processed" counter on the
-- health panel WITHOUT firing any actions, so reps can prove the
-- whole pipeline is alive without sending a real email.

create or replace function public.send_test_automation_event(
  p_organization_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_event_id uuid;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of organization %', p_organization_id
      using errcode = '42501';
  end if;
  insert into public.automation_events (
    organization_id, event_type, payload, source_table, source_id
  ) values (
    p_organization_id, 'manual_test',
    jsonb_build_object('test', true, 'sent_at', now()),
    'manual_test', null
  )
  returning event_id into v_event_id;
  return v_event_id;
end;
$$;

grant execute on function public.send_test_automation_event(uuid) to authenticated;
