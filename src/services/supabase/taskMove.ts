import { supabase } from './config';

/**
 * Fired on `window` after a task moves to another project. Boards listen for
 * it and refetch — the realtime feed filtered on the old project never sees
 * an UPDATE that moves a row out of it, so the task would otherwise linger.
 * `detail` = `{ taskId, projectId }` (projectId = the new project).
 */
export const TASKS_CHANGED_EVENT = 'taskcalendar:tasks-changed';

export interface TasksChangedDetail {
  taskId: string;
  projectId: string;
}

/**
 * Move a task (with its sub-tasks, comments, files, activity and expenses)
 * into another project. `status` = the column to drop it into in the new
 * project; omit to keep the current one.
 *
 * Runs the `move_task_to_project` database function (migration 171), which
 * checks the caller may edit the task and add tasks to the target project.
 */
export async function moveTaskToProject(
  taskId: string,
  projectId: string,
  status?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('move_task_to_project', {
    p_task: taskId,
    p_project: projectId,
    p_status: status ?? null,
  });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) {
      throw new Error(
        'Moving tasks needs a database update (migration 171) that has not been applied yet.',
      );
    }
    throw new Error(error.message || 'Could not move the task');
  }

  try {
    window.dispatchEvent(
      new CustomEvent<TasksChangedDetail>(TASKS_CHANGED_EVENT, { detail: { taskId, projectId } }),
    );
  } catch {
    /* non-browser environment */
  }
}
