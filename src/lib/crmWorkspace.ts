import { DEFAULT_COLUMNS, type KanbanColumn } from '@/types/task';
import type { TaskStatus } from '@/types/crmHub';

export const concreteCrmWorkspaceId = (
  selectedId: string,
  isAll: boolean,
  isUnassigned: boolean,
): string | null => (isAll || isUnassigned ? null : selectedId);

export const projectMatchesDealWorkspace = (
  dealWorkspaceId: string | null,
  projectWorkspaceId: string | null | undefined,
  requestedWorkspaceId: string,
): boolean => Boolean(
  dealWorkspaceId
  && projectWorkspaceId
  && dealWorkspaceId === requestedWorkspaceId
  && projectWorkspaceId === requestedWorkspaceId,
);

export const sharedTaskStatusFor = (
  columnsInput: KanbanColumn[] | undefined,
  status: TaskStatus,
): string | undefined => {
  const source = columnsInput?.length ? columnsInput : DEFAULT_COLUMNS;
  const ordered = [...source].sort((a, b) => a.order - b.order);
  const actionable = ordered.filter((column) => column.id !== 'undefined');
  const columns = actionable.length ? actionable : ordered;
  if (status === 'completed') {
    return columns.find((column) => /done|complete|closed/i.test(column.title))?.id
      ?? columns[columns.length - 1]?.id;
  }
  if (status === 'in_progress') return columns[1]?.id ?? columns[0]?.id;
  return columns[0]?.id;
};
