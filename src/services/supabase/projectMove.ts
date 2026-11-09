import { supabase } from './config';

/**
 * Fired on `window` after a project changes workspace so every mounted
 * project list (Dashboard, the workspace filter in WorkspaceContext, …)
 * refreshes at once — otherwise the moved project and its tasks linger in
 * the old workspace until the next tab refocus.
 */
export const PROJECTS_CHANGED_EVENT = 'taskcalendar:projects-changed';

/**
 * Move a project — and with it everything that belongs to it (tasks,
 * comments, files, chat, calls), which all hang off `project_id` — into
 * another workspace of the same organization. `null` = "No workspace".
 *
 * The database policy lets the project owner / org admins / project admins
 * update a project but does not check that the target workspace belongs to
 * the same organization, so that check lives here.
 */
export async function moveProjectToWorkspace(
  projectId: string,
  targetWorkspaceId: string | null,
  organizationId: string,
): Promise<void> {
  if (targetWorkspaceId) {
    const { data: ws, error: wsError } = await supabase
      .from('workspaces')
      .select('workspace_id, organization_id')
      .eq('workspace_id', targetWorkspaceId)
      .maybeSingle();
    if (wsError) throw wsError;
    if (!ws) throw new Error('That workspace no longer exists.');
    if (String(ws.organization_id) !== String(organizationId)) {
      throw new Error('You can only move projects between workspaces in your organization.');
    }
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('organization_id, workspace_id')
    .eq('project_id', projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project || String(project.organization_id) !== String(organizationId)) {
    throw new Error('Project not found or you do not have access to it.');
  }
  if ((project.workspace_id ?? null) === targetWorkspaceId) return;

  const { data: updated, error: updateError } = await supabase
    .from('projects')
    .update({ workspace_id: targetWorkspaceId, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .select('project_id');
  if (updateError) throw updateError;
  // Row-level security turns a forbidden update into "0 rows changed".
  if (!updated || updated.length === 0) {
    throw new Error("You don't have permission to move this project.");
  }

  try {
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  } catch {
    /* non-browser environment */
  }
}
