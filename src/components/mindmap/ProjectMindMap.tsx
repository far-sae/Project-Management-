import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { format } from 'date-fns';
import type { Project, Task, KanbanColumn } from '@/types';
import { cn } from '@/lib/utils';

interface ProjectMindMapProps {
  project: Project;
  tasks: Task[];
  /** Columns drive the lane order (and therefore vertical position of each branch). */
  columns: KanbanColumn[];
  /** Open the task modal for the given taskId — wired to the same handler used by Kanban. */
  onOpenTask?: (taskId: string) => void;
}

/** ── Layout constants ────────────────────────────────────────
 *  The mind map is built top-down with React Flow's manual positioning.
 *  Layout is computed once per render — no auto-layout library so the
 *  output is deterministic and easy to scan. */
const ROOT_X = 0;
const ROOT_Y = 0;
const COL_GAP_X = 380;
const TASK_GAP_Y = 90;
const SUBTASK_OFFSET_X = 280;
const SUBTASK_GAP_Y = 50;

/** Tailwind classes per priority for the small pill shown on a task node. */
const PRIORITY_CLASSES: Record<string, string> = {
  high: 'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  low: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
};

const STATUS_DOT: Record<string, string> = {
  todo: 'bg-slate-400',
  doing: 'bg-blue-500',
  'in-progress': 'bg-blue-500',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
};

// ── Custom node renderers ──────────────────────────────────

const ProjectNode: React.FC<{ data: { label: string; description?: string; taskCount: number } }> = ({ data }) => (
  <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-primary/5 px-4 py-3 shadow-md min-w-[220px] max-w-[260px]">
    <Handle type="source" position={Position.Right} className="!bg-primary" />
    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Project</p>
    <p className="mt-0.5 text-sm font-semibold text-foreground leading-snug">{data.label}</p>
    {data.description ? (
      <p className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-3">
        {data.description}
      </p>
    ) : null}
    <p className="mt-2 text-[11px] text-muted-foreground">
      {data.taskCount} task{data.taskCount === 1 ? '' : 's'}
    </p>
  </div>
);

const ColumnNode: React.FC<{ data: { label: string; color?: string; count: number } }> = ({ data }) => (
  <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-sm min-w-[180px]">
    <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
    <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: data.color || '#94a3b8' }}
      />
      <p className="text-sm font-semibold text-foreground truncate">{data.label}</p>
    </div>
    <p className="text-[11px] text-muted-foreground mt-0.5">
      {data.count} task{data.count === 1 ? '' : 's'}
    </p>
  </div>
);

interface TaskNodeData extends Record<string, unknown> {
  label: string;
  status: string;
  priority: string;
  dueDate?: string;
  assignees: string[];
  subtaskTotal: number;
  subtaskDone: number;
  onOpen?: () => void;
}

const TaskNode: React.FC<{ data: TaskNodeData }> = ({ data }) => (
  <button
    type="button"
    onClick={() => data.onOpen?.()}
    className={cn(
      'w-[260px] text-left rounded-lg border border-border bg-card px-3 py-2 shadow-sm',
      'hover:border-primary/50 hover:shadow-md transition-colors',
    )}
  >
    <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
    <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    <div className="flex items-start gap-2">
      <span
        className={cn(
          'mt-1 inline-block w-2 h-2 rounded-full shrink-0',
          STATUS_DOT[data.status] || 'bg-slate-400',
        )}
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground leading-snug truncate flex-1">
        {data.label}
      </p>
    </div>
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      {data.priority && (
        <span
          className={cn(
            'text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border',
            PRIORITY_CLASSES[data.priority] || 'bg-secondary text-secondary-foreground border-border',
          )}
        >
          {data.priority}
        </span>
      )}
      {data.dueDate && (
        <span className="text-[10px] text-muted-foreground">
          due {data.dueDate}
        </span>
      )}
      {data.subtaskTotal > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {data.subtaskDone}/{data.subtaskTotal} subtasks
        </span>
      )}
    </div>
    {data.assignees.length > 0 && (
      <p className="mt-1 text-[10px] text-muted-foreground truncate">
        {data.assignees.join(', ')}
      </p>
    )}
  </button>
);

const SubtaskNode: React.FC<{ data: { label: string; completed: boolean } }> = ({ data }) => (
  <div className="rounded-md border border-border bg-card/80 px-2.5 py-1.5 min-w-[200px] max-w-[260px]">
    <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center justify-center w-3.5 h-3.5 rounded border text-[8px]',
          data.completed
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-border text-transparent',
        )}
        aria-hidden
      >
        ✓
      </span>
      <p
        className={cn(
          'text-[11px] leading-snug truncate',
          data.completed ? 'line-through text-muted-foreground' : 'text-foreground',
        )}
      >
        {data.label}
      </p>
    </div>
  </div>
);

const NODE_TYPES: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  column: ColumnNode as unknown as NodeTypes[string],
  task: TaskNode as unknown as NodeTypes[string],
  subtask: SubtaskNode as unknown as NodeTypes[string],
};

// ── Layout helpers ──────────────────────────────────────────

const formatDueShort = (d: Date | string | null | undefined): string | undefined => {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return undefined;
  return format(date, 'MMM d');
};

