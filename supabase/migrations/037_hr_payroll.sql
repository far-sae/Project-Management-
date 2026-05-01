-- HR + Payroll
--
-- employee_profiles  : per-user comp profile (pay type, rate, period, overtime)
-- payroll_runs       : period-based payroll job; status workflow draft → finalized → paid
-- payroll_items      : per-employee payslip inside a run
--
-- Permissions follow the same pattern as time entries: owner+admin can VIEW,
-- but only the organization OWNER can change pay rates and finalize / mark paid.
-- Admins can create draft runs and tweak quantities; finalize is owner-only.
--
-- Relies on helpers from migration 036 (is_org_owner, is_org_member,
-- is_org_admin_or_owner).

-- ---------------------------------------------------------------------------
-- employee_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.employee_profiles (
  user_id              uuid not null,
  organization_id      uuid not null,
  display_name         text,
  email                text,
  job_title            text,
  department           text,
  employment_type      text not null default 'employee',     -- employee | contractor
  status               text not null default 'active',       -- active | onboarding | terminated
  hire_date            date,
  termination_date     date,
  pay_type             text not null default 'hourly',       -- hourly | salary
  pay_rate             numeric(12,2) not null default 0,     -- per hour OR per period
  currency             text not null default 'USD',
  pay_period           text not null default 'biweekly',     -- weekly | biweekly | semimonthly | monthly
  overtime_multiplier  numeric(4,2) not null default 1.5,
  default_weekly_hours numeric(5,2) not null default 40,
  bank_last4           text,
  tax_id_last4         text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists idx_employee_profiles_org
  on public.employee_profiles (organization_id);

alter table public.employee_profiles enable row level security;

grant select on table public.employee_profiles to anon;
grant select, insert, update, delete on table public.employee_profiles to authenticated;

drop policy if exists "anon_no_employee_profiles"   on public.employee_profiles;
drop policy if exists "members_view_own_profile"    on public.employee_profiles;
drop policy if exists "owner_admin_view_profiles"   on public.employee_profiles;
drop policy if exists "owner_insert_profiles"       on public.employee_profiles;
drop policy if exists "owner_update_profiles"       on public.employee_profiles;
drop policy if exists "owner_delete_profiles"       on public.employee_profiles;

create policy "anon_no_employee_profiles"
  on public.employee_profiles for select to anon using (false);

create policy "members_view_own_profile"
  on public.employee_profiles for select to authenticated
  using (user_id = auth.uid());

create policy "owner_admin_view_profiles"
  on public.employee_profiles for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- Only the organization owner can create / edit / delete profiles. This
-- prevents admins from changing their own (or anyone's) pay rate.
create policy "owner_insert_profiles"
  on public.employee_profiles for insert to authenticated
  with check (public.is_org_owner(organization_id));

create policy "owner_update_profiles"
  on public.employee_profiles for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owner_delete_profiles"
  on public.employee_profiles for delete to authenticated
  using (public.is_org_owner(organization_id));

create or replace function public.employee_profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employee_profiles_set_updated_at on public.employee_profiles;
create trigger employee_profiles_set_updated_at
  before update on public.employee_profiles
  for each row execute function public.employee_profiles_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.employee_profiles;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- payroll_runs
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_runs (
  run_id              uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  period_start        date not null,
  period_end          date not null,
  pay_date            date,
  status              text not null default 'draft',  -- draft | finalized | paid
  currency            text not null default 'USD',
  notes               text,
  total_gross         numeric(14,2) not null default 0,
  total_reimbursement numeric(14,2) not null default 0,
  total_deduction     numeric(14,2) not null default 0,
  total_net           numeric(14,2) not null default 0,
  created_by          uuid,
  created_by_name     text,
  finalized_at        timestamptz,
  finalized_by        uuid,
  finalized_by_name   text,
  paid_at             timestamptz,
  paid_by             uuid,
  paid_by_name        text,
  paid_method         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (period_end >= period_start),
  check (status in ('draft','finalized','paid'))
);

create index if not exists idx_payroll_runs_org_period
  on public.payroll_runs (organization_id, period_end desc);

alter table public.payroll_runs enable row level security;

grant select on table public.payroll_runs to anon;
grant select, insert, update, delete on table public.payroll_runs to authenticated;

drop policy if exists "anon_no_payroll_runs"          on public.payroll_runs;
drop policy if exists "owner_admin_view_runs"         on public.payroll_runs;
drop policy if exists "owner_admin_create_runs"       on public.payroll_runs;
drop policy if exists "owner_admin_edit_draft_runs"   on public.payroll_runs;
drop policy if exists "owner_edit_finalized_runs"     on public.payroll_runs;
drop policy if exists "owner_admin_delete_draft_runs" on public.payroll_runs;
drop policy if exists "owner_delete_runs"             on public.payroll_runs;

create policy "anon_no_payroll_runs"
  on public.payroll_runs for select to anon using (false);

create policy "owner_admin_view_runs"
  on public.payroll_runs for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_create_runs"
  on public.payroll_runs for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

-- Owner+admin can edit DRAFT runs (build the payroll); once finalized/paid,
-- only the OWNER can touch them.
create policy "owner_admin_edit_draft_runs"
  on public.payroll_runs for update to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and status = 'draft'
  )
  with check (public.is_org_admin_or_owner(organization_id));

create policy "owner_edit_finalized_runs"
  on public.payroll_runs for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owner_admin_delete_draft_runs"
  on public.payroll_runs for delete to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and status = 'draft'
  );

