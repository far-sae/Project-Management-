import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { format, startOfDay } from 'date-fns';
import type { KanbanColumn, Project, Task } from '@/types';
import { layoutBoard, type LayoutLane } from './mindMapLayout';
import {
  AUTO_EDGE_PREFIX,
  COLUMN_NODE_PREFIX,
  PROJECT_NODE_ID,
  SUBTASK_NODE_PREFIX,
  TASK_NODE_PREFIX,
} from './mindMapTypes';
import type {
  ColumnNodeData,
  ProjectNodeData,
  SubtaskNodeData,
  TaskNodeData,
} from './mindMapNodes';

// Edge colours come from theme tokens so they work in light + dark mode.
export const AUTO_EDGE_STYLE = { stroke: 'hsl(var(--muted-foreground) / 0.45)', strokeWidth: 1.5 };
export const USER_EDGE_COLOR = 'hsl(var(--primary))';
export const USER_EDGE_STYLE = { stroke: USER_EDGE_COLOR, strokeWidth: 2 };
export const USER_EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  color: USER_EDGE_COLOR,
  width: 16,
  height: 16,
} as const;

const DONE_RE = /\b(done|complete|completed|finished|closed|shipped)\b/i;

/** A column whose id or title reads like "done" — tasks there are never overdue. */
export const isDoneColumn = (col: { id: string; title?: string } | undefined): boolean =>
  !!col && (DONE_RE.test(col.id) || DONE_RE.test(col.title ?? ''));

/** True when the due date is before today (local) and the task isn't done. */
export function isOverdue(
  due: Date | string | null | undefined,
  now: Date,
  done: boolean,
): boolean {
  if (!due || done) return false;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  return startOfDay(d).getTime() < startOfDay(now).getTime();
}

const formatDueShort = (d: Date | string | null | undefined): string | undefined => {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return undefined;
  return format(date, 'MMM d');
};

export const subtaskNodeId = (taskId: string, subId: string | undefined, idx: number) =>
  `${SUBTASK_NODE_PREFIX}${taskId}-${subId || idx}`;

export interface BuildGraphHooks {
  onOpenTask?: (taskId: string) => void;
  onAttachFilesToTask?: (taskId: string, files: FileList) => void;
  attachmentCounts?: Map<string, number>;
  uploadingTaskIds?: Set<string>;
  collapsed?: ReadonlySet<string>;
  onToggleCollapse?: (columnNodeId: string) => void;
  /** Hover "+" on task cards — adds a connected idea. */
  onAddChild?: (nodeId: string) => void;
  now?: Date;
}

export interface BaseGraph {
  nodes: Node[];
  edges: Edge[];
  /** Board-derived nodes hidden because their column is collapsed. */
  hiddenNodeIds: Set<string>;
  /** Column node id for every task / subtask node (for Find → expand). */
  columnOf: Map<string, string>;
}

/** Build the board-derived graph (project → columns → tasks → subtasks).
 *  Node and edge ids are stable and unchanged from the original mind map so
 *  saved position overrides and hidden auto-links keep matching. */
