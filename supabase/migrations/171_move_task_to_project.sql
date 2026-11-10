-- Move a task that was created in the wrong project into the right one.
--
-- Moves the task together with its sub-tasks (child tasks via parent_task_id),
-- and re-points the rows that hang off those tasks — files, comments,
-- activity history, expenses and notifications — so nothing is left behind
-- in the old project. The target project may belong to another organization
-- the caller is also in; organization_id is updated on every moved row so
-- org-scoped RLS keeps showing them.
--
-- Who may move:
--   • source: someone who can edit the task — creator, assignee, project
--     owner or org admin — and is not a viewer of the source project/org
--   • target: anyone who can add tasks to the target project (member with a
--     non-viewer role, project owner or org admin)

set search_path = public;

create or replace function public.move_task_to_project(
  p_task uuid,
  p_project uuid,
  p_status text default null   -- column in the target project; null = keep current
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_tgt_org uuid;
  v_pos integer;
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_task from public.tasks where task_id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  if v_task.project_id = p_project then
    return;  -- already there
  end if;

  -- Source side: caller must be allowed to edit this task.
  if not (
    public.can_access_project(v_task.project_id)
    and coalesce(public.project_access_role(v_task.project_id), 'none') <> 'viewer'
    and not public.is_org_viewer(v_task.organization_id)
    and (
      v_task.created_by = v_uid
      or public.tasks_user_is_assignee(v_task.assignees)
      or public.tasks_user_is_project_owner(v_task.project_id)
      or public.tasks_user_is_org_admin(v_task.organization_id)
    )
  ) then
    raise exception 'You don''t have permission to move this task'
      using errcode = '42501';
  end if;

  -- Target side: caller must be able to add tasks there.
  select organization_id into v_tgt_org from public.projects where project_id = p_project;
  if not found then
    raise exception 'That project no longer exists' using errcode = 'P0002';
  end if;
  if not (
    public.can_access_project(p_project)
    and coalesce(public.project_access_role(p_project), 'none') <> 'viewer'
    and not public.is_org_viewer(v_tgt_org)
  ) then
    raise exception 'You can''t add tasks to that project'
      using errcode = '42501';
  end if;

  -- The task and all of its descendants (sub-tasks of sub-tasks, …).
  with recursive tree as (
    select task_id from public.tasks where task_id = p_task
    union
    select t.task_id from public.tasks t join tree on t.parent_task_id = tree.task_id
  )
  select array_agg(task_id) into v_ids from tree;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.tasks where project_id = p_project;

  -- Sub-tasks keep their own column; the moved task goes to the chosen one,
  -- at the bottom, and stops being a sub-task of a task left behind.
  update public.tasks
    set project_id = p_project,
        organization_id = v_tgt_org,
        updated_at = now()
    where task_id = any(v_ids);

  update public.tasks
    set status = coalesce(nullif(btrim(p_status), ''), status),
        position = v_pos,
        parent_task_id = null
    where task_id = p_task;

  update public.files           set project_id = p_project, organization_id = v_tgt_org where task_id = any(v_ids);
  update public.global_comments set project_id = p_project, organization_id = v_tgt_org where task_id = any(v_ids);
  update public.activity        set project_id = p_project, organization_id = v_tgt_org where task_id = any(v_ids);
  update public.expenses        set project_id = p_project, organization_id = v_tgt_org where task_id = any(v_ids);
  update public.notifications   set project_id = p_project                            where task_id = any(v_ids);
end;
$$;

revoke all on function public.move_task_to_project(uuid, uuid, text) from public;
grant execute on function public.move_task_to_project(uuid, uuid, text) to authenticated;
