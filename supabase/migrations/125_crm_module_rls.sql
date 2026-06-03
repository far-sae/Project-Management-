-- 125_crm_module_rls.sql
-- Gate every Deals + Leads table behind has_module_access(). Replaces the open
-- "is_org_member can read" + per-record/owner-admin write policies with
-- module-level view/edit grants. Owner/admin still bypass (inside the helper).
-- BEHAVIOR CHANGE: members can no longer read/create/edit deals or leads
-- without an explicit grant; an "edit" grant lets them edit ALL records in the
-- module (module-level, not per-record).

set search_path = public, pg_catalog;

-- ── DEALS ────────────────────────────────────────────────────────────────────
drop policy if exists "members_view_deals"         on public.deals;
drop policy if exists "members_create_deals"        on public.deals;
drop policy if exists "deal_owner_edit_own"         on public.deals;
drop policy if exists "owner_or_admin_edit_deals"   on public.deals;
drop policy if exists "owner_or_admin_delete_deals" on public.deals;

create policy "deals_view" on public.deals for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));
create policy "deals_insert" on public.deals for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'deals', true));
create policy "deals_update" on public.deals for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'deals', true));
create policy "deals_delete" on public.deals for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', true));

-- Deals-module config tables: read gated by deals-view; writes already go
-- through admin-gated SECURITY DEFINER funcs, so only the read policy changes.
drop policy if exists "pipelines read for org members" on public.pipelines;
create policy "pipelines read for org members" on public.pipelines for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

drop policy if exists "pipeline_stages read for org members" on public.pipeline_stages;
create policy "pipeline_stages read for org members" on public.pipeline_stages for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

drop policy if exists "crm_project_templates read for org members" on public.crm_project_templates;
create policy "crm_project_templates read for org members" on public.crm_project_templates for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'deals', false));

-- ── LEADS ────────────────────────────────────────────────────────────────────
drop policy if exists "members_view_leads"          on public.leads;
drop policy if exists "members_insert_leads"         on public.leads;
drop policy if exists "author_or_admin_update_leads" on public.leads;
drop policy if exists "author_or_admin_delete_leads" on public.leads;

create policy "leads_view" on public.leads for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));
create policy "leads_insert" on public.leads for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "leads_update" on public.leads for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "leads_delete" on public.leads for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true));

drop policy if exists "members_view_lead_notes"          on public.lead_notes;
drop policy if exists "members_insert_lead_notes"         on public.lead_notes;
drop policy if exists "author_or_admin_update_lead_notes" on public.lead_notes;
drop policy if exists "author_or_admin_delete_lead_notes" on public.lead_notes;

create policy "lead_notes_view" on public.lead_notes for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));
create policy "lead_notes_insert" on public.lead_notes for insert to authenticated
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "lead_notes_update" on public.lead_notes for update to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true))
  with check (public.has_module_access(auth.uid(), organization_id, 'leads', true));
create policy "lead_notes_delete" on public.lead_notes for delete to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', true));

-- Leads-module config / read tables: read gated by leads-view; writes unchanged
-- (admin policy / SECURITY DEFINER edge fn).
drop policy if exists "lead_forms read for org members" on public.lead_forms;
create policy "lead_forms read for org members" on public.lead_forms for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "form_submissions read for org members" on public.form_submissions;
create policy "form_submissions read for org members" on public.form_submissions for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "rules read for org members" on public.lead_scoring_rules;
create policy "rules read for org members" on public.lead_scoring_rules for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

drop policy if exists "thresholds read for org members" on public.lead_scoring_thresholds;
create policy "thresholds read for org members" on public.lead_scoring_thresholds for select to authenticated
  using (public.has_module_access(auth.uid(), organization_id, 'leads', false));

