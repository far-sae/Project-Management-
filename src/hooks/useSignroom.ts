import { useMemo } from 'react';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { signroomClient, type SignroomClient } from '@/services/signroom/client';

/**
 * The documents server (agreements and invoices) for the workspace selected in
 * the sidebar. `workspaceId` is null while "All workspaces" or "Unassigned" is
 * selected: documents always belong to one real workspace, so pages should ask
 * the person to pick one instead of calling the server.
 */
export function useSignroom(): { client: SignroomClient; workspaceId: string | null } {
  const { selected } = useSelectedWorkspace();
  const workspaceId = selected?.workspaceId ?? null;
  const client = useMemo(() => signroomClient(workspaceId), [workspaceId]);
  return { client, workspaceId };
}
