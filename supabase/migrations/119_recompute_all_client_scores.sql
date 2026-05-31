-- 119_recompute_all_client_scores.sql
--
-- Auto-recompute fires on every client INSERT/UPDATE (migration 060
-- trigger clients_score_after_change_t), but ORGS THAT ADDED SCORING
-- RULES AFTER CREATING ACCOUNTS end up with a bunch of stale rows
-- still sitting at score=0, band='cold' because no row event has
-- fired since.
--
-- Same problem after editing rules: existing accounts don't reflect
-- the new rule until they're individually touched.
--
-- This adds a one-shot batch RPC the Lead Scoring settings page
-- exposes as a "Recompute all" button. SECURITY DEFINER so a member
-- with valid org membership can fire it without needing direct
-- write access to clients.

create or replace function public.recompute_all_client_scores(p_organization_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_count int := 0;
  r record;
begin
  -- Only org members can recompute their own org's scores.
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of organization %', p_organization_id
      using errcode = '42501';
  end if;
  -- Avoid the "unused variable" warning when running outside an
  -- auth.uid() context (e.g. service-role smoke tests).
  perform v_caller;

  for r in
    select client_id
      from public.clients
     where organization_id = p_organization_id
  loop
    -- recompute_client_score is idempotent + already SECURITY DEFINER.
    perform public.recompute_client_score(r.client_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_all_client_scores(uuid) to authenticated;
