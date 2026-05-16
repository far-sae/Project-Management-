-- 064_fix_crm_project_templates_collision.sql
-- Hotfix: migration 009 already defined public.project_templates as a
-- "New project from template" scaffolding table (columns + seed tasks +
-- is_builtin). Migration 058 mistakenly reused the same name for an unrelated
-- CRM won-handoff use case with a different schema (task_definitions).
--
-- This migration:
--   1) introduces a separate public.crm_project_templates table for the
--      CRM won-handoff feature
--   2) replaces seed_default_pipeline_for_org so it writes to the new table
--   3) replaces crm_close_deal_to_won so it reads template tasks from the
--      new table
--   4) re-runs the org seed loop that failed mid-way during the 058 apply
--
-- After this migration, the original public.project_templates table from 009
-- is untouched and its scaffolding use case continues to work.

create table if not exists public.crm_project_templates (
  template_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  task_definitions jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique (organization_id, name)
);

alter table public.crm_project_templates enable row level security;

drop policy if exists "crm_project_templates read for org members"
  on public.crm_project_templates;
create policy "crm_project_templates read for org members"
  on public.crm_project_templates for select
  using (public.is_org_member(organization_id));

-- Replace the seed function: same behaviour, but inserts the two CRM
-- templates into crm_project_templates instead of project_templates.
create or replace function public.seed_default_pipeline_for_org(p_org uuid)
returns void language plpgsql as $$
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

-- Re-run the org seed loop now that the function points at the right table.
-- Idempotent — every insert has on conflict do nothing.
do $$
declare
  o record;
begin
  for o in select organization_id from public.organizations loop
    perform public.seed_default_pipeline_for_org(o.organization_id);
  end loop;
end $$;

-- Replace the won-handoff RPC so it reads template tasks from
-- crm_project_templates instead of project_templates.
create or replace function public.crm_close_deal_to_won(
  p_deal_id uuid,
  p_project_input jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals;
  v_won_stage uuid;
  v_project uuid;
  v_template uuid;
  v_org uuid;
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_task jsonb;
begin
  select * into v_deal from public.deals where deal_id = p_deal_id;
  if v_deal is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  v_org := v_deal.organization_id;

  if not public.is_org_admin(v_org) and v_deal.owner_id <> v_actor then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select stage_id into v_won_stage
  from public.pipeline_stages
  where pipeline_id = v_deal.pipeline_id and is_won;

  update public.deals
  set stage_id = v_won_stage,
      probability = 100,
      actual_close_date = v_now::date,
      closed_at = v_now,
      closed_by = v_actor,
      updated_at = v_now
  where deal_id = p_deal_id;

  if (p_project_input ->> 'skip')::boolean is true then
    return jsonb_build_object('deal_id', p_deal_id, 'project_id', null);
  end if;

  insert into public.projects (organization_id, name, owner_id, start_date, end_date, client_id)
  values (
    v_org,
    coalesce(p_project_input ->> 'name', v_deal.title),
    coalesce((p_project_input ->> 'owner_id')::uuid, v_deal.owner_id),
    coalesce((p_project_input ->> 'start_date')::date, current_date),
    coalesce((p_project_input ->> 'due_date')::date, (current_date + interval '30 days')::date),
    v_deal.client_id
  )
  returning project_id into v_project;

  v_template := (p_project_input ->> 'template_id')::uuid;
  if v_template is not null then
    for v_task in
      select * from jsonb_array_elements(
        (select task_definitions from public.crm_project_templates
          where template_id = v_template and organization_id = v_org)
      )
    loop
      insert into public.tasks (organization_id, project_id, title, due_date, created_by)
      values (
        v_org, v_project,
        v_task ->> 'title',
        (current_date + ((v_task ->> 'offsetDays')::int) * interval '1 day')::date,
        v_actor
      );
    end loop;
  end if;

  return jsonb_build_object('deal_id', p_deal_id, 'project_id', v_project);
end;
$$;

grant execute on function public.crm_close_deal_to_won(uuid, jsonb) to authenticated;
