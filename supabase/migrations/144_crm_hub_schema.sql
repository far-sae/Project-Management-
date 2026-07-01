-- 144_crm_hub_schema.sql
--
-- CRM Hub — a HubSpot-style CRM re-introduced into TaskCalendar (after the
-- previous CRM stack was removed in 143). Ported from the taskcalendar-crm-hub
-- reference project. All Lovable-Cloud bindings dropped; this schema runs
-- against TaskCalendar's own Supabase project.
--
-- Design choices that differ from the reference:
--   • crm-hub scopes rows by its own `workspaces` table. TaskCalendar already
--     has `organizations` (tenant), `workspaces` (inside an org, PM-scoped),
--     and `user_profiles`. CRM rows scope by `organization_id` so every org
--     member shares one CRM — matches how CRMs are used in practice.
--   • Every table prefixed `crm_` to avoid future clashes with PM tables
--     (`tasks`, `activity`, etc.).
--   • RLS uses the existing `public.is_org_member(uuid)` helper — no separate
--     workspace_members / has_role plumbing.
--   • Signup trigger from the reference is replaced by a per-org seed
--     (`crm_seed_default_stages(uuid)`) that runs the first time an org
--     opens the CRM. No auth.users trigger — TaskCalendar signup already
--     runs its own bootstrap.

set search_path = public;