create policy "owner_delete_runs"
  on public.payroll_runs for delete to authenticated
  using (public.is_org_owner(organization_id));

create or replace function public.payroll_runs_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_runs_set_updated_at on public.payroll_runs;
create trigger payroll_runs_set_updated_at
  before update on public.payroll_runs
  for each row execute function public.payroll_runs_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.payroll_runs;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- payroll_items
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_items (
  item_id                     uuid primary key default gen_random_uuid(),
  run_id                      uuid not null references public.payroll_runs(run_id) on delete cascade,
  organization_id             uuid not null,
  user_id                     uuid not null,
  user_name                   text,
  job_title                   text,
  pay_type                    text not null default 'hourly',
  hourly_rate                 numeric(12,2) not null default 0,
  salary_amount               numeric(14,2) not null default 0,
  regular_hours               numeric(8,2) not null default 0,
  overtime_hours              numeric(8,2) not null default 0,
  overtime_multiplier         numeric(4,2) not null default 1.5,
  gross_pay                   numeric(14,2) not null default 0,
  expense_reimbursement_total numeric(14,2) not null default 0,
  bonus                       numeric(14,2) not null default 0,
  deduction                   numeric(14,2) not null default 0,
  tax_withholding             numeric(14,2) not null default 0,
  net_pay                     numeric(14,2) not null default 0,
  currency                    text not null default 'USD',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (run_id, user_id)
);

create index if not exists idx_payroll_items_run on public.payroll_items (run_id);
create index if not exists idx_payroll_items_user on public.payroll_items (user_id);

alter table public.payroll_items enable row level security;

grant select on table public.payroll_items to anon;
grant select, insert, update, delete on table public.payroll_items to authenticated;

drop policy if exists "anon_no_payroll_items"          on public.payroll_items;
drop policy if exists "members_view_own_payslip"       on public.payroll_items;
drop policy if exists "owner_admin_view_items"         on public.payroll_items;
drop policy if exists "owner_admin_insert_items_draft" on public.payroll_items;
drop policy if exists "owner_admin_edit_items_draft"   on public.payroll_items;
drop policy if exists "owner_edit_items_anytime"       on public.payroll_items;
drop policy if exists "owner_admin_delete_items_draft" on public.payroll_items;
drop policy if exists "owner_delete_items"             on public.payroll_items;

create policy "anon_no_payroll_items"
  on public.payroll_items for select to anon using (false);

-- A member can see their OWN payslip line, but only after the run is finalized
-- (avoids leaking draft numbers admins are still tweaking).
create policy "members_view_own_payslip"
  on public.payroll_items for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.payroll_runs r
      where r.run_id = payroll_items.run_id
        and r.status in ('finalized','paid')
    )
  );

create policy "owner_admin_view_items"
  on public.payroll_items for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create policy "owner_admin_insert_items_draft"
  on public.payroll_items for insert to authenticated
  with check (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.payroll_runs r
      where r.run_id = payroll_items.run_id
        and r.status = 'draft'
    )
  );

create policy "owner_admin_edit_items_draft"
  on public.payroll_items for update to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.payroll_runs r
      where r.run_id = payroll_items.run_id
        and r.status = 'draft'
    )
  )
  with check (public.is_org_admin_or_owner(organization_id));

-- Owner can edit any item regardless of run status (corrections after finalize)
create policy "owner_edit_items_anytime"
  on public.payroll_items for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owner_admin_delete_items_draft"
  on public.payroll_items for delete to authenticated
  using (
    public.is_org_admin_or_owner(organization_id)
    and exists (
      select 1 from public.payroll_runs r
      where r.run_id = payroll_items.run_id
        and r.status = 'draft'
    )
  );

create policy "owner_delete_items"
  on public.payroll_items for delete to authenticated
  using (public.is_org_owner(organization_id));

create or replace function public.payroll_items_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_items_set_updated_at on public.payroll_items;
create trigger payroll_items_set_updated_at
  before update on public.payroll_items
  for each row execute function public.payroll_items_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.payroll_items;
exception when others then null;
end $$;
