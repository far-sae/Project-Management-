-- 077_general_automation_events.sql
-- Extend the CRM automation event queue to the main app entities:
-- workspaces, projects, project tasks, assignments, and task stage changes.

create or replace function public.automation_enqueue_workspace_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
  values (
    new.organization_id,
    'workspace_created',
    jsonb_build_object(
      'workspace_id', new.workspace_id,
      'name', new.name,
      'is_default', coalesce(new.is_default, false)
    ),
    'workspaces',
    new.workspace_id
  );
  return null;
end;
$$;

drop trigger if exists automation_enqueue_workspace_insert_t on public.workspaces;
create trigger automation_enqueue_workspace_insert_t
  after insert on public.workspaces
  for each row execute function public.automation_enqueue_workspace_insert();

create or replace function public.automation_enqueue_project_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
  values (
    new.organization_id,
    'project_created',
    jsonb_build_object(
      'project_id', new.project_id,
      'workspace_id', new.workspace_id,
      'name', new.name,
      'description', new.description,
      'owner_id', new.owner_id,
      'start_date', new.start_date,
      'end_date', new.end_date
    ),
    'projects',
    new.project_id
  );
  return null;
end;
$$;

drop trigger if exists automation_enqueue_project_insert_t on public.projects;
create trigger automation_enqueue_project_insert_t
  after insert on public.projects
  for each row execute function public.automation_enqueue_project_insert();

create or replace function public.automation_enqueue_task_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
  values (
    new.organization_id,
    'task_created',
    jsonb_build_object(
      'task_id', new.task_id,
      'project_id', new.project_id,
      'title', new.title,
      'description', new.description,
      'status', new.status,
      'priority', new.priority,
      'due_date', new.due_date,
      'assignees', coalesce(new.assignees, '[]'::jsonb),
      'created_by', new.created_by
    ),
    'tasks',
    new.task_id
  );
  return null;
end;
$$;

drop trigger if exists automation_enqueue_task_insert_t on public.tasks;
create trigger automation_enqueue_task_insert_t
  after insert on public.tasks
  for each row execute function public.automation_enqueue_task_insert();

create or replace function public.automation_enqueue_task_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_assignees jsonb := coalesce(new.assignees, '[]'::jsonb);
  v_old_assignees jsonb := coalesce(old.assignees, '[]'::jsonb);
begin
  if new.status is distinct from old.status then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id,
      'task_status_changed',
      jsonb_build_object(
        'task_id', new.task_id,
        'project_id', new.project_id,
        'title', new.title,
        'status', new.status,
        'prev_status', old.status,
        'priority', new.priority,
        'due_date', new.due_date,
        'assignees', v_new_assignees,
        'created_by', new.created_by
      ),
      'tasks',
      new.task_id
    );
  end if;

  if v_new_assignees is distinct from v_old_assignees then
    insert into public.automation_events (organization_id, event_type, payload, source_table, source_id)
    values (
      new.organization_id,
      'task_assigned',
      jsonb_build_object(
        'task_id', new.task_id,
        'project_id', new.project_id,
        'title', new.title,
        'status', new.status,
        'priority', new.priority,
        'due_date', new.due_date,
        'assignees', v_new_assignees,
        'previous_assignees', v_old_assignees,
        'created_by', new.created_by
      ),
      'tasks',
      new.task_id
    );
  end if;

  return null;
end;
$$;

drop trigger if exists automation_enqueue_task_update_t on public.tasks;
create trigger automation_enqueue_task_update_t
  after update on public.tasks
  for each row execute function public.automation_enqueue_task_update();