-- ─── ENUMS ───────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_type where typname = 'crm_lifecycle_stage') then
    create type public.crm_lifecycle_stage as enum (
      'subscriber','lead','marketing_qualified_lead','sales_qualified_lead',
      'opportunity','customer','evangelist','other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_lead_status') then
    create type public.crm_lead_status as enum (
      'new','open','in_progress','open_deal','unqualified',
      'attempted_to_contact','connected','bad_timing'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_task_priority') then
    create type public.crm_task_priority as enum ('low','medium','high','urgent');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_task_status') then
    create type public.crm_task_status as enum ('pending','in_progress','completed');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_activity_type') then
    create type public.crm_activity_type as enum (
      'note','call','email','meeting','task_completed',
      'contact_created','company_created','deal_created','deal_updated',
      'deal_stage_changed','deal_won','deal_lost'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_deal_status') then
    create type public.crm_deal_status as enum ('open','won','lost');
  end if;
end $$;

-- ─── updated_at helper ───────────────────────────────────────────────
-- Reuse the app-wide helper if it exists (older migrations may have created
-- one); else define ours. Any set_updated_at() in the DB is compatible.
create or replace function public.crm_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- ─── DEAL STAGES ─────────────────────────────────────────────────────
create table if not exists public.crm_deal_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  probability int not null default 0,
  status crm_deal_status not null default 'open',
  created_at timestamptz not null default now()
);
alter table public.crm_deal_stages enable row level security;
grant select, insert, update, delete on public.crm_deal_stages to authenticated;
grant all on public.crm_deal_stages to service_role;
create index if not exists idx_crm_deal_stages_org on public.crm_deal_stages(organization_id, sort_order);
drop policy if exists "crm_deal_stages_rw" on public.crm_deal_stages;
create policy "crm_deal_stages_rw" on public.crm_deal_stages for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── COMPANIES ───────────────────────────────────────────────────────
create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  website text,
  industry text,
  phone text,
  email text,
  address text,
  city text,
  country text,
  company_size text,
  annual_revenue numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_companies enable row level security;
grant select, insert, update, delete on public.crm_companies to authenticated;
grant all on public.crm_companies to service_role;
create index if not exists idx_crm_companies_org on public.crm_companies(organization_id);
drop trigger if exists trg_crm_companies_updated on public.crm_companies;
create trigger trg_crm_companies_updated
  before update on public.crm_companies
  for each row execute function public.crm_set_updated_at();
drop policy if exists "crm_companies_rw" on public.crm_companies;
create policy "crm_companies_rw" on public.crm_companies for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── CONTACTS ────────────────────────────────────────────────────────
create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  job_title text,
  lifecycle_stage crm_lifecycle_stage not null default 'lead',
  lead_status crm_lead_status not null default 'new',
  source text,
  notes text,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_contacts enable row level security;
grant select, insert, update, delete on public.crm_contacts to authenticated;
grant all on public.crm_contacts to service_role;
create index if not exists idx_crm_contacts_org on public.crm_contacts(organization_id);
create index if not exists idx_crm_contacts_company on public.crm_contacts(company_id);
drop trigger if exists trg_crm_contacts_updated on public.crm_contacts;
create trigger trg_crm_contacts_updated
  before update on public.crm_contacts
  for each row execute function public.crm_set_updated_at();
drop policy if exists "crm_contacts_rw" on public.crm_contacts;
create policy "crm_contacts_rw" on public.crm_contacts for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── DEALS ───────────────────────────────────────────────────────────
create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  stage_id uuid not null references public.crm_deal_stages(id),
  company_id uuid references public.crm_companies(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  name text not null,
  value numeric not null default 0,
  probability int not null default 0,
  status crm_deal_status not null default 'open',
  expected_close_date date,
  source text,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_deals enable row level security;
grant select, insert, update, delete on public.crm_deals to authenticated;
grant all on public.crm_deals to service_role;
create index if not exists idx_crm_deals_org on public.crm_deals(organization_id);
create index if not exists idx_crm_deals_stage on public.crm_deals(stage_id);
drop trigger if exists trg_crm_deals_updated on public.crm_deals;
create trigger trg_crm_deals_updated
  before update on public.crm_deals
  for each row execute function public.crm_set_updated_at();
drop policy if exists "crm_deals_rw" on public.crm_deals;
create policy "crm_deals_rw" on public.crm_deals for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── CRM TASKS (follow-ups tied to a contact/company/deal) ───────────
-- Distinct from public.tasks (project tasks). Named crm_tasks to make the
-- boundary explicit.
create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  company_id uuid references public.crm_companies(id) on delete set null,
  deal_id uuid references public.crm_deals(id) on delete set null,
  title text not null,
  description text,
  due_date timestamptz,
  priority crm_task_priority not null default 'medium',
  status crm_task_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_tasks enable row level security;
grant select, insert, update, delete on public.crm_tasks to authenticated;
grant all on public.crm_tasks to service_role;
create index if not exists idx_crm_tasks_org on public.crm_tasks(organization_id);
drop trigger if exists trg_crm_tasks_updated on public.crm_tasks;
create trigger trg_crm_tasks_updated
  before update on public.crm_tasks
  for each row execute function public.crm_set_updated_at();
drop policy if exists "crm_tasks_rw" on public.crm_tasks;
create policy "crm_tasks_rw" on public.crm_tasks for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── ACTIVITIES ──────────────────────────────────────────────────────
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type crm_activity_type not null,
  description text,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  task_id uuid references public.crm_tasks(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.crm_activities enable row level security;
grant select, insert, update, delete on public.crm_activities to authenticated;
grant all on public.crm_activities to service_role;
create index if not exists idx_crm_activities_org on public.crm_activities(organization_id, created_at desc);
drop policy if exists "crm_activities_rw" on public.crm_activities;
create policy "crm_activities_rw" on public.crm_activities for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── NOTES ───────────────────────────────────────────────────────────
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null,
  contact_id uuid references public.crm_contacts(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.crm_notes enable row level security;
grant select, insert, update, delete on public.crm_notes to authenticated;
grant all on public.crm_notes to service_role;
create index if not exists idx_crm_notes_refs on public.crm_notes(contact_id, company_id, deal_id);
drop trigger if exists trg_crm_notes_updated on public.crm_notes;
create trigger trg_crm_notes_updated
  before update on public.crm_notes
  for each row execute function public.crm_set_updated_at();
drop policy if exists "crm_notes_rw" on public.crm_notes;
create policy "crm_notes_rw" on public.crm_notes for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- ─── TAGS ────────────────────────────────────────────────────────────
create table if not exists public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  name text not null,
  color text not null default '#f97316',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.crm_tags enable row level security;
grant select, insert, update, delete on public.crm_tags to authenticated;
grant all on public.crm_tags to service_role;
drop policy if exists "crm_tags_rw" on public.crm_tags;
create policy "crm_tags_rw" on public.crm_tags for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create table if not exists public.crm_contact_tags (
  contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  primary key (contact_id, tag_id)
);
alter table public.crm_contact_tags enable row level security;
grant select, insert, update, delete on public.crm_contact_tags to authenticated;
grant all on public.crm_contact_tags to service_role;
drop policy if exists "crm_contact_tags_rw" on public.crm_contact_tags;
create policy "crm_contact_tags_rw" on public.crm_contact_tags for all to authenticated
  using (exists (select 1 from public.crm_contacts c where c.id = contact_id and public.is_org_member(c.organization_id)))
  with check (exists (select 1 from public.crm_contacts c where c.id = contact_id and public.is_org_member(c.organization_id)));

-- ─── Default deal-stage seeder ───────────────────────────────────────
-- Idempotent — safe to call for orgs that already have stages, and safe
-- to run again as future stages are added.
create or replace function public.crm_seed_default_stages(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of organization %', p_org using errcode = '42501';
  end if;

  if exists (select 1 from public.crm_deal_stages where organization_id = p_org) then
    return;
  end if;

  insert into public.crm_deal_stages(organization_id, name, sort_order, probability, status) values
    (p_org, 'New Lead',      1, 10,  'open'),
    (p_org, 'Qualified',     2, 25,  'open'),
    (p_org, 'Demo Booked',   3, 40,  'open'),
    (p_org, 'Proposal Sent', 4, 60,  'open'),
    (p_org, 'Negotiation',   5, 80,  'open'),
    (p_org, 'Won',           6, 100, 'won'),
    (p_org, 'Lost',          7, 0,   'lost');
end $$;

grant execute on function public.crm_seed_default_stages(uuid) to authenticated;

-- Backfill: seed defaults for every existing org that has none.
do $$
declare r record;
begin
  for r in select organization_id from public.organizations loop
    if not exists (select 1 from public.crm_deal_stages where organization_id = r.organization_id) then
      insert into public.crm_deal_stages(organization_id, name, sort_order, probability, status) values
        (r.organization_id, 'New Lead',      1, 10,  'open'),
        (r.organization_id, 'Qualified',     2, 25,  'open'),
        (r.organization_id, 'Demo Booked',   3, 40,  'open'),
        (r.organization_id, 'Proposal Sent', 4, 60,  'open'),
        (r.organization_id, 'Negotiation',   5, 80,  'open'),
        (r.organization_id, 'Won',           6, 100, 'won'),
        (r.organization_id, 'Lost',          7, 0,   'lost');
    end if;
  end loop;
end $$;
