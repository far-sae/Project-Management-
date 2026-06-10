create table if not exists public.dashboards (
  dashboard_id    uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_user_id   uuid not null,
  name            text not null default 'My dashboard',
  widgets         jsonb not null default '[]'::jsonb,
  is_shared       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_dashboards_org_owner on public.dashboards (organization_id, owner_user_id);
alter table public.dashboards enable row level security;
drop policy if exists "anon_no_dashboards" on public.dashboards;
create policy "anon_no_dashboards" on public.dashboards for select to anon using (false);
drop policy if exists "view_own_or_shared_dashboards" on public.dashboards;
create policy "view_own_or_shared_dashboards" on public.dashboards for select to authenticated
  using (public.is_org_member(organization_id) and (owner_user_id = auth.uid() or is_shared));
drop policy if exists "insert_own_dashboards" on public.dashboards;
create policy "insert_own_dashboards" on public.dashboards for insert to authenticated
  with check (public.is_org_member(organization_id) and owner_user_id = auth.uid());
drop policy if exists "update_own_dashboards" on public.dashboards;
create policy "update_own_dashboards" on public.dashboards for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "delete_own_dashboards" on public.dashboards;
create policy "delete_own_dashboards" on public.dashboards for delete to authenticated
  using (owner_user_id = auth.uid());
