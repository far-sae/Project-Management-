-- Time tracking + expenses
--
-- time_entries: workers clock in/out; owner+admin can view all, only org owner
-- can edit/delete (matches the user's requirement that admins cannot tamper
-- with timesheets).
--
-- expenses: contractors record materials/receipts attached to a task; owner +
-- admin can view all and approve/reject. Creator can edit while pending.

-- ---------------------------------------------------------------------------
-- helper: is the calling user the owner of an organization?
-- ---------------------------------------------------------------------------
create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations
    where organization_id = p_org
      and owner_id = auth.uid()
  );
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    where o.organization_id = p_org
      and (
        o.owner_id = auth.uid()
        or exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = auth.uid()
        )
      )
  );
$$;

-- admin OR owner — used for views that should expose other members' data
create or replace function public.is_org_admin_or_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    where o.organization_id = p_org
      and (
        o.owner_id = auth.uid()
        or exists (
          select 1
          from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) m
          where (m->>'userId')::uuid = auth.uid()
            and (m->>'role') in ('owner', 'admin')
        )
      )
  );
$$;

grant execute on function public.is_org_owner(uuid)          to anon, authenticated;
grant execute on function public.is_org_member(uuid)         to anon, authenticated;
grant execute on function public.is_org_admin_or_owner(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------------
create table if not exists public.time_entries (
  entry_id        uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id         uuid not null,
  user_name       text,
  project_id      uuid,
  project_name    text,
  notes           text,
  clocked_in_at   timestamptz not null default now(),
  clocked_out_at  timestamptz,
  -- generated when clocked_out_at is set; null while still on the clock
  duration_seconds integer generated always as (
    case
      when clocked_out_at is null then null
      else greatest(0, extract(epoch from (clocked_out_at - clocked_in_at))::int)
    end
  ) stored,
  edited_by       uuid,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_time_entries_org_user
  on public.time_entries (organization_id, user_id, clocked_in_at desc);
create index if not exists idx_time_entries_open
  on public.time_entries (organization_id, user_id) where clocked_out_at is null;

alter table public.time_entries enable row level security;

grant select on table public.time_entries to anon;
grant select, insert, update, delete on table public.time_entries to authenticated;

drop policy if exists "anon_no_time_entries"             on public.time_entries;
drop policy if exists "members_view_own_time"            on public.time_entries;
drop policy if exists "owner_admin_view_all_time"        on public.time_entries;
drop policy if exists "members_clock_in_own"             on public.time_entries;
drop policy if exists "members_clock_out_own_open"       on public.time_entries;
drop policy if exists "owner_can_edit_time"              on public.time_entries;
drop policy if exists "owner_can_delete_time"            on public.time_entries;

create policy "anon_no_time_entries"
  on public.time_entries for select to anon using (false);

-- Members always see their OWN entries
create policy "members_view_own_time"
  on public.time_entries for select to authenticated
  using (user_id = auth.uid());

-- Owner + admin see EVERY entry in the organization
create policy "owner_admin_view_all_time"
  on public.time_entries for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

-- A member can clock IN by inserting a row for themselves
create policy "members_clock_in_own"
  on public.time_entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

-- A member can clock OUT (set clocked_out_at) on their OWN open entry —
-- but cannot otherwise edit the row. Owner-only edit policy covers everything else.
-- Column-level enforcement for this path lives in trigger enforce_clock_out_only_update
-- (migration 038_time_entries_enforce_clock_out_only.sql).
create policy "members_clock_out_own_open"
  on public.time_entries for update to authenticated
  using (
    user_id = auth.uid()
    and clocked_out_at is null
  )
  with check (user_id = auth.uid());

-- ONLY the organization owner can edit any time entry (not even admins).
create policy "owner_can_edit_time"
  on public.time_entries for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

create policy "owner_can_delete_time"
  on public.time_entries for delete to authenticated
  using (public.is_org_owner(organization_id));

-- updated_at trigger
create or replace function public.time_entries_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.time_entries_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.time_entries;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  expense_id      uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id      uuid,
  project_name    text,
  task_id         uuid,
  task_title      text,
  user_id         uuid not null,
  user_name       text,
  title           text not null,
  description     text,
  category        text,                            -- e.g. "materials", "tools", "fuel"
  amount          numeric(12,2) not null default 0,
  currency        text not null default 'USD',
  vendor          text,
  invoice_url     text,
  invoice_path    text,
  invoice_name    text,
  invoice_type    text,
  invoice_size    bigint,
  status          text not null default 'pending', -- pending | approved | rejected
  status_reason   text,
  status_changed_by   uuid,
  status_changed_at   timestamptz,
  incurred_on     date not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_expenses_org_created
  on public.expenses (organization_id, created_at desc);
create index if not exists idx_expenses_task
  on public.expenses (task_id);
create index if not exists idx_expenses_project
  on public.expenses (project_id);
create index if not exists idx_expenses_user
  on public.expenses (user_id);

alter table public.expenses enable row level security;

grant select on table public.expenses to anon;
grant select, insert, update, delete on table public.expenses to authenticated;

drop policy if exists "anon_no_expenses"           on public.expenses;
drop policy if exists "members_view_own_expense"   on public.expenses;
drop policy if exists "owner_admin_view_expenses"  on public.expenses;
drop policy if exists "members_create_expense"     on public.expenses;
drop policy if exists "creator_edit_pending"       on public.expenses;
drop policy if exists "owner_admin_edit_expense"   on public.expenses;
drop policy if exists "creator_delete_pending"     on public.expenses;
drop policy if exists "owner_admin_delete_expense" on public.expenses;

create policy "anon_no_expenses"
  on public.expenses for select to anon using (false);

create policy "members_view_own_expense"
  on public.expenses for select to authenticated
  using (user_id = auth.uid());

create policy "owner_admin_view_expenses"
  on public.expenses for select to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create policy "members_create_expense"
  on public.expenses for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_org_member(organization_id)
  );

-- Creator can edit own expense while it is still pending
create policy "creator_edit_pending"
  on public.expenses for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid());

-- Owner + admin can edit any expense (used for approve/reject + corrections)
create policy "owner_admin_edit_expense"
  on public.expenses for update to authenticated
  using (public.is_org_admin_or_owner(organization_id))
  with check (public.is_org_admin_or_owner(organization_id));

create policy "creator_delete_pending"
  on public.expenses for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

create policy "owner_admin_delete_expense"
  on public.expenses for delete to authenticated
  using (public.is_org_admin_or_owner(organization_id));

create or replace function public.expenses_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.expenses_set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception when others then null;
end $$;
