-- Saved Views: per-user filter/sort presets for the kanban / list views.
-- Scope: 'my' (private to owner), 'project' (shared with project members),
-- or 'org' (shared across the organization).
-- Run this in Supabase SQL Editor when enabling the Saved Views UI.

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  organization_id uuid,
  scope text not null check (scope in ('my', 'project', 'org')),
  project_id uuid,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort jsonb not null default '{}'::jsonb,
  density text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_views_owner on public.saved_views (owner_id);
create index if not exists idx_saved_views_project on public.saved_views (project_id) where project_id is not null;
create index if not exists idx_saved_views_org on public.saved_views (organization_id) where organization_id is not null;

alter table public.saved_views enable row level security;

drop policy if exists "Owners can read their saved views" on public.saved_views;
drop policy if exists "Members can read project-scoped saved views" on public.saved_views;
drop policy if exists "Org members can read org-scoped saved views" on public.saved_views;
drop policy if exists "Owners can write their saved views" on public.saved_views;
drop policy if exists "Owners can update their saved views" on public.saved_views;
drop policy if exists "Owners can delete their saved views" on public.saved_views;

create policy "Owners can read their saved views"
  on public.saved_views for select
  using (auth.uid() = owner_id);

create policy "Members can read project-scoped saved views"
  on public.saved_views for select
  using (
    scope = 'project'
    and project_id is not null
    and exists (
      select 1 from public.projects p
      where p.project_id = saved_views.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1
            from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) as m
            where (m->>'userId')::uuid = auth.uid()
          )
        )
    )
  );

create policy "Org members can read org-scoped saved views"
  on public.saved_views for select
  using (
    scope = 'org'
    and organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.organization_id = saved_views.organization_id
        and (
          o.owner_id = auth.uid()
          or exists (
            select 1
            from jsonb_array_elements(coalesce(o.members, '[]'::jsonb)) as m
            where (m->>'userId')::uuid = auth.uid()
          )
        )
    )
  );

create policy "Owners can write their saved views"
  on public.saved_views for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update their saved views"
  on public.saved_views for update
  using (auth.uid() = owner_id);

create policy "Owners can delete their saved views"
  on public.saved_views for delete
  using (auth.uid() = owner_id);
