-- Project Templates: reusable scaffolding for new projects.
-- Each template stores its kanban columns and seed tasks as JSON so the UI
-- can clone them when a user picks "From template" in the new-project dialog.

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  organization_id uuid,
  name text not null,
  description text,
  columns jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_templates_owner on public.project_templates (owner_id) where owner_id is not null;
create index if not exists idx_project_templates_org on public.project_templates (organization_id) where organization_id is not null;

alter table public.project_templates enable row level security;

drop policy if exists "Anyone can read built-in templates" on public.project_templates;
drop policy if exists "Org members can read org templates" on public.project_templates;
drop policy if exists "Owners can read their templates" on public.project_templates;
drop policy if exists "Owners can write templates" on public.project_templates;
drop policy if exists "Owners can update their templates" on public.project_templates;
drop policy if exists "Owners can delete their templates" on public.project_templates;

create policy "Anyone can read built-in templates"
  on public.project_templates for select
  using (is_builtin = true);

create policy "Org members can read org templates"
  on public.project_templates for select
  using (
    organization_id is not null
    and exists (
      select 1 from public.organizations o
      where o.organization_id = project_templates.organization_id
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

create policy "Owners can read their templates"
  on public.project_templates for select
  using (owner_id is not null and auth.uid() = owner_id);

create policy "Owners can write templates"
  on public.project_templates for insert
  with check (auth.uid() = owner_id and is_builtin = false);

create policy "Owners can update their templates"
  on public.project_templates for update
  using (auth.uid() = owner_id and is_builtin = false)
  with check (auth.uid() = owner_id and is_builtin = false);

create policy "Owners can delete their templates"
  on public.project_templates for delete
  using (auth.uid() = owner_id and is_builtin = false);
