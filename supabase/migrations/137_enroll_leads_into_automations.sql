-- 137_enroll_leads_into_automations.sql
--
-- Lead enrolment for the automation / campaign engine.
--
-- Until now enroll_in_automation (migration 120) only understood
-- clients and deals. Campaigns built by the AI agent target LEADS,
-- organised by category — so there was no way to start an outreach
-- sequence for "every lead in the Enterprise category". This migration:
--
--   1. Extends enroll_in_automation with an optional p_lead_id so a
--      single lead can be enrolled (used by the lead detail UI later).
--   2. Adds enroll_segment_in_automation(recipe, category) which enrols
--      EVERY mailable lead in a category in one server-side call —
--      this is what the agent's create_campaign action calls so the
--      campaign auto-enrols its target segment on creation.
--
-- Both insert synthetic automation_events the worker picks up on its
-- next tick. Lead events carry {lead_id, manual:true}; the send_email
-- action (sendEmail.ts) resolves the lead's address from `lead_email`.
--
-- SECURITY DEFINER + org-membership gate, same as 120 — members enrol
-- within their own org without direct INSERT on automation_events.

-- ── 1. Extend enroll_in_automation with p_lead_id ───────────────────
-- Drop the 3-arg version first; the new 4-arg one (p_lead_id defaulted)
-- still resolves the existing client/deal call sites unchanged.
drop function if exists public.enroll_in_automation(uuid, uuid, uuid);

create or replace function public.enroll_in_automation(
  p_recipe_id      uuid,
  p_client_id      uuid default null,
  p_deal_id        uuid default null,
  p_lead_id        uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id   uuid;
  v_trigger  text;
  v_payload  jsonb;
  v_event_id uuid;
begin
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

  -- A lead enrolment is explicit: whenever a lead is supplied we build a
  -- lead-shaped payload regardless of the recipe's natural trigger, since
  -- campaigns are saved with whatever trigger the author chose.
  if p_lead_id is not null then
    v_payload := jsonb_build_object('lead_id', p_lead_id, 'manual', true);
  elsif v_trigger in ('client_created','client_tagged') then
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
    v_payload := jsonb_build_object(
      'client_id', p_client_id,
      'deal_id', p_deal_id,
      'lead_id', p_lead_id,
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

grant execute on function public.enroll_in_automation(uuid, uuid, uuid, uuid) to authenticated;

-- ── 2. Enrol a whole lead segment (by category) in one call ─────────
-- Matches leads whose category equals OR is contained in p_category
-- (so both "Enterprise" and "leads in category Enterprise" resolve),
-- skipping leads with no email or who opted out. Returns the number of
-- leads enrolled so the UI can report it.
create or replace function public.enroll_segment_in_automation(
  p_recipe_id uuid,
  p_category  text
) returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id  uuid;
  v_trigger text;
  v_count   integer := 0;
  v_lead    record;
begin
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
  if p_category is null or btrim(p_category) = '' then
    raise exception 'A target category is required' using errcode = '22023';
  end if;

  for v_lead in
    select l.lead_id
      from public.leads l
     where l.organization_id = v_org_id
       and l.category is not null
       and btrim(l.category) <> ''
       and (
         lower(btrim(l.category)) = lower(btrim(p_category))
         or lower(btrim(p_category)) like '%' || lower(btrim(l.category)) || '%'
       )
       and l.email is not null
       and btrim(l.email) <> ''
       and coalesce(l.email_opt_out, false) = false
  loop
    insert into public.automation_events (
      organization_id, event_type, payload, source_table, source_id
    ) values (
      v_org_id, v_trigger,
      jsonb_build_object('lead_id', v_lead.lead_id, 'manual', true),
      'segment_enrollment', p_recipe_id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.enroll_segment_in_automation(uuid, text) to authenticated;
