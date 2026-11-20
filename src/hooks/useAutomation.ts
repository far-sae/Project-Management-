import { useMemo } from 'react';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { automationClient, type AutomationClient } from '@/services/automation/client';

/**
 * The automation server for the workspace selected in the sidebar.
 * `workspaceId` is null while "All workspaces" or "Unassigned" is selected:
 * automation always belongs to one real workspace, so pages should ask the
 * person to pick one instead of calling the server. `workspaceName` is the
 * selected workspace's name, for sentences such as "Runs only in Studio".
 */
export function useAutomation(): { client: AutomationClient; workspaceId: string | null; workspaceName: string } {
  const { selected } = useSelectedWorkspace();
  const workspaceId = selected?.workspaceId ?? null;
  const workspaceName = selected?.name ?? '';
  const client = useMemo(() => automationClient(workspaceId), [workspaceId]);
  return { client, workspaceId, workspaceName };
}
