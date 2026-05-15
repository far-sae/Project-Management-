-- 058_pipelines_and_stages.sql
-- Adds per-org configurable pipelines, their stages (with required-field gating),
-- and project templates used by the won-handoff modal. A trigger seeds defaults
-- on org insert; an in-migration data backfill seeds defaults for existing orgs.

-- Alias for is_org_admin_or_owner. Several CRM batch-1 migrations and RPC
-- functions reference is_org_admin(uuid); the underlying helper from
-- migration 036 is is_org_admin_or_owner(uuid). This wrapper unifies the name
-- so every later migration can use is_org_admin consistently.
create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql stable as $$
  select public.is_org_admin_or_owner(p_org);
$$;

create table if not exists public.pipelines (
  pipeline_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(organization_id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  position int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index if not exists ux_pipelines_one_default
  on public.pipelines(organization_id) where is_default;

create table if not exists public.pipeline_stages (
  stage_id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null
    references public.pipelines(pipeline_id) on delete cascade,
  organization_id uuid not null,
  key text not null,
  label text not null,
  color text not null default '#94A3B8',
  position int not null,
  default_probability int not null default 10
    check (default_probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  required_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (pipeline_id, key),
  unique (pipeline_id, position)
);

create unique index if not exists ux_pipeline_stages_one_won
  on public.pipeline_stages(pipeline_id) where is_won;
create unique index if not exists ux_pipeline_stages_one_lost
  on public.pipeline_stages(pipeline_id) where is_lost;

create table if not exists public.project_templates (
  template_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  description text,
  task_definitions jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique (organization_id, name)
);

-- Seed defaults for a single org. Idempotent via on conflict do nothing.
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

  insert into public.project_templates (organization_id, name, description, task_definitions)
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

-- Seed every existing org.
do $$
declare
  o record;
begin
  for o in select organization_id from public.organizations loop
    perform public.seed_default_pipeline_for_org(o.organization_id);
  end loop;
end $$;

-- Auto-seed on future org inserts.
create or replace function public.pipelines_seed_on_org_insert()
returns trigger language plpgsql as $$
begin
  perform public.seed_default_pipeline_for_org(new.organization_id);
  return new;
end;
$$;

drop trigger if exists pipelines_seed_on_org_insert_t on public.organizations;
create trigger pipelines_seed_on_org_insert_t
  after insert on public.organizations
  for each row execute function public.pipelines_seed_on_org_insert();

-- RLS: members read, admins write.
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.project_templates enable row level security;

drop policy if exists "pipelines read for org members" on public.pipelines;
create policy "pipelines read for org members"
  on public.pipelines for select
  using (public.is_org_member(organization_id));

drop policy if exists "pipeline_stages read for org members" on public.pipeline_stages;
create policy "pipeline_stages read for org members"
  on public.pipeline_stages for select
  using (public.is_org_member(organization_id));

drop policy if exists "project_templates read for org members" on public.project_templates;
create policy "project_templates read for org members"
  on public.project_templates for select
  using (public.is_org_member(organization_id));

-- Writes gated by canManageSettings — enforced application-side in services
-- (mirrors the existing pattern on organizations.settings); no DB write policy
-- means inserts/updates go through SECURITY DEFINER service functions only.
