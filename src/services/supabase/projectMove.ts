import { supabase } from './config';

/**
 * Fired on `window` after a project changes workspace so every mounted
 * project list (Dashboard, the workspace filter in WorkspaceContext, …)
 * refreshes at once — otherwise the moved project and its tasks linger in
 * the old workspace until the next tab refocus.
 */
export const PROJECTS_CHANGED_EVENT = 'taskcalendar:projects-changed';

/**
 * Move a project — and everything that belongs to it (tasks, comments,
 * files, chat, activity, time, expenses, invitations) — into another
 * workspace. `null` = "No workspace".
 *
 * The target may be in a different organization (e.g. an older org of the
 * same owner): the `move_project_to_workspace` database function (migration
 * 170) checks the caller is allowed on both sides and re-homes every row
 * that carries the organization in one transaction.
 */
export async function moveProjectToWorkspace(
  projectId: string,
  targetWorkspaceId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('move_project_to_workspace', {
    p_project: projectId,
    p_workspace: targetWorkspaceId,
  });
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) {
      throw new Error(
        'Moving projects needs a database update (migration 170) that has not been applied yet.',
      );
    }
    throw new Error(error.message || 'Could not move the project');
  }

  try {
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  } catch {
    /* non-browser environment */
  }
}
