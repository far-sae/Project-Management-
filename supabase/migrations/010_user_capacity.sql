-- User Capacity: per-user weekly capacity used by the Workload view.
-- Default is 40 hours per week. Each user can edit only their own row.

create table if not exists public.user_capacity (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hours_per_week numeric not null default 40 check (hours_per_week >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_capacity enable row level security;

drop policy if exists "Users can read any capacity" on public.user_capacity;
drop policy if exists "Users can upsert their own capacity" on public.user_capacity;
drop policy if exists "Users can update their own capacity" on public.user_capacity;

create policy "Users can read any capacity"
  on public.user_capacity for select
  using (true);

create policy "Users can upsert their own capacity"
  on public.user_capacity for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own capacity"
  on public.user_capacity for update
  using (auth.uid() = user_id);

-- Keep updated_at in sync on every UPDATE
create or replace function public.user_capacity_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_capacity_set_updated_at on public.user_capacity;
create trigger user_capacity_set_updated_at
  before update on public.user_capacity
  for each row
  execute function public.user_capacity_set_updated_at();
