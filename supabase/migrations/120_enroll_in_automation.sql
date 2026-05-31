-- 120_enroll_in_automation.sql
--
-- Manual enrolment RPC for the automation / sequence engine.
--
-- Today, recipes fire only when a matching trigger event lands in
-- automation_events (created/tagged client, stage move, form
-- submission, etc.). There's no way for a rep to say "I want this
-- account to start this sequence NOW" without engineering a fake
-- event from outside the app.
--
-- This RPC takes a recipe + (optional) client + (optional) deal and
-- inserts a synthetic event of the recipe's own trigger_type so the
-- worker picks it up on its next tick. For triggers that don't map
-- cleanly to a client/deal context (scheduled, slack_*), this
-- inserts a minimal manual_run payload that the worker treats as a
-- one-shot.
--
-- SECURITY DEFINER + org-membership gate so members can enrol within
-- their own org without direct INSERT access to automation_events
-- (which is service-role-only).

create or replace function public.enroll_in_automation(
  p_recipe_id      uuid,
  p_client_id      uuid default null,
  p_deal_id        uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id  uuid;
  v_trigger text;
  v_payload jsonb;
  v_event_id uuid;
begin
  -- Recipe lookup + org check in one shot. RAISES if recipe doesn't
  -- exist or the caller isn't in its org.
  select organization_id, trigger_type
    into v_org_id, v_trigger
    from public.automation_recipes
   where recipe_id = p_recipe_id;
  if v_org_id is null then
    raise exception 'Recipe % not found', p_recipe_id using errcode = '22023';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'Not a member of organization %', v_org_id using errcode = '42501';
  end if;

  -- Build a payload that LOOKS like the natural trigger so action
  -- handlers (which read named fields from the payload) work without
  -- special-casing manual enrolment.
  if v_trigger in ('client_created','client_tagged') then
    if p_client_id is null then
      raise exception 'client_id is required for trigger %', v_trigger
        using errcode = '22023';
    end if;
    v_payload := jsonb_build_object('client_id', p_client_id, 'manual', true);
  elsif v_trigger in ('deal_stage_entered','deal_score_band_changed','deal_field_changed') then
    if p_deal_id is null then
      raise exception 'deal_id is required for trigger %', v_trigger
        using errcode = '22023';
    end if;
    v_payload := jsonb_build_object('deal_id', p_deal_id, 'manual', true);
  else
    -- scheduled / slack / agent_intake / etc. — no canonical
    -- shape; pass through whatever IDs the caller gave + the manual
    -- flag so action handlers can branch if needed.
    v_payload := jsonb_build_object(
      'client_id', p_client_id,
      'deal_id', p_deal_id,
      'manual', true
    );
  end if;

  insert into public.automation_events (
    organization_id, event_type, payload, source_table, source_id
  ) values (
    v_org_id, v_trigger, v_payload, 'manual_enrollment', p_recipe_id
  )
  returning event_id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.enroll_in_automation(uuid, uuid, uuid) to authenticated;
