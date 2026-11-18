-- ============================================================================
-- 179 — HR: leave (time off), leave allowances, public holidays and
--       employee documents.
--
-- Safe to run more than once. Uses the helpers from migration 036:
--   public.is_org_owner(uuid), public.is_org_admin_or_owner(uuid),
--   public.is_org_member(uuid).
--
-- Who can do what
--   Owner / admin : everything in their organization.
--   Employee      : read their own leave, allowance and documents; ask for
--                   leave for themselves (always starts as "pending").
--   Everyone in the organization can read the public holidays.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- leave_requests
-- ---------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null,                         -- the employee on leave
  leave_type       text not null default 'annual',        -- annual | sick | unpaid | other
  start_date       date not null,
  end_date         date not null,
  days             numeric(5,1) not null,                 -- working days, 0.5 = half day
  half_day         boolean not null default false,
  reason           text,
  status           text not null default 'pending',       -- pending | approved | rejected | cancelled
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint leave_requests_type_check
    check (leave_type in ('annual', 'sick', 'unpaid', 'other')),
  constraint leave_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint leave_requests_dates_check check (end_date >= start_date),
  constraint leave_requests_days_check check (days > 0)
);

create index if not exists idx_leave_requests_org_dates
  on public.leave_requests (organization_id, start_date, end_date);
create index if not exists idx_leave_requests_org_user
  on public.leave_requests (organization_id, user_id);

alter table public.leave_requests enable row level security;
grant select, insert, update, delete on table public.leave_requests to authenticated;

drop policy if exists "leave_requests_select"        on public.leave_requests;
drop policy if exists "leave_requests_insert_admin"  on public.leave_requests;
drop policy if exists "leave_requests_insert_self"   on public.leave_requests;
drop policy if exists "leave_requests_update_admin"  on public.leave_requests;
drop policy if exists "leave_requests_delete_admin"  on public.leave_requests;

create policy "leave_requests_select"
  on public.leave_requests for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin_or_owner(organization_id));

create policy "leave_requests_insert_admin"
  on public.leave_requests for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

-- An employee may ask for leave for themselves; it cannot start approved.
create policy "leave_requests_insert_self"
  on public.leave_requests for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and public.is_org_member(organization_id)
  );

create policy "leave_requests_update_admin"
  on public.leave_requests for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "leave_requests_delete_admin"
  on public.leave_requests for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.leave_requests_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leave_requests_set_updated_at on public.leave_requests;
create trigger leave_requests_set_updated_at
  before update on public.leave_requests
  for each row execute function public.leave_requests_set_updated_at();

-- ---------------------------------------------------------------------------
-- leave_allowances — days each employee is entitled to per year
-- ---------------------------------------------------------------------------
create table if not exists public.leave_allowances (
  organization_id  uuid not null,
  user_id          uuid not null,
  annual_days      numeric(5,1) not null default 20,
  sick_days        numeric(5,1) not null default 10,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint leave_allowances_days_check check (annual_days >= 0 and sick_days >= 0)
);

alter table public.leave_allowances enable row level security;
grant select, insert, update, delete on table public.leave_allowances to authenticated;

drop policy if exists "leave_allowances_select" on public.leave_allowances;
drop policy if exists "leave_allowances_insert" on public.leave_allowances;
drop policy if exists "leave_allowances_update" on public.leave_allowances;
drop policy if exists "leave_allowances_delete" on public.leave_allowances;

create policy "leave_allowances_select"
  on public.leave_allowances for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin_or_owner(organization_id));

create policy "leave_allowances_insert"
  on public.leave_allowances for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

create policy "leave_allowances_update"
  on public.leave_allowances for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "leave_allowances_delete"
  on public.leave_allowances for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- ---------------------------------------------------------------------------
-- public_holidays — days nobody is expected to work (not counted as leave)
-- ---------------------------------------------------------------------------
create table if not exists public.public_holidays (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  holiday_date     date not null,
  name             text not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, holiday_date)
);

alter table public.public_holidays enable row level security;
grant select, insert, update, delete on table public.public_holidays to authenticated;

drop policy if exists "public_holidays_select" on public.public_holidays;
drop policy if exists "public_holidays_insert" on public.public_holidays;
drop policy if exists "public_holidays_update" on public.public_holidays;
drop policy if exists "public_holidays_delete" on public.public_holidays;

create policy "public_holidays_select"
  on public.public_holidays for select to authenticated
  using (public.is_org_member(organization_id));

create policy "public_holidays_insert"
  on public.public_holidays for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

create policy "public_holidays_update"
  on public.public_holidays for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "public_holidays_delete"
  on public.public_holidays for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- ---------------------------------------------------------------------------
-- employee_documents — contracts, ID, letters, certificates
-- ---------------------------------------------------------------------------
create table if not exists public.employee_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null,                         -- the employee the file belongs to
  title            text not null,
  category         text not null default 'other',         -- contract | id | letter | certificate | other
  file_name        text not null,
  file_path        text not null,                         -- path inside the hr-documents bucket
  file_size        bigint not null default 0,
  file_type        text,
  expires_on       date,
  uploaded_by      uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint employee_documents_category_check
    check (category in ('contract', 'id', 'letter', 'certificate', 'other'))
);

create index if not exists idx_employee_documents_org_user
  on public.employee_documents (organization_id, user_id);

alter table public.employee_documents enable row level security;
grant select, insert, update, delete on table public.employee_documents to authenticated;

drop policy if exists "employee_documents_select" on public.employee_documents;
drop policy if exists "employee_documents_insert" on public.employee_documents;
drop policy if exists "employee_documents_update" on public.employee_documents;
drop policy if exists "employee_documents_delete" on public.employee_documents;

create policy "employee_documents_select"
  on public.employee_documents for select to authenticated
  using (user_id = auth.uid() or public.is_org_admin_or_owner(organization_id));

create policy "employee_documents_insert"
  on public.employee_documents for insert to authenticated
  with check (public.is_org_admin_or_owner(organization_id));

create policy "employee_documents_update"
  on public.employee_documents for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "employee_documents_delete"
  on public.employee_documents for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- ---------------------------------------------------------------------------
-- hr-documents Storage bucket (private; files are read through signed URLs)
-- Path convention: <organization_id>/<employee_user_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('hr-documents', 'hr-documents', false, 26214400)   -- 25 MB per file
  on conflict (id) do nothing;

drop policy if exists "hr_documents_read"   on storage.objects;
drop policy if exists "hr_documents_write"  on storage.objects;
drop policy if exists "hr_documents_delete" on storage.objects;

create policy "hr_documents_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'hr-documents'
    and (
      public.is_org_admin_or_owner((string_to_array(name, '/'))[1]::uuid)
      or (string_to_array(name, '/'))[2] = auth.uid()::text
    )
  );

create policy "hr_documents_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hr-documents'
    and public.is_org_admin_or_owner((string_to_array(name, '/'))[1]::uuid)
  );

create policy "hr_documents_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'hr-documents'
    and public.is_org_admin_or_owner((string_to_array(name, '/'))[1]::uuid)
  );

-- Make the new tables visible to the API straight away.
notify pgrst, 'reload schema';
