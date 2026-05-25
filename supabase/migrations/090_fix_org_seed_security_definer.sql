-- Fix: every Google/email signup after migrations 058 + 060 deployed has been
-- silently failing org auto-create.
--
-- ensureOrganizationExists() in AuthContext does `INSERT INTO organizations`
-- as the authenticated user. Two AFTER INSERT triggers fire on that table:
--   - pipelines_seed_on_org_insert_t  -> seed_default_pipeline_for_org
--   - lead_scoring_seed_on_org_insert_t -> seed_lead_scoring_for_org
-- Both seed functions try to insert into pipelines, pipeline_stages,
-- crm_project_templates, lead_scoring_rules, lead_scoring_thresholds. All of
-- those tables have RLS enabled with SELECT-only policies (per the original
-- "writes go through SECURITY DEFINER service functions only" design), so the
-- user's INSERT is rejected, the trigger errors, and the org INSERT rolls
-- back. Result: a fresh signup has no organization, no owner role, no trial
-- visible -- they appear as a "member" with nothing.
--
-- Fix: recreate both seed functions as SECURITY DEFINER so the seed INSERTs
-- bypass RLS the same way the production write-paths do.

create or replace function public.seed_default_pipeline_for_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_pipeline uuid;
begin
  insert into public.pipelines (organization_id, name, description, is_default, position)
  values (p_org, 'Sales', 'Default sales pipeline', true, 0)
  on conflict (organization_id, name) do nothing
  returning pipeline_id into v_pipeline;

  if v_pipeline is null then
    select pipeline_id into v_pipeline
    from public.pipelines
    where organization_id = p_org and is_default
    limit 1;
  end if;

  insert into public.pipeline_stages
    (pipeline_id, organization_id, key, label, color, position,
     default_probability, is_won, is_lost, required_fields)
  values
    (v_pipeline, p_org, 'lead',        'Lead',        '#94A3B8', 1, 10,  false, false, '{}'),
    (v_pipeline, p_org, 'qualified',   'Qualified',   '#FB923C', 2, 25,  false, false, '{}'),
    (v_pipeline, p_org, 'proposal',    'Proposal',    '#FACC15', 3, 50,  false, false,
       '{value,expected_close_date}'),
    (v_pipeline, p_org, 'negotiation', 'Negotiation', '#A855F7', 4, 75,  false, false,
       '{value,expected_close_date}'),
    (v_pipeline, p_org, 'won',         'Won',         '#10B981', 5, 100, true,  false,
       '{value}'),
    (v_pipeline, p_org, 'lost',        'Lost',        '#EF4444', 6, 0,   false, true,  '{}')
  on conflict (pipeline_id, key) do nothing;

  insert into public.crm_project_templates (organization_id, name, description, task_definitions)
  values
    (p_org, 'Onboarding',
     'Standard 4-step customer onboarding',
     '[{"title":"Kickoff call","offsetDays":1},
       {"title":"Share access + credentials","offsetDays":3},
       {"title":"Configure workspace","offsetDays":7},
       {"title":"Onboarding review","offsetDays":14}]'::jsonb),
    (p_org, 'SOW Delivery',
     '6-step SOW delivery',
     '[{"title":"Confirm scope","offsetDays":1},
       {"title":"Resource allocation","offsetDays":2},
       {"title":"Kickoff","offsetDays":5},
       {"title":"Mid-project review","offsetDays":15},
       {"title":"Final delivery","offsetDays":28},
       {"title":"Wrap-up + invoice","offsetDays":30}]'::jsonb)
  on conflict (organization_id, name) do nothing;
end;
$$;

create or replace function public.seed_lead_scoring_for_org(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.lead_scoring_thresholds (organization_id, hot, warm)
  values (p_org, 70, 40)
  on conflict (organization_id) do nothing;

  insert into public.lead_scoring_rules
    (organization_id, label, field, operator, value, points, position) values
    (p_org, 'Annual revenue >= $1M',  'annual_revenue', 'gte', to_jsonb(1000000),  20, 1),
    (p_org, 'Annual revenue >= $10M', 'annual_revenue', 'gte', to_jsonb(10000000), 15, 2),
    (p_org, '50+ employees',         'employee_count', 'gte', to_jsonb(50),       10, 3),
    (p_org, 'Source referral/event', 'source', 'in', '["referral","event"]'::jsonb, 10, 4),
    (p_org, 'Active last 14 days',   'recent_activity_days', 'lte', to_jsonb(14), 10, 5),
    (p_org, 'Open deals >= 1',        'open_deals_count', 'gte', to_jsonb(1),      15, 6),
    (p_org, 'Inactive penalty',      'status', 'eq', '"inactive"'::jsonb,         -20, 7),
    (p_org, 'Vendor penalty',        'type', 'eq', '"vendor"'::jsonb,             -10, 8)
  on conflict do nothing;
end;
$$;