-- ── Deal-edit RPC: gate by the deals-edit grant ───────────────────────────────
-- Verbatim copy of crm_update_deal from migration 076, with ONLY the guard
-- block changed (is_org_member + is_org_viewer → has_module_access edit).
create or replace function public.crm_update_deal(
  p_organization_id uuid,
  p_deal_id uuid,
  p_patch jsonb
) returns public.deals
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.deals%rowtype;
  v_updated public.deals;
  v_client_id uuid;
  v_stage_id uuid;
  v_pipeline_id uuid;
  v_tags text[];
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.has_module_access(v_actor, p_organization_id, 'deals', true) then
    raise exception 'You do not have edit access to deals' using errcode = '42501';
  end if;

  select *
    into v_existing
  from public.deals
  where deal_id = p_deal_id
    and organization_id = p_organization_id;

  if v_existing.deal_id is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  if p_patch ? 'client_id' then
    v_client_id := nullif(p_patch->>'client_id', '')::uuid;
    if v_client_id is not null and not exists (
      select 1
      from public.clients
      where client_id = v_client_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Client does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_client_id := v_existing.client_id;
  end if;

  if p_patch ? 'stage_id' then
    v_stage_id := nullif(p_patch->>'stage_id', '')::uuid;
    if v_stage_id is not null and not exists (
      select 1
      from public.pipeline_stages
      where stage_id = v_stage_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Pipeline stage does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_stage_id := v_existing.stage_id;
  end if;

  if p_patch ? 'pipeline_id' then
    v_pipeline_id := nullif(p_patch->>'pipeline_id', '')::uuid;
    if v_pipeline_id is not null and not exists (
      select 1
      from public.pipelines
      where pipeline_id = v_pipeline_id
        and organization_id = p_organization_id
    ) then
      raise exception 'Pipeline does not belong to this organization' using errcode = '23503';
    end if;
  else
    v_pipeline_id := v_existing.pipeline_id;
  end if;

  if v_stage_id is not null and v_pipeline_id is not null and not exists (
    select 1
    from public.pipeline_stages
    where stage_id = v_stage_id
      and pipeline_id = v_pipeline_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Pipeline stage does not belong to the selected pipeline' using errcode = '23503';
  end if;

  if p_patch ? 'tags' then
    if jsonb_typeof(p_patch->'tags') = 'array' then
      select coalesce(array_agg(value), '{}'::text[])
        into v_tags
      from jsonb_array_elements_text(p_patch->'tags') as tag_value(value);
    else
      v_tags := '{}'::text[];
    end if;
  else
    v_tags := v_existing.tags;
  end if;

  update public.deals
  set
    client_id = case when p_patch ? 'client_id' then v_client_id else client_id end,
    client_name = case when p_patch ? 'client_name' then nullif(btrim(p_patch->>'client_name'), '') else client_name end,
    title = case when p_patch ? 'title' then nullif(btrim(p_patch->>'title'), '') else title end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch->>'description'), '') else description end,
    stage = case when p_patch ? 'stage' then nullif(btrim(p_patch->>'stage'), '') else stage end,
    value = case when p_patch ? 'value' then coalesce(nullif(p_patch->>'value', '')::numeric, 0) else value end,
    currency = case when p_patch ? 'currency' then upper(coalesce(nullif(btrim(p_patch->>'currency'), ''), currency)) else currency end,
    probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::int else probability end,
    expected_close_date = case when p_patch ? 'expected_close_date' then nullif(p_patch->>'expected_close_date', '')::date else expected_close_date end,
    actual_close_date = case when p_patch ? 'actual_close_date' then nullif(p_patch->>'actual_close_date', '')::date else actual_close_date end,
    owner_id = case when p_patch ? 'owner_id' then nullif(p_patch->>'owner_id', '')::uuid else owner_id end,
    owner_name = case when p_patch ? 'owner_name' then nullif(btrim(p_patch->>'owner_name'), '') else owner_name end,
    source = case when p_patch ? 'source' then nullif(btrim(p_patch->>'source'), '') else source end,
    tags = v_tags,
    position = case when p_patch ? 'position' then nullif(p_patch->>'position', '')::numeric else position end,
    loss_reason = case when p_patch ? 'loss_reason' then nullif(btrim(p_patch->>'loss_reason'), '') else loss_reason end,
    pipeline_id = case when p_patch ? 'pipeline_id' then v_pipeline_id else pipeline_id end,
    stage_id = case when p_patch ? 'stage_id' then v_stage_id else stage_id end
  where deal_id = p_deal_id
    and organization_id = p_organization_id
  returning * into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.crm_update_deal(uuid, uuid, jsonb) to authenticated;
