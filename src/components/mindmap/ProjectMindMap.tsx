import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { format } from 'date-fns';
import {
  Plus,
  Trash2,
  RotateCcw,
  Maximize2,
  Lightbulb,
  Sparkles,
  Download,
  FileJson,
  Image,
  ZoomIn,
  ZoomOut,
  Keyboard,
} from 'lucide-react';
import type { Project, Task, KanbanColumn } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  saveMindMapState as saveToCloud,
  migrateLocalStorageToCloud,
} from '@/services/supabase/mindmapState';
import { useAuth } from '@/context/AuthContext';

// ─────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────
const ROOT_X = 0;
const ROOT_Y = 0;
const COL_GAP_X = 380;
const TASK_GAP_Y = 110;
const SUBTASK_OFFSET_X = 290;
const SUBTASK_GAP_Y = 56;

// Edge IDs that start with this prefix are user-drawn — only those can be deleted
// from the canvas (auto-derived edges reflect the project's real structure).
const USER_EDGE_PREFIX = 'extra-edge-';
const IDEA_NODE_PREFIX = 'idea-';

// ─────────────────────────────────────────────────────────────
// Visual classes
// ─────────────────────────────────────────────────────────────
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

const IDEA_PALETTE: Array<{ name: string; ring: string; bg: string; dot: string }> = [
  { name: 'violet', ring: 'border-violet-500/40', bg: 'bg-violet-500/[0.08]', dot: 'bg-violet-500' },
  { name: 'sky', ring: 'border-sky-500/40', bg: 'bg-sky-500/[0.08]', dot: 'bg-sky-500' },
  { name: 'emerald', ring: 'border-emerald-500/40', bg: 'bg-emerald-500/[0.08]', dot: 'bg-emerald-500' },
  { name: 'amber', ring: 'border-amber-500/40', bg: 'bg-amber-500/[0.08]', dot: 'bg-amber-500' },
  { name: 'rose', ring: 'border-rose-500/40', bg: 'bg-rose-500/[0.08]', dot: 'bg-rose-500' },
];

// ─────────────────────────────────────────────────────────────
// Persistence (localStorage — per project)
// ─────────────────────────────────────────────────────────────
interface ExtraIdea {
  id: string;
  label: string;
  x: number;
  y: number;
  color?: string;
}

interface ExtraEdge {
  id: string;
  source: string;
  target: string;
  /** Optional handle ids if the user connected through specific sides. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

interface MindMapExtras {
  ideas: ExtraIdea[];
  edges: ExtraEdge[];
  /** node id → manual position override (covers task-derived nodes too). */
  positions: Record<string, { x: number; y: number }>;
}

const EMPTY_EXTRAS: MindMapExtras = { ideas: [], edges: [], positions: {} };

const storageKey = (projectId: string) => `mindmap_extras_v1:${projectId}`;

const loadExtras = (projectId: string): MindMapExtras => {
  if (typeof window === 'undefined') return EMPTY_EXTRAS;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return EMPTY_EXTRAS;
    const parsed = JSON.parse(raw) as Partial<MindMapExtras>;
    return {
      ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      positions:
        parsed.positions && typeof parsed.positions === 'object' ? parsed.positions : {},
    };
  } catch {
    return EMPTY_EXTRAS;
  }
};

const saveExtras = (projectId: string, extras: MindMapExtras) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(extras));
  } catch {
    /* storage full / disabled — soft-fail */
  }
};

// ─────────────────────────────────────────────────────────────
// Reusable node bits
// ─────────────────────────────────────────────────────────────

/** All four sides expose both source and target handles so users can drag a connection
 *  out from any side and into any side of another node. Handles fade in on hover/select
 *  so they don't clutter the canvas at rest. */