export function buildBaseGraph(
  project: Project,
  tasks: Task[],
  columns: KanbanColumn[],
  hooks: BuildGraphHooks = {},
): BaseGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const hiddenNodeIds = new Set<string>();
  const columnOf = new Map<string, string>();
  const collapsed = hooks.collapsed ?? new Set<string>();
  const now = hooks.now ?? new Date();

  const columnsSorted = [...columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tasksByColumn = new Map<string, Task[]>();
  for (const c of columnsSorted) tasksByColumn.set(c.id, []);
  const unsorted: Task[] = [];
  for (const t of tasks) {
    if (tasksByColumn.has(t.status)) tasksByColumn.get(t.status)!.push(t);
    else unsorted.push(t);
  }
  const lanes: Array<{ id: string; title: string; color: string; tasks: Task[]; done: boolean }> =
    columnsSorted.map((c) => ({
      id: c.id,
      title: c.title,
      color: c.color,
      tasks: tasksByColumn.get(c.id) || [],
      done: isDoneColumn(c),
    }));
  if (unsorted.length > 0) {
    lanes.push({ id: '__unsorted', title: 'Unsorted', color: '', tasks: unsorted, done: false });
  }

  const layoutLanes: LayoutLane[] = lanes.map((lane) => ({
    nodeId: `${COLUMN_NODE_PREFIX}${lane.id}`,
    tasks: lane.tasks.map((t) => ({
      nodeId: `${TASK_NODE_PREFIX}${t.taskId}`,
      subtaskNodeIds: (t.subtasks ?? []).map((s, i) => subtaskNodeId(t.taskId, s.id, i)),
    })),
  }));
  const pos = layoutBoard(layoutLanes, collapsed, PROJECT_NODE_ID);

  nodes.push({
    id: PROJECT_NODE_ID,
    type: 'project',
    position: pos[PROJECT_NODE_ID],
    data: {
      label: project.name,
      description: project.description,
      taskCount: tasks.length,
      columnCount: lanes.length,
    } satisfies ProjectNodeData,
  });

  for (const lane of lanes) {
    const columnId = `${COLUMN_NODE_PREFIX}${lane.id}`;
    const isCollapsed = collapsed.has(columnId);
    nodes.push({
      id: columnId,
      type: 'column',
      position: pos[columnId],
      data: {
        label: lane.title,
        color: lane.color || undefined,
        count: lane.tasks.length,
        collapsed: isCollapsed,
        onToggleCollapse: hooks.onToggleCollapse ? () => hooks.onToggleCollapse?.(columnId) : undefined,
      } satisfies ColumnNodeData,
    });
    edges.push({
      id: `${AUTO_EDGE_PREFIX}project-${columnId}`,
      source: PROJECT_NODE_ID,
      sourceHandle: 'r-src',
      target: columnId,
      targetHandle: 'l-tgt',
      style: AUTO_EDGE_STYLE,
    });

    for (const t of lane.tasks) {
      const taskNodeId = `${TASK_NODE_PREFIX}${t.taskId}`;
      const subtasks = t.subtasks ?? [];
      columnOf.set(taskNodeId, columnId);
      subtasks.forEach((s, i) => columnOf.set(subtaskNodeId(t.taskId, s.id, i), columnId));
      if (isCollapsed) {
        hiddenNodeIds.add(taskNodeId);
        subtasks.forEach((s, i) => hiddenNodeIds.add(subtaskNodeId(t.taskId, s.id, i)));
        continue;
      }

      nodes.push({
        id: taskNodeId,
        type: 'task',
        position: pos[taskNodeId],
        data: {
          label: t.title,
          columnName: lane.title,
          columnColor: lane.color || undefined,
          priority: t.priority,
          dueLabel: formatDueShort(t.dueDate),
          overdue: isOverdue(t.dueDate, now, lane.done),
          assignees: (t.assignees || []).map((a) => ({
            name: a.displayName || a.email || 'Member',
            photoURL: a.photoURL,
          })),
          subtaskTotal: subtasks.length,
          subtaskDone: subtasks.filter((s) => s.completed).length,
          attachmentCount: hooks.attachmentCounts?.get(t.taskId) ?? 0,
          isUploading: hooks.uploadingTaskIds?.has(t.taskId) ?? false,
          onOpen: () => hooks.onOpenTask?.(t.taskId),
          onAttachFiles: hooks.onAttachFilesToTask
            ? (files: FileList) => hooks.onAttachFilesToTask?.(t.taskId, files)
            : undefined,
          onAddChild: hooks.onAddChild ? () => hooks.onAddChild?.(taskNodeId) : undefined,
        } satisfies TaskNodeData,
      });
      edges.push({
        id: `${AUTO_EDGE_PREFIX}${columnId}-${taskNodeId}`,
        source: columnId,
        sourceHandle: 'r-src',
        target: taskNodeId,
        targetHandle: 'l-tgt',
        style: AUTO_EDGE_STYLE,
      });

      subtasks.forEach((s, idx) => {
        const subId = subtaskNodeId(t.taskId, s.id, idx);
        nodes.push({
          id: subId,
          type: 'subtask',
          position: pos[subId],
          data: { label: s.title, completed: s.completed } satisfies SubtaskNodeData,
        });
        edges.push({
          id: `${AUTO_EDGE_PREFIX}${taskNodeId}-${subId}`,
          source: taskNodeId,
          sourceHandle: 'r-src',
          target: subId,
          targetHandle: 'l-tgt',
          style: s.completed
            ? AUTO_EDGE_STYLE
            : { ...AUTO_EDGE_STYLE, strokeDasharray: '4 4' },
        });
      });
    }
  }

  return { nodes, edges, hiddenNodeIds, columnOf };
}
