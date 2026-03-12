-- Add is_locked column for sensitive tasks (only creator, assignees, project owner can see)
alter table if exists public.tasks
  add column if not exists is_locked boolean not null default false;

comment on column public.tasks.is_locked is 'When true, only creator, assignees, and project owner can see this task';

-- Enable RLS on tasks (idempotent)
alter table if exists public.tasks enable row level security;

-- Helper: check if auth.uid() is in assignees jsonb array
create or replace function public.tasks_user_is_assignee(assignees jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(assignees, '[]'::jsonb)) elem
    where coalesce(elem->>'userId', elem->>'user_id') = auth.uid()::text
  );
$$;

-- Helper: check if auth.uid() is project owner
create or replace function public.tasks_user_is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.projects p
    where p.project_id = p_project_id and p.owner_id = auth.uid()
  );
$$;

-- SELECT: allow when not locked, or when locked and user is creator/assignee/project owner
drop policy if exists "tasks_locked_visibility" on public.tasks;
create policy "tasks_locked_visibility" on public.tasks
  for select
  using (
    auth.uid() is not null
    and (
      coalesce(is_locked, false) = false
      or created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
    )
  );

-- UPDATE: only users who can see can update; WITH CHECK prevents privilege escalation
drop policy if exists "tasks_update_authorized" on public.tasks;
create policy "tasks_update_authorized" on public.tasks
  for update
  using (
    auth.uid() is not null
    and (
      coalesce(is_locked, false) = false
      or created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
    )
  )
  with check (
    auth.uid() is not null
    and (
      created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
    )
  );

-- DELETE: only creator, assignee, or project owner can delete (no open unlocked clause)
drop policy if exists "tasks_delete_authorized" on public.tasks;
create policy "tasks_delete_authorized" on public.tasks
  for delete
  using (
    auth.uid() is not null
    and (
      created_by = auth.uid()
      or public.tasks_user_is_assignee(assignees)
      or public.tasks_user_is_project_owner(project_id)
    )
  );

-- INSERT: require created_by = auth.uid() and validate project access (owner or member)
drop policy if exists "tasks_insert_authenticated" on public.tasks;
create policy "tasks_insert_authenticated" on public.tasks
  for insert
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.project_id = project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1 from jsonb_array_elements(coalesce(p.members, '[]'::jsonb)) m
            where (m->>'userId' = auth.uid()::text or m->>'user_id' = auth.uid()::text)
          )
        )
    )
  );
