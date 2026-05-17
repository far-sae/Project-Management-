-- 078_lead_scoring_write_rpcs.sql
-- Stable write RPCs for Lead Scoring settings. Direct table writes can be
-- blocked by RLS depending on the deployment state, so the UI uses these
-- SECURITY DEFINER functions with explicit admin/member checks.

create or replace function public.crm_create_lead_scoring_rule(
  p_organization_id uuid,
  p_label text,
  p_field text,
  p_operator text,
  p_value jsonb,
  p_points int,
  p_position int default 1,
  p_enabled boolean default true
) returns public.lead_scoring_rules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.lead_scoring_rules;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_label is null or length(btrim(p_label)) = 0 then
    raise exception 'Rule label is required' using errcode = '22023';
  end if;

  insert into public.lead_scoring_rules (
    organization_id, label, field, operator, value, points, position, enabled
  ) values (
    p_organization_id, btrim(p_label), p_field, p_operator,
    coalesce(p_value, 'null'::jsonb),
    greatest(-100, least(100, p_points)),
    coalesce(p_position, 1),
    coalesce(p_enabled, true)
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.crm_create_lead_scoring_rule(uuid, text, text, text, jsonb, int, int, boolean)
  to authenticated;

create or replace function public.crm_update_lead_scoring_rule(
  p_rule_id uuid,
  p_patch jsonb
) returns public.lead_scoring_rules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.lead_scoring_rules;
  v_row public.lead_scoring_rules;
begin
  select * into v_existing
  from public.lead_scoring_rules
  where rule_id = p_rule_id;

  if v_existing.rule_id is null then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;

  if not public.is_org_admin(v_existing.organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.lead_scoring_rules
  set label = case
        when p_patch ? 'label' then btrim(p_patch ->> 'label')
        else label
      end,
      field = coalesce(p_patch ->> 'field', field),
      operator = coalesce(p_patch ->> 'operator', operator),
      value = case
        when p_patch ? 'value' then p_patch -> 'value'
        else value
      end,
      points = case
        when p_patch ? 'points' then greatest(-100, least(100, (p_patch ->> 'points')::int))
        else points
      end,
      position = case
        when p_patch ? 'position' then (p_patch ->> 'position')::int
        else position
      end,
      enabled = case
        when p_patch ? 'enabled' then (p_patch ->> 'enabled')::boolean
        else enabled
      end,
      updated_at = now()
  where rule_id = p_rule_id
  returning * into v_row;

  if v_row.label is null or length(btrim(v_row.label)) = 0 then
    raise exception 'Rule label is required' using errcode = '22023';
  end if;

  return v_row;
end;
$$;

grant execute on function public.crm_update_lead_scoring_rule(uuid, jsonb)
  to authenticated;

create or replace function public.crm_delete_lead_scoring_rule(
  p_rule_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
  from public.lead_scoring_rules
  where rule_id = p_rule_id;

  if v_org is null then
    return;
  end if;

  if not public.is_org_admin(v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  delete from public.lead_scoring_rules
  where rule_id = p_rule_id;
end;
$$;

grant execute on function public.crm_delete_lead_scoring_rule(uuid)
  to authenticated;

create or replace function public.crm_save_lead_scoring_thresholds(
  p_organization_id uuid,
  p_hot int,
  p_warm int
) returns public.lead_scoring_thresholds
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.lead_scoring_thresholds;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_hot < p_warm then
    raise exception 'Hot threshold must be greater than or equal to warm' using errcode = '22023';
  end if;

  insert into public.lead_scoring_thresholds (organization_id, hot, warm)
  values (p_organization_id, p_hot, p_warm)
  on conflict (organization_id)
  do update set hot = excluded.hot, warm = excluded.warm
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.crm_save_lead_scoring_thresholds(uuid, int, int)
  to authenticated;