const buildGraph = (
  project: Project,
  tasks: Task[],
  columns: KanbanColumn[],
  onOpenTask?: (taskId: string) => void,
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group tasks by column id; tasks with an unrecognized status fall into a synthetic
  // "Unsorted" lane so nothing is silently dropped.
  const columnsSorted = [...columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const tasksByColumn = new Map<string, Task[]>();
  for (const c of columnsSorted) tasksByColumn.set(c.id, []);
  const unsorted: Task[] = [];
  for (const t of tasks) {
    if (tasksByColumn.has(t.status)) {
      tasksByColumn.get(t.status)!.push(t);
    } else {
      unsorted.push(t);
    }
  }
  const lanes: Array<{ id: string; title: string; color: string; tasks: Task[] }> = [
    ...columnsSorted.map((c) => ({
      id: c.id,
      title: c.title,
      color: c.color,
      tasks: tasksByColumn.get(c.id) || [],
    })),
  ];
  if (unsorted.length > 0) {
    lanes.push({ id: '__unsorted', title: 'Unsorted', color: '#94a3b8', tasks: unsorted });
  }

  // Project root.
  nodes.push({
    id: 'project',
    type: 'project',
    position: { x: ROOT_X, y: ROOT_Y },
    data: {
      label: project.name,
      description: project.description,
      taskCount: tasks.length,
    },
    draggable: false,
  });

  // Lay each lane vertically; columns are stacked, then tasks under each column step
  // further to the right so the whole thing reads left → right.
  let cursorY = ROOT_Y;
  for (const lane of lanes) {
    const laneHeight = Math.max(1, lane.tasks.length) * TASK_GAP_Y;
    const laneCenterY = cursorY + laneHeight / 2 - TASK_GAP_Y / 2;
    const columnId = `col-${lane.id}`;

    nodes.push({
      id: columnId,
      type: 'column',
      position: { x: ROOT_X + COL_GAP_X, y: laneCenterY },
      data: { label: lane.title, color: lane.color, count: lane.tasks.length },
      draggable: true,
    });
    edges.push({
      id: `e-project-${columnId}`,
      source: 'project',
      target: columnId,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: lane.color || 'var(--border)', strokeWidth: 2 },
    });

    let taskY = cursorY;
    for (const t of lane.tasks) {
      const taskNodeId = `task-${t.taskId}`;
      const subtasks = t.subtasks ?? [];
      const subtaskDone = subtasks.filter((s) => s.completed).length;

      nodes.push({
        id: taskNodeId,
        type: 'task',
        position: { x: ROOT_X + COL_GAP_X * 2, y: taskY },
        data: {
          label: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: formatDueShort(t.dueDate),
          assignees: (t.assignees || []).map((a) => a.displayName || a.email || 'Member').slice(0, 3),
          subtaskTotal: subtasks.length,
          subtaskDone,
          onOpen: () => onOpenTask?.(t.taskId),
        } satisfies TaskNodeData,
        draggable: true,
      });
      edges.push({
        id: `e-${columnId}-${taskNodeId}`,
        source: columnId,
        target: taskNodeId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--border)', strokeWidth: 1.5 },
      });

      // Place subtasks vertically aligned with the task, branching further right.
      const subtaskBaseY = taskY - ((subtasks.length - 1) * SUBTASK_GAP_Y) / 2;
      subtasks.forEach((s, idx) => {
        const subNodeId = `sub-${t.taskId}-${s.id || idx}`;
        nodes.push({
          id: subNodeId,
          type: 'subtask',
          position: {
            x: ROOT_X + COL_GAP_X * 2 + SUBTASK_OFFSET_X,
            y: subtaskBaseY + idx * SUBTASK_GAP_Y,
          },
          data: { label: s.title, completed: s.completed },
          draggable: true,
        });
        edges.push({
          id: `e-${taskNodeId}-${subNodeId}`,
          source: taskNodeId,
          target: subNodeId,
          type: 'smoothstep',
          style: {
            stroke: s.completed ? 'rgb(16,185,129)' : 'var(--border)',
            strokeWidth: 1.25,
            strokeDasharray: s.completed ? '0' : '4 4',
          },
        });
      });

      taskY += Math.max(1, subtasks.length) * Math.max(TASK_GAP_Y, SUBTASK_GAP_Y);
    }

    cursorY = Math.max(cursorY + laneHeight, taskY) + TASK_GAP_Y;
  }

  return { nodes, edges };
};

export const ProjectMindMap: React.FC<ProjectMindMapProps> = ({
  project,
  tasks,
  columns,
  onOpenTask,
}) => {
  const { nodes, edges } = useMemo(
    () => buildGraph(project, tasks, columns, onOpenTask),
    [project, tasks, columns, onOpenTask],
  );

  if (tasks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground mb-1">Mind map is empty</p>
        <p className="text-xs">Add tasks and subtasks to see them visualised here.</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background rounded-lg border border-border overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} className="opacity-50" />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border !border-border"
          nodeColor={(n) => {
            if (n.type === 'project') return 'rgb(99,102,241)';
            if (n.type === 'column') {
              const c = (n.data as { color?: string } | undefined)?.color;
              return c || 'rgb(148,163,184)';
            }
            if (n.type === 'subtask') {
              const done = (n.data as { completed?: boolean } | undefined)?.completed;
              return done ? 'rgb(16,185,129)' : 'rgb(148,163,184)';
            }
            return 'rgb(59,130,246)';
          }}
        />
        <Controls className="!bg-card !border !border-border" />
      </ReactFlow>
    </div>
  );
};

export default ProjectMindMap;
