import type { Workspace } from '@/types/workspace';

const GENERIC_LABEL = 'General';

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
