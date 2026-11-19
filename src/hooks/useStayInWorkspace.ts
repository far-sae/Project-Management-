import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { recordIsElsewhere } from '@/lib/workspaceScope';

/**
 * Keeps an open record and the workspace switcher in step.
 *
 * Opening a record from another workspace (a link someone sent, a search
 * result) switches to that record's workspace. Changing the workspace while
 * the record is open leaves the record and goes back to its list, so a page
 * never shows one workspace's record under another workspace's name.
 */
export function useStayInWorkspace(
  recordId: string | null | undefined,
  recordWorkspaceId: string | null | undefined,
  backTo: string,
): void {
  const { selectedId, select } = useSelectedWorkspace();
  const navigate = useNavigate();
  const openedRecord = useRef<string | null>(null);

  useEffect(() => {
    if (!recordId || !recordWorkspaceId || !selectedId) return;
    const elsewhere = recordIsElsewhere(recordWorkspaceId, selectedId);
    if (openedRecord.current !== recordId) {
      openedRecord.current = recordId;
      if (elsewhere) select(recordWorkspaceId);
      return;
    }
    if (elsewhere) navigate(backTo, { replace: true });
  }, [recordId, recordWorkspaceId, selectedId, select, navigate, backTo]);
}