const ConnectionHandles: React.FC = memo(() => {
  const baseClass =
    '!w-2.5 !h-2.5 !bg-primary !border-2 !border-card opacity-0 group-hover:opacity-100 nodrag transition-opacity';
  return (
    <>
      <Handle id="t-src" type="source" position={Position.Top} className={baseClass} />
      <Handle id="t-tgt" type="target" position={Position.Top} className={cn(baseClass, '!bg-muted')} />
      <Handle id="r-src" type="source" position={Position.Right} className={baseClass} />
      <Handle id="r-tgt" type="target" position={Position.Right} className={cn(baseClass, '!bg-muted')} />
      <Handle id="b-src" type="source" position={Position.Bottom} className={baseClass} />
      <Handle id="b-tgt" type="target" position={Position.Bottom} className={cn(baseClass, '!bg-muted')} />
      <Handle id="l-src" type="source" position={Position.Left} className={baseClass} />
      <Handle id="l-tgt" type="target" position={Position.Left} className={cn(baseClass, '!bg-muted')} />
    </>
  );
});
ConnectionHandles.displayName = 'ConnectionHandles';

// ─────────────────────────────────────────────────────────────
// Node renderers
// ─────────────────────────────────────────────────────────────

interface ProjectNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  taskCount: number;
}

const ProjectNode: React.FC<{ data: ProjectNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div
    className={cn(
      'group relative rounded-2xl border bg-gradient-to-br from-primary/15 to-primary/[0.04] px-4 py-3 shadow-lg min-w-[240px] max-w-[280px] backdrop-blur-sm',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40',
    )}
  >
    <ConnectionHandles />
    <div className="flex items-center gap-1.5">
      <Sparkles className="w-3 h-3 text-primary" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Project</p>
    </div>
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

interface ColumnNodeData extends Record<string, unknown> {
  label: string;
  color?: string;
  count: number;
}

const ColumnNode: React.FC<{ data: ColumnNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div
    className={cn(
      'group relative rounded-xl border bg-card px-3.5 py-2.5 shadow-sm min-w-[200px] backdrop-blur-sm',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    )}
  >
    <ConnectionHandles />
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-card"
        style={{ backgroundColor: data.color || '#94a3b8' }}
      />
      <p className="text-sm font-semibold text-foreground truncate">{data.label}</p>
    </div>
    <p className="text-[11px] text-muted-foreground mt-0.5 ml-4.5">
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

const TaskNode: React.FC<{ data: TaskNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div
    className={cn(
      'group relative w-[260px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-all',
      selected
        ? 'border-primary ring-2 ring-primary/30 shadow-md'
        : 'border-border hover:border-primary/40 hover:shadow-md',
    )}
  >
    <ConnectionHandles />
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        data.onOpen?.();
      }}
      className="w-full text-left"
    >
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
              PRIORITY_CLASSES[data.priority] ||
                'bg-secondary text-secondary-foreground border-border',
            )}
          >
            {data.priority}
          </span>
        )}
        {data.dueDate && (
          <span className="text-[10px] text-muted-foreground">due {data.dueDate}</span>
        )}
        {data.subtaskTotal > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
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
  </div>
);

interface SubtaskNodeData extends Record<string, unknown> {
  label: string;
  completed: boolean;
}

const SubtaskNode: React.FC<{ data: SubtaskNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div
    className={cn(
      'group relative rounded-md border bg-card/85 px-2.5 py-1.5 min-w-[200px] max-w-[260px]',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    )}
  >
    <ConnectionHandles />
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

interface IdeaNodeData extends Record<string, unknown> {
  label: string;
  color?: string;
  onChange: (label: string) => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}

const IdeaNode: React.FC<{ data: IdeaNodeData; selected?: boolean }> = ({ data, selected }) => {
  const palette = IDEA_PALETTE.find((p) => p.name === data.color) || IDEA_PALETTE[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep draft in sync if the underlying label changes externally (e.g. undo, palette swap).
  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.label) data.onChange(trimmed);
    else if (!trimmed) setDraft(data.label);
  };

  return (
    <div
      className={cn(
        'group relative rounded-xl border-2 px-3 py-2 shadow-sm min-w-[200px] max-w-[260px] transition-all',
        palette.ring,
        palette.bg,
        selected && 'ring-2 ring-primary/40 shadow-md',
      )}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <ConnectionHandles />
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 inline-block w-2 h-2 rounded-full shrink-0', palette.dot)} aria-hidden />
        {editing ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(data.label);
                setEditing(false);
              }
            }}
            rows={2}
            className="nodrag flex-1 text-sm font-medium text-foreground leading-snug bg-background/60 border border-border/60 rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 resize-none min-w-0"
          />
        ) : (
          <p className="flex-1 text-sm font-medium text-foreground leading-snug whitespace-pre-wrap break-words">
            {data.label || 'Untitled idea'}
          </p>
        )}
      </div>

      {/* Hover/selected toolbar */}
      <div
        className={cn(
          'nodrag absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border border-border bg-card shadow-md px-0.5 py-0.5 transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        {IDEA_PALETTE.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onColorChange(p.name);
            }}
            title={`Color: ${p.name}`}
            aria-label={`Color: ${p.name}`}
            className={cn(
              'w-4 h-4 rounded-full transition-transform hover:scale-110',
              p.dot,
              data.color === p.name ? 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-card' : 'opacity-80',
            )}
          />
        ))}
        <span className="w-px h-4 bg-border mx-0.5" aria-hidden />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title="Edit"
          aria-label="Edit"
          className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete();
          }}
          title="Delete"
          aria-label="Delete"
          className="px-1 py-0.5 text-destructive hover:bg-destructive/10 rounded"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

