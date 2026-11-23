import type { Workspace } from '@/types/workspace';

/** What a workspace that was never given a name is called on screen. */
const GENERIC_LABEL = 'Main workspace';

/** The longest name a workspace may be given. */
export const WORKSPACE_NAME_MAX = 60;

const PLACEHOLDER_NAMES = new Set(['', 'general', 'default', 'default workspace', 'workspace']);

/** True for the names the app used to give a workspace by itself: nobody chose them. */
export function isPlaceholderWorkspaceName(name: string | null | undefined): boolean {
  return PLACEHOLDER_NAMES.has((name ?? '').trim().toLowerCase());
}

/**
 * The workspace an organisation still has to name: its one workspace, when
 * that still carries a name the app gave it. With a workspace somebody made,
 * nobody is asked; the old one can be renamed from the workspaces window.
 */
export function workspaceToName<W extends Pick<Workspace, 'name'>>(workspaces: W[]): W | null {
  return workspaces.length === 1 && isPlaceholderWorkspaceName(workspaces[0].name) ? workspaces[0] : null;
}

function isGenericBootstrapName(name: string | undefined, isDefault?: boolean): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (n === 'default workspace' || n === 'default') return true;
  if (isDefault && (n === '' || n === 'workspace')) return true;
  return false;
}

/** User-facing workspace title; hides legacy "Default Workspace" / bootstrap names. */
export function getWorkspaceDisplayName(
  workspace: Pick<Workspace, 'name' | 'isDefault'>,
): string {
  if (isGenericBootstrapName(workspace.name, workspace.isDefault)) {
    return GENERIC_LABEL;
  }
  return (workspace.name || '').trim() || GENERIC_LABEL;
}