const NODE_TYPES: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  column: ColumnNode as unknown as NodeTypes[string],
  task: TaskNode as unknown as NodeTypes[string],
  subtask: SubtaskNode as unknown as NodeTypes[string],
  idea: IdeaNode as unknown as NodeTypes[string],
};

// ─────────────────────────────────────────────────────────────
// Layout (auto-graph from tasks)
// ─────────────────────────────────────────────────────────────

const formatDueShort = (d: Date | string | null | undefined): string | undefined => {
  if (!d) return undefined;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return undefined;
  return format(date, 'MMM d');
};

const buildBaseGraph = (
  project: Project,
  tasks: Task[],
  columns: KanbanColumn[],
  onOpenTask?: (taskId: string) => void,
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

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
    } satisfies ProjectNodeData,
  });

  let cursorY = ROOT_Y;
  for (const lane of lanes) {
    const laneHeight = Math.max(1, lane.tasks.length) * TASK_GAP_Y;
    const laneCenterY = cursorY + laneHeight / 2 - TASK_GAP_Y / 2;
    const columnId = `col-${lane.id}`;

    nodes.push({
      id: columnId,
      type: 'column',
      position: { x: ROOT_X + COL_GAP_X, y: laneCenterY },
      data: { label: lane.title, color: lane.color, count: lane.tasks.length } satisfies ColumnNodeData,
    });
    edges.push({
      id: `auto-edge-project-${columnId}`,
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
          assignees: (t.assignees || [])
            .map((a) => a.displayName || a.email || 'Member')
            .slice(0, 3),
          subtaskTotal: subtasks.length,
          subtaskDone,
          onOpen: () => onOpenTask?.(t.taskId),
        } satisfies TaskNodeData,
      });
      edges.push({
        id: `auto-edge-${columnId}-${taskNodeId}`,
        source: columnId,
        target: taskNodeId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--border)', strokeWidth: 1.5 },
      });

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
          data: { label: s.title, completed: s.completed } satisfies SubtaskNodeData,
        });
        edges.push({
          id: `auto-edge-${taskNodeId}-${subNodeId}`,
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

// ─────────────────────────────────────────────────────────────
// Inner mind map (uses useReactFlow — must live under a Provider)
// ─────────────────────────────────────────────────────────────

interface ProjectMindMapProps {
  project: Project;
  tasks: Task[];
  columns: KanbanColumn[];
  onOpenTask?: (taskId: string) => void;
}

const MindMapInner: React.FC<ProjectMindMapProps> = ({
  project,
  tasks,
  columns,
  onOpenTask,
}) => {
  const flow = useReactFlow();
  const { user } = useAuth();
  const [extras, setExtrasState] = useState<MindMapExtras>(() => loadExtras(project.projectId));

  // On mount / project switch, try to migrate localStorage → cloud and load cloud state.
  useEffect(() => {
    const userId = user?.userId;
    if (!userId) {
      setExtrasState(loadExtras(project.projectId));
      return;
    }
    let cancelled = false;
    void migrateLocalStorageToCloud(project.projectId, userId).then((cloud) => {
      if (!cancelled) {
        // If cloud has data, prefer it; otherwise keep localStorage version
        const hasCloud =
          cloud.ideas.length > 0 ||
          cloud.edges.length > 0 ||
          Object.keys(cloud.positions).length > 0;
        if (hasCloud) setExtrasState(cloud);
        else setExtrasState(loadExtras(project.projectId));
      }
    });
    return () => { cancelled = true; };
  }, [project.projectId, user?.userId]);

  // Debounced cloud save ref
  const cloudSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All extras mutations go through this writer so persistence stays in lock-step
  // with the in-memory state — no chance of "saved but not displayed" or vice versa.
  const updateExtras = useCallback(
    (mutator: (prev: MindMapExtras) => MindMapExtras) => {
      setExtrasState((prev) => {
        const next = mutator(prev);
        // Save to localStorage immediately (fast, offline-capable)
        saveExtras(project.projectId, next);
        // Debounce save to cloud (avoid hammering Supabase)
        if (user?.userId) {
          if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
          cloudSaveTimer.current = setTimeout(() => {
            void saveToCloud(project.projectId, user.userId, next);
          }, 2000);
        }
        return next;
      });
    },
    [project.projectId, user?.userId],
  );

  // Auto-derived structure from the project + tasks.
  const baseGraph = useMemo(
    () => buildBaseGraph(project, tasks, columns, onOpenTask),
    [project, tasks, columns, onOpenTask],
  );

  // Idea-node mutators (passed into IdeaNode data so the user can edit/delete inline).
  const handleIdeaChange = useCallback(
    (id: string, patch: Partial<ExtraIdea>) => {
      updateExtras((prev) => ({
        ...prev,
        ideas: prev.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }));
    },
    [updateExtras],
  );

  const handleIdeaDelete = useCallback(
    (id: string) => {
      updateExtras((prev) => ({
        ...prev,
        ideas: prev.ideas.filter((i) => i.id !== id),
        edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
        positions: Object.fromEntries(
          Object.entries(prev.positions).filter(([k]) => k !== id),
        ),
      }));
    },
    [updateExtras],
  );

  // Compose final node/edge arrays: base graph + position overrides + user ideas + user edges.
  const composedNodes = useMemo<Node[]>(() => {
    const base = baseGraph.nodes.map((n) => {
      const override = extras.positions[n.id];
      return override ? { ...n, position: override } : n;
    });
    const ideaNodes: Node[] = extras.ideas.map((i) => ({
      id: i.id,
      type: 'idea',
      position: extras.positions[i.id] || { x: i.x, y: i.y },
      data: {
        label: i.label,
        color: i.color,
        onChange: (label: string) => handleIdeaChange(i.id, { label }),
        onDelete: () => handleIdeaDelete(i.id),
        onColorChange: (color: string) => handleIdeaChange(i.id, { color }),
      } satisfies IdeaNodeData,
    }));
    return [...base, ...ideaNodes];
  }, [baseGraph.nodes, extras, handleIdeaChange, handleIdeaDelete]);

  const composedEdges = useMemo<Edge[]>(() => {
    const userEdges: Edge[] = extras.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: 'smoothstep',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'rgb(99,102,241)' },
      style: { stroke: 'rgb(99,102,241)', strokeWidth: 2 },
    }));
    return [...baseGraph.edges, ...userEdges];
  }, [baseGraph.edges, extras.edges]);

  // React Flow controlled state. We seed from composedNodes/Edges and re-seed when the
  // composition changes (e.g. tasks updated, idea added). Drag-in-flight changes go
  // straight to local state for responsiveness; persistence happens on drag stop.
  const [nodes, setNodes] = useState<Node[]>(composedNodes);
  const [edges, setEdges] = useState<Edge[]>(composedEdges);

  useEffect(() => {
    setNodes(composedNodes);
  }, [composedNodes]);
  useEffect(() => {
    setEdges(composedEdges);
  }, [composedEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      // Persist position drops only — ignore the in-flight "dragging" updates so we
      // don't hammer localStorage on every mouse move.
      const finalDrops = changes.filter(
        (c): c is Extract<NodeChange, { type: 'position' }> =>
          c.type === 'position' && c.dragging === false && !!c.position,
      );
      if (finalDrops.length === 0) return;
      updateExtras((prev) => {
        const positions = { ...prev.positions };
        for (const c of finalDrops) {
          if (c.position) positions[c.id] = c.position;
        }
        return { ...prev, positions };
      });
    },
    [updateExtras],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return; // disallow self-loop
      const id = `${USER_EDGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newEdge: Edge = {
        id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgb(99,102,241)' },
        style: { stroke: 'rgb(99,102,241)', strokeWidth: 2 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      updateExtras((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id,
            source: connection.source!,
            target: connection.target!,
            sourceHandle: connection.sourceHandle,
            targetHandle: connection.targetHandle,
          },
        ],
      }));
    },
    [updateExtras],
  );

  // React Flow calls these *before* applying the delete, so we can both filter what
  // the user is allowed to remove and keep our extras store in sync.
  const onBeforeDelete = useCallback(
    async ({ nodes: nDel, edges: eDel }: { nodes: Node[]; edges: Edge[] }) => {
      const deletableNodes = nDel.filter((n) => n.id.startsWith(IDEA_NODE_PREFIX));
      const deletableEdges = eDel.filter((e) => e.id.startsWith(USER_EDGE_PREFIX));
      if (deletableNodes.length === 0 && deletableEdges.length === 0) {
        return false;
      }
      return { nodes: deletableNodes, edges: deletableEdges };
    },
    [],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const ids = deleted.map((n) => n.id).filter((id) => id.startsWith(IDEA_NODE_PREFIX));
      if (ids.length === 0) return;
      updateExtras((prev) => ({
        ...prev,
        ideas: prev.ideas.filter((i) => !ids.includes(i.id)),
        edges: prev.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
        positions: Object.fromEntries(
          Object.entries(prev.positions).filter(([k]) => !ids.includes(k)),
        ),
      }));
    },
    [updateExtras],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ids = deleted.map((e) => e.id).filter((id) => id.startsWith(USER_EDGE_PREFIX));
      if (ids.length === 0) return;
      updateExtras((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => !ids.includes(e.id)),
      }));
    },
    [updateExtras],
  );

  // Toolbar actions
  const addIdea = useCallback(() => {
    // Drop the new node near the centre of the current viewport so the user actually
    // sees it appear instead of guessing where it landed.
    const containerEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = containerEl?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const flowPos = flow.screenToFlowPosition({ x: cx, y: cy });
    const id = `${IDEA_NODE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const idea: ExtraIdea = {
      id,
      label: 'New idea',
      x: flowPos.x - 100,
      y: flowPos.y - 24,
      color: IDEA_PALETTE[0].name,
    };
    updateExtras((prev) => ({ ...prev, ideas: [...prev.ideas, idea] }));
    // Nudge selection to the new node so the user can immediately delete or edit it.
    requestAnimationFrame(() => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
    });
  }, [flow, updateExtras]);

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = nodes
      .filter((n) => n.selected && n.id.startsWith(IDEA_NODE_PREFIX))
      .map((n) => n.id);
    const selectedEdgeIds = edges
      .filter((e) => e.selected && e.id.startsWith(USER_EDGE_PREFIX))
      .map((e) => e.id);
    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
    setEdges((eds) =>
      eds.filter((e) => !selectedEdgeIds.includes(e.id) && !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)),
    );
    updateExtras((prev) => ({
      ...prev,
      ideas: prev.ideas.filter((i) => !selectedNodeIds.includes(i.id)),
      edges: prev.edges.filter(
        (e) =>
          !selectedEdgeIds.includes(e.id) &&
          !selectedNodeIds.includes(e.source) &&
          !selectedNodeIds.includes(e.target),
      ),
      positions: Object.fromEntries(
        Object.entries(prev.positions).filter(([k]) => !selectedNodeIds.includes(k)),
      ),
    }));
  }, [nodes, edges, updateExtras]);

  const resetLayout = useCallback(() => {
    if (!window.confirm('Reset all node positions and remove your custom ideas/connections?')) {
      return;
    }
    updateExtras(() => EMPTY_EXTRAS);
    requestAnimationFrame(() => flow.fitView({ padding: 0.2, duration: 300 }));
  }, [flow, updateExtras]);

  const fitView = useCallback(() => {
    flow.fitView({ padding: 0.2, duration: 300 });
  }, [flow]);

  const selectionHasUserItems = useMemo(
    () =>
      nodes.some((n) => n.selected && n.id.startsWith(IDEA_NODE_PREFIX)) ||
      edges.some((e) => e.selected && e.id.startsWith(USER_EDGE_PREFIX)),
    [nodes, edges],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Skip when user is typing in an input/textarea
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        flow.zoomIn({ duration: 200 });
      } else if (mod && e.key === '-') {
        e.preventDefault();
        flow.zoomOut({ duration: 200 });
      } else if (mod && e.key === '0') {
        e.preventDefault();
        flow.fitView({ padding: 0.2, duration: 300 });
      } else if (e.key === 'n' && !mod && !e.altKey) {
        e.preventDefault();
        addIdea();
      } else if (e.key === '?' && !mod) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flow, addIdea]);

  // ── Export functions ─────────────────────────────────────────

  const exportAsJson = useCallback(() => {
    const data = flow.toObject();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mindmap-${project.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flow, project.name]);

  const exportAsPng = useCallback(async () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    try {
      const root = document.documentElement;
      const rawBg = getComputedStyle(root).getPropertyValue('--background').trim();
      let backgroundColor: string;
      if (rawBg.length === 0) {
        backgroundColor = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? '#171717'
          : '#ffffff';
      } else if (rawBg.startsWith('#')) {
        backgroundColor = rawBg;
      } else {
        const lower = rawBg.toLowerCase();
        const isCompleteColorString =
          lower.startsWith('hsl(') ||
          lower.startsWith('hsla(') ||
          lower.startsWith('rgb(') ||
          lower.startsWith('rgba(') ||
          lower.startsWith('var(') ||
          rawBg.includes('(');
        backgroundColor = isCompleteColorString ? rawBg : `hsl(${rawBg})`;
      }

      const { toPng } = await import('html-to-image') as {
        toPng: (el: HTMLElement, opts: Record<string, unknown>) => Promise<string>;
      };
      const dataUrl = await toPng(el, {
        backgroundColor,
        pixelRatio: 2,
        filter: (node: Element) => {
          const cls = (node as HTMLElement).className;
          if (typeof cls === 'string' && (cls.includes('react-flow__minimap') || cls.includes('react-flow__controls')))
            return false;
          return true;
        },
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `mindmap-${project.name.replace(/\s+/g, '-').toLowerCase()}.png`;
      a.click();
    } catch {
      // html-to-image not installed — fall back to JSON
      exportAsJson();
    }
  }, [project.name, exportAsJson]);

  // ── Context menu state ──────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Check if we right-clicked on a node
      const target = e.target as HTMLElement;
      const nodeEl = target.closest('[data-id]');
      const nodeId = nodeEl?.getAttribute('data-id') || undefined;
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="relative h-full w-full bg-background rounded-lg border border-border overflow-hidden"
      onContextMenu={handleContextMenu}
      onClick={closeContextMenu}
    >
      {/* Floating toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-card/95 backdrop-blur px-1.5 py-1 shadow-md">
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={addIdea} title="Add idea (N)">
          <Plus className="w-3.5 h-3.5" />
          Add idea
        </Button>
        <span className="w-px h-5 bg-border" aria-hidden />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs disabled:opacity-40"
          onClick={deleteSelection}
          disabled={!selectionHasUserItems}
          title="Delete selected (Del)"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          onClick={() => flow.zoomIn({ duration: 200 })}
          title="Zoom in (Ctrl+=)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          onClick={() => flow.zoomOut({ duration: 200 })}
          title="Zoom out (Ctrl+-)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          onClick={fitView}
          title="Fit to screen (Ctrl+0)"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Fit
        </Button>
        <span className="w-px h-5 bg-border" aria-hidden />
        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" title="Export mind map">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[160px]">
            <DropdownMenuItem onClick={() => void exportAsPng()}>
              <Image className="w-3.5 h-3.5 mr-2" />
              Export as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportAsJson}>
              <FileJson className="w-3.5 h-3.5 mr-2" />
              Export as JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="w-px h-5 bg-border" aria-hidden />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
          onClick={resetLayout}
          title="Reset layout & remove custom items"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 text-xs text-muted-foreground"
          onClick={() => setShowShortcuts((v) => !v)}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Keyboard shortcuts panel */}
      {showShortcuts && (
        <div className="absolute top-14 left-3 z-20 rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg p-3 w-[220px]">
          <p className="text-xs font-semibold text-foreground mb-2">Keyboard Shortcuts</p>
          <div className="space-y-1.5 text-[11px] text-muted-foreground">
            {[
              ['Ctrl/Cmd + =', 'Zoom in'],
              ['Ctrl/Cmd + -', 'Zoom out'],
              ['Ctrl/Cmd + 0', 'Fit view'],
              ['N', 'Add idea node'],
              ['Del / Backspace', 'Delete selected'],
              ['?', 'Toggle shortcuts'],
            ].map(([key, desc]) => (
              <div key={key} className="flex justify-between gap-2">
                <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">
                  {key}
                </kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-card shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            onClick={() => { addIdea(); closeContextMenu(); }}
          >
            <Plus className="w-3.5 h-3.5" /> Add idea here
          </button>
          {contextMenu.nodeId?.startsWith(IDEA_NODE_PREFIX) && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-muted"
                onClick={() => {
                  handleIdeaDelete(contextMenu.nodeId!);
                  closeContextMenu();
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete idea
              </button>
            </>
          )}
          <div className="h-px bg-border my-1" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            onClick={() => { fitView(); closeContextMenu(); }}
          >
            <Maximize2 className="w-3.5 h-3.5" /> Fit to screen
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            onClick={() => { void exportAsPng(); closeContextMenu(); }}
          >
            <Image className="w-3.5 h-3.5" /> Export as PNG
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            onClick={() => { exportAsJson(); closeContextMenu(); }}
          >
            <FileJson className="w-3.5 h-3.5" /> Export as JSON
          </button>
        </div>
      )}

      {/* Hint pill */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card/90 backdrop-blur px-2.5 py-1 shadow-sm text-[10.5px] text-muted-foreground">
        <Lightbulb className="w-3 h-3 text-amber-500" />
        N to add idea · Ctrl+=/- to zoom · Right-click for menu · ? for shortcuts
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        connectionRadius={28}
        connectOnClick={false}
        defaultEdgeOptions={{
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.6}
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
            if (n.type === 'idea') {
              const color = (n.data as { color?: string } | undefined)?.color;
              const palette = IDEA_PALETTE.find((p) => p.name === color) || IDEA_PALETTE[0];
              const map: Record<string, string> = {
                violet: 'rgb(139,92,246)',
                sky: 'rgb(14,165,233)',
                emerald: 'rgb(16,185,129)',
                amber: 'rgb(245,158,11)',
                rose: 'rgb(244,63,94)',
              };
              return map[palette.name] || 'rgb(139,92,246)';
            }
            return 'rgb(59,130,246)';
          }}
        />
        <Controls className="!bg-card !border !border-border" />
      </ReactFlow>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Public component (wraps with ReactFlowProvider so useReactFlow works in MindMapInner)
// ─────────────────────────────────────────────────────────────

export const ProjectMindMap: React.FC<ProjectMindMapProps> = (props) => {
  if (props.tasks.length === 0 && (loadExtras(props.project.projectId).ideas.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground bg-background rounded-lg border border-border">
        <Lightbulb className="w-10 h-10 mb-3 text-amber-500/70" />
        <p className="text-sm font-medium text-foreground mb-1">Mind map is empty</p>
        <p className="text-xs max-w-xs">
          Add tasks and subtasks to see them visualised here, or click the canvas after enabling
          <span className="font-medium text-foreground"> Add idea</span> to brainstorm.
        </p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  );
};

export default ProjectMindMap;
