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
  type EdgeTypes,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
} from '@xyflow/react';
import { DeletableEdge, type DeletableEdgeData } from './DeletableEdge';
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
  Paperclip,
  Loader2,
  Link2,
  CheckSquare,
  Columns,
  ChevronDown,
  Maximize,
  Minimize,
  Eraser,
} from 'lucide-react';
import type { Project, Task, KanbanColumn } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  saveMindMapState as saveToCloud,
  migrateLocalStorageToCloud,
} from '@/services/supabase/mindmapState';
import {
  uploadFileWithProgress,
  getProjectFiles,
} from '@/services/supabase/storage';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { AIMindMap, type AIMapImportPayload } from './AIMindMap';
import { MindMapTaskPanel } from './MindMapTaskPanel';
import { MindMapPlaceholderPanel } from './MindMapPlaceholderPanel';

// ─────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────
const ROOT_X = 0;
const ROOT_Y = 0;
const COL_GAP_X = 460;
const TASK_GAP_Y = 130;
const SUBTASK_OFFSET_X = 360;
const SUBTASK_GAP_Y = 64;

// Edge IDs starting with USER_EDGE_PREFIX are drawn by the user (reconnection
// overrides). AUTO_EDGE_PREFIX edges are derived from the project structure;
// the user can hide them from the canvas (we track the hidden ids in extras)
// but they always come back if the user chooses "Restore connections".
const USER_EDGE_PREFIX = 'extra-edge-';
const AUTO_EDGE_PREFIX = 'auto-edge-';
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
/** File metadata for a placeholder's attachments. The binary lives in
 *  Supabase storage (uploaded via uploadFileWithProgress with scope='project'
 *  and NO taskId, so it's a project file rather than tied to a kanban task);
 *  this struct is what we keep inside the placeholder so we can render a
 *  preview and a delete button without re-querying the files table. */
export interface PlaceholderAttachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  uploadedAt?: string;
}

/** Subtasks for a placeholder. Same shape the real Task uses so we can
 *  reuse the existing MentionTextarea-style UI primitives later. */
export interface PlaceholderSubtask {
  id: string;
  title: string;
  completed: boolean;
}

interface ExtraIdea {
  id: string;
  label: string;
  x: number;
  y: number;
  color?: string;
  /** Optional visual style for this placeholder. Undefined = pill-shaped
   *  brainstorm idea (legacy). 'task' / 'column' / 'project' make the node
   *  render in the matching kanban-derived shape so a placeholder visually
   *  echoes a real task/column/project header — purely cosmetic, the data
   *  lives in extras either way and never reaches the kanban. */
  kind?: 'task' | 'column' | 'project';
  /** Free-form notes shown when the placeholder panel is open. Task-shape
   *  placeholders use this as their description; other kinds can use it too. */
  description?: string;
  /** Subtasks attached to this placeholder. Mind-map-only — never written
   *  to the kanban tasks.subtasks column. */
  subtasks?: PlaceholderSubtask[];
  /** Files the user uploaded for this placeholder. Stored in Supabase
   *  storage as project files so they're also reachable from the Files page. */
  attachments?: PlaceholderAttachment[];
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
  /** Auto-edge ids the user has explicitly hidden from the canvas. The
   *  auto-derived structural edges (project→column→task→subtask) cannot be
   *  truly "deleted" — they reflect data — but the user can hide them and
   *  draw their own connections instead, just like Miro/Whimsical let you
   *  override the default linkage of an imported diagram. */
  removedAutoEdges: string[];
}

const EMPTY_EXTRAS: MindMapExtras = {
  ideas: [],
  edges: [],
  positions: {},
  removedAutoEdges: [],
};

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
      removedAutoEdges: Array.isArray(parsed.removedAutoEdges)
        ? parsed.removedAutoEdges.filter((v): v is string => typeof v === 'string')
        : [],
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

/** All four sides expose both source and target handles so users can drag a
 *  connection out from any side and into any side of another node.
 *
 *  The handles are now subtly visible at rest (30%) so users can SEE where
 *  to grab without having to hover-discover them. They brighten + grow on
 *  hover. Target handles use a muted colour so the user reads "drag from
 *  the bright dot, drop on the muted one" without thinking about it. */
const ConnectionHandles: React.FC = memo(() => {
  const baseClass =
    '!w-3 !h-3 !bg-primary !border-2 !border-card opacity-30 group-hover:opacity-100 group-hover:!w-3.5 group-hover:!h-3.5 nodrag transition-all duration-150';
  const targetClass = cn(baseClass, '!bg-muted-foreground/70');
  return (
    <>
      <Handle id="t-src" type="source" position={Position.Top} className={baseClass} />
      <Handle id="t-tgt" type="target" position={Position.Top} className={targetClass} />
      <Handle id="r-src" type="source" position={Position.Right} className={baseClass} />
      <Handle id="r-tgt" type="target" position={Position.Right} className={targetClass} />
      <Handle id="b-src" type="source" position={Position.Bottom} className={baseClass} />
      <Handle id="b-tgt" type="target" position={Position.Bottom} className={targetClass} />
      <Handle id="l-src" type="source" position={Position.Left} className={baseClass} />
      <Handle id="l-tgt" type="target" position={Position.Left} className={targetClass} />
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
      'group relative rounded-2xl border bg-gradient-to-br from-primary/15 to-primary/[0.04] px-5 py-4 shadow-lg min-w-[300px] max-w-[360px] backdrop-blur-sm',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40',
    )}
  >
    <ConnectionHandles />
    <div className="flex items-center gap-1.5">
      <Sparkles className="w-3.5 h-3.5 text-primary" />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">Project</p>
    </div>
    <p className="mt-1 text-base font-semibold text-foreground leading-snug">{data.label}</p>
    {data.description ? (
      <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-snug line-clamp-3">
        {data.description}
      </p>
    ) : null}
    <p className="mt-2.5 text-[12px] text-muted-foreground">
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
      'group relative rounded-xl border bg-card px-4 py-3 shadow-sm min-w-[260px] backdrop-blur-sm',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    )}
  >
    <ConnectionHandles />
    <div className="flex items-center gap-2">
      <span
        className="inline-block w-3 h-3 rounded-full shrink-0 ring-2 ring-card"
        style={{ backgroundColor: data.color || '#94a3b8' }}
      />
      <p className="text-base font-semibold text-foreground truncate">{data.label}</p>
    </div>
    <p className="text-[12px] text-muted-foreground mt-1 ml-5">
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
  attachmentCount: number;
  onOpen?: () => void;
  onAttachFiles?: (files: FileList) => void;
  isUploading?: boolean;
}

const TaskNode: React.FC<{ data: TaskNodeData; selected?: boolean }> = ({ data, selected }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className={cn(
        'group relative w-[320px] rounded-xl border bg-card px-4 py-3 shadow-sm transition-all',
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
              'mt-1.5 inline-block w-2.5 h-2.5 rounded-full shrink-0',
              STATUS_DOT[data.status] || 'bg-slate-400',
            )}
            aria-hidden
          />
          <p className="text-[15px] font-medium text-foreground leading-snug truncate flex-1">
            {data.label}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {data.priority && (
            <span
              className={cn(
                'text-[11px] font-medium uppercase tracking-wide rounded-full px-2 py-0.5 border',
                PRIORITY_CLASSES[data.priority] ||
                  'bg-secondary text-secondary-foreground border-border',
              )}
            >
              {data.priority}
            </span>
          )}
          {data.dueDate && (
            <span className="text-[11px] text-muted-foreground">due {data.dueDate}</span>
          )}
          {data.subtaskTotal > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {data.subtaskDone}/{data.subtaskTotal} subtasks
            </span>
          )}
          {data.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
              <Paperclip className="w-3 h-3" />
              {data.attachmentCount}
            </span>
          )}
        </div>
        {data.assignees.length > 0 && (
          <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
            {data.assignees.join(', ')}
          </p>
        )}
      </button>

      {/* Hidden picker — attaches the files to this task. Upload progress is
          surfaced via toast in the parent so the small node UI doesn't need
          its own progress bar. */}
      {data.onAttachFiles && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) data.onAttachFiles?.(files);
              e.target.value = '';
            }}
          />
          <div
            className={cn(
              'nodrag absolute -top-2.5 right-2 flex items-center gap-0.5 rounded-md border border-border bg-card px-0.5 py-0.5 shadow-md transition-opacity',
              selected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={data.isUploading}
              title={data.isUploading ? 'Uploading…' : 'Attach files to this task'}
              aria-label="Attach files to this task"
              className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
            >
              {data.isUploading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Paperclip className="w-3 h-3" />
              )}
              Attach
            </button>
          </div>
        </>
      )}
    </div>
  );
};

interface SubtaskNodeData extends Record<string, unknown> {
  label: string;
  completed: boolean;
}

const SubtaskNode: React.FC<{ data: SubtaskNodeData; selected?: boolean }> = ({ data, selected }) => (
  <div
    className={cn(
      'group relative rounded-md border bg-card/85 px-3 py-2 min-w-[260px] max-w-[320px]',
      selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
    )}
  >
    <ConnectionHandles />
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center justify-center w-4 h-4 rounded border text-[9px]',
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
          'text-[13px] leading-snug truncate',
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
  /** Visual style — undefined falls back to the legacy idea pill. */
  kind?: 'task' | 'column' | 'project';
  /** Project name displayed under the header on kind='project' shells. */
  projectDescription?: string;
  /** Number of attachments — shown as a 📎 N badge on task placeholders. */
  attachmentCount?: number;
  /** Subtask progress shown as N/M on task placeholders. */
  subtaskProgress?: { completed: number; total: number };
  /** When set, an "Open" button appears on task-shape placeholders so the
   *  user can edit notes / subtasks / attach files in a side panel. */
  onOpen?: () => void;
  onChange: (label: string) => void;
  onDelete: () => void;
  onColorChange: (color: string) => void;
}

const IdeaNode: React.FC<{ data: IdeaNodeData; selected?: boolean }> = ({ data, selected }) => {
  const palette = IDEA_PALETTE.find((p) => p.name === data.color) || IDEA_PALETTE[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const kind = data.kind;

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

  // The label area swaps between a static <p> and an editable <textarea>.
  // Shared across every kind so the inline rename UX is uniform.
  const labelBlock = editing ? (
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
      rows={kind === 'project' ? 1 : 2}
      className={cn(
        'nodrag flex-1 leading-snug bg-background/60 border border-border/60 rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 resize-none min-w-0',
        kind === 'project' ? 'text-sm font-semibold' : 'text-sm font-medium',
      )}
    />
  ) : (
    <p
      className={cn(
        'flex-1 leading-snug whitespace-pre-wrap break-words',
        kind === 'project'
          ? 'text-sm font-semibold text-foreground'
          : 'text-sm font-medium text-foreground',
      )}
    >
      {data.label || (kind === 'project' ? 'Untitled project' : kind === 'column' ? 'Untitled column' : kind === 'task' ? 'Untitled task' : 'Untitled idea')}
    </p>
  );

  // ── Kind-specific shells ──────────────────────────────────────
  // Project header: gradient card with a "PROJECT" tag, mirrors the real
  // ProjectNode shape so a placeholder visually reads as the project root.
  if (kind === 'project') {
    return (
      <div
        className={cn(
          'group relative rounded-2xl border bg-gradient-to-br from-primary/15 to-primary/[0.04] px-4 py-3 shadow-lg min-w-[240px] max-w-[300px] backdrop-blur-sm transition-all',
          selected ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40',
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <ConnectionHandles />
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-primary" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
            Project
          </p>
        </div>
        <div className="mt-0.5 flex items-start gap-2">
          {labelBlock}
        </div>
        {data.projectDescription && !editing && (
          <p className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">
            {data.projectDescription}
          </p>
        )}
        {renderHoverToolbar()}
      </div>
    );
  }

  // Column pill: dot + bold title, matches the real ColumnNode shape.
  if (kind === 'column') {
    return (
      <div
        className={cn(
          'group relative rounded-xl border bg-card px-3.5 py-2.5 shadow-sm min-w-[200px] max-w-[260px] backdrop-blur-sm transition-all',
          selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <ConnectionHandles />
        <div className="flex items-center gap-2">
          <span
            className={cn('inline-block w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-card', palette.dot)}
            aria-hidden
          />
          <div className="flex-1 min-w-0">{labelBlock}</div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 ml-4.5">Placeholder column</p>
        {renderHoverToolbar()}
      </div>
    );
  }

  // Task card: status-dot + label + a "PLACEHOLDER" tag where the priority
  // chip would live on a real task. Same width as TaskNode for visual parity.
  // Click the title row to open the side panel — same affordance real
  // TaskNode uses, so muscle memory transfers. Double-click still renames.
  if (kind === 'task') {
    const subtaskProgress = data.subtaskProgress;
    const attachmentCount = data.attachmentCount ?? 0;
    return (
      <div
        className={cn(
          'group relative w-[260px] rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-all',
          selected ? 'border-primary ring-2 ring-primary/30 shadow-md' : 'border-border hover:border-primary/40 hover:shadow-md',
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <ConnectionHandles />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!editing && data.onOpen) data.onOpen();
          }}
          className="w-full text-left disabled:cursor-default"
          disabled={editing}
        >
          <div className="flex items-start gap-2">
            <span
              className={cn('mt-1 inline-block w-2 h-2 rounded-full shrink-0', palette.dot)}
              aria-hidden
            />
            <div className="flex-1 min-w-0">{labelBlock}</div>
          </div>
          <div className="mt-1.5 flex items-center gap-1 flex-wrap">
            <span
              className={cn(
                'text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 border',
                palette.bg,
                palette.ring,
              )}
            >
              placeholder
            </span>
            {subtaskProgress && subtaskProgress.total > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {subtaskProgress.completed}/{subtaskProgress.total} subtasks
              </span>
            )}
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums">
                <Paperclip className="w-3 h-3" />
                {attachmentCount}
              </span>
            )}
          </div>
        </button>
        {renderHoverToolbar()}
      </div>
    );
  }

  // Default: legacy idea pill — unchanged.
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
        {labelBlock}
      </div>

      {renderHoverToolbar()}
    </div>
  );

  // ── Shared hover toolbar ────────────────────────────────────
  // Hoisted as a closure so the 4 shape branches stay flat. Captures
  // `data`, `palette`, `selected`, `setEditing` from the outer scope.
  function renderHoverToolbar() {
    return (
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
    );
  }
};

const NODE_TYPES: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  column: ColumnNode as unknown as NodeTypes[string],
  task: TaskNode as unknown as NodeTypes[string],
  subtask: SubtaskNode as unknown as NodeTypes[string],
  idea: IdeaNode as unknown as NodeTypes[string],
};

const EDGE_TYPES: EdgeTypes = {
  deletable: DeletableEdge as unknown as EdgeTypes[string],
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

interface BuildGraphHooks {
  onOpenTask?: (taskId: string) => void;
  /** Called when the user picks files to attach to this task node. */
  onAttachFilesToTask?: (taskId: string, files: FileList) => void;
  /** Map of taskId → number of attached files (mirrors task.commentAttachments etc.). */
  attachmentCounts?: Map<string, number>;
  /** Set of task ids currently uploading attachments (for spinner state). */
  uploadingTaskIds?: Set<string>;
}

const buildBaseGraph = (
  project: Project,
  tasks: Task[],
  columns: KanbanColumn[],
  hooks: BuildGraphHooks = {},
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
      sourceHandle: 'r-src',
      target: columnId,
      targetHandle: 'l-tgt',
      type: 'smoothstep',
      // Same bold coloured arrow language as the AI map — visually unifies
      // both views so the user instantly recognises what's connected to
      // what without reading colours.
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: lane.color || '#94a3b8',
        width: 14,
        height: 14,
      },
      style: { stroke: lane.color || 'var(--border)', strokeWidth: 2.25 },
    });

    let taskY = cursorY;
    for (const t of lane.tasks) {
      const taskNodeId = `task-${t.taskId}`;
      const subtasks = t.subtasks ?? [];
      const subtaskDone = subtasks.filter((s) => s.completed).length;

      const attachmentCount = hooks.attachmentCounts?.get(t.taskId) ?? 0;
      const isUploading = hooks.uploadingTaskIds?.has(t.taskId) ?? false;
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
          attachmentCount,
          isUploading,
          onOpen: () => hooks.onOpenTask?.(t.taskId),
          onAttachFiles: hooks.onAttachFilesToTask
            ? (files: FileList) => hooks.onAttachFilesToTask?.(t.taskId, files)
            : undefined,
        } satisfies TaskNodeData,
      });
      // Tint column→task edges with the lane color so each column visibly "owns"
      // its tasks even after the user drags nodes around. Width + opacity match
      // the AI map so both surfaces feel like the same diagram language.
      const laneStroke = lane.color || '#94a3b8';
      edges.push({
        id: `auto-edge-${columnId}-${taskNodeId}`,
        source: columnId,
        sourceHandle: 'r-src',
        target: taskNodeId,
        targetHandle: 'l-tgt',
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: laneStroke,
          width: 14,
          height: 14,
        },
        style: { stroke: laneStroke, strokeWidth: 1.75, strokeOpacity: 0.85 },
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
          sourceHandle: 'r-src',
          target: subNodeId,
          targetHandle: 'l-tgt',
          type: 'smoothstep',
          style: {
            stroke: s.completed ? 'rgb(16,185,129)' : 'rgb(148,163,184)',
            strokeWidth: 1.25,
            strokeOpacity: s.completed ? 1 : 0.5,
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

const MindMapInner: React.FC<StructuralMapProps> = ({
  project,
  tasks,
  columns,
  pendingImport,
  onPendingImportApplied,
  // `onOpenTask` is intentionally ignored — clicking a task in the mind map
  // now opens an inline editing panel rather than navigating the user back
  // to the kanban view. The prop stays in the component's type so existing
  // call sites keep compiling without changes.
}) => {
  const flow = useReactFlow();
  const { user } = useAuth();
  const [extras, setExtrasState] = useState<MindMapExtras>(() => loadExtras(project.projectId));

  // Cloud-load gate: until this is true we don't apply a pendingImport, so
  // the import doesn't get clobbered by the cloud snapshot that arrives a
  // moment later. After it flips, the import effect drains the payload.
  const [cloudLoaded, setCloudLoaded] = useState(false);

  // On mount / project switch, try to migrate localStorage → cloud and load cloud state.
  useEffect(() => {
    const userId = user?.userId;
    setCloudLoaded(false);
    if (!userId) {
      setExtrasState(loadExtras(project.projectId));
      setCloudLoaded(true);
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
        setCloudLoaded(true);
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

  // ── Import payload from the AI mind map ─────────────────────
  // Drains a single AIMapImportPayload (sent via the wrapper) into our
  // ideas + user-edges layer. The whole subgraph lands offset to the
  // right of the existing structural content so it doesn't overlap.
  // Each node converts to an ExtraIdea so it inherits all the existing
  // editing affordances (rename, recolour, drag, delete). Each edge
  // becomes a user edge so it's deletable + reconnectable just like a
  // freshly drawn one.
  const importedAppliedRef = useRef(false);
  useEffect(() => {
    if (!pendingImport) {
      importedAppliedRef.current = false;
      return;
    }
    if (!cloudLoaded || importedAppliedRef.current) return;
    importedAppliedRef.current = true;

    const stamp = Date.now().toString(36);
    const remap = new Map<string, string>();
    for (const n of pendingImport.nodes) {
      remap.set(n.id, `${IDEA_NODE_PREFIX}${stamp}-${n.id}`);
    }

    // Offset so the imported subtree appears to the right of the typical
    // project content (project node ~0, columns ~380, tasks ~760, subtasks
    // ~1050). 1500 lands clear of all of those at default zoom.
    const X_OFFSET = 1500;
    const Y_OFFSET = 0;

    // Project map's IDEA_PALETTE only has 5 entries; AI uses 8. Round-robin.
    const colorFor = (branchIndex: number): string => {
      if (branchIndex < 0) return IDEA_PALETTE[0].name;
      return IDEA_PALETTE[branchIndex % IDEA_PALETTE.length].name;
    };

    const newIdeas: ExtraIdea[] = pendingImport.nodes.map((n) => ({
      id: remap.get(n.id) || `${IDEA_NODE_PREFIX}${stamp}-${n.id}`,
      label: n.label,
      x: n.x + X_OFFSET,
      y: n.y + Y_OFFSET,
      color: colorFor(n.branchIndex),
    }));

    const newEdges: ExtraEdge[] = [];
    pendingImport.edges.forEach((e, i) => {
      const src = remap.get(e.source);
      const tgt = remap.get(e.target);
      if (!src || !tgt) return;
      newEdges.push({
        id: `${USER_EDGE_PREFIX}imported-${stamp}-${i}`,
        source: src,
        target: tgt,
        sourceHandle: 'r-src',
        targetHandle: 'l-tgt',
      });
    });

    updateExtras((prev) => ({
      ...prev,
      ideas: [...prev.ideas, ...newIdeas],
      edges: [...prev.edges, ...newEdges],
    }));

    // Pan/zoom to the new content so the user sees what was just imported.
    requestAnimationFrame(() => {
      try {
        flow.fitView({ padding: 0.2, duration: 400 });
      } catch {
        /* fit ok to fail before the canvas mounts */
      }
    });

    onPendingImportApplied?.();
    toast.success(
      newIdeas.length === 1
        ? '1 node added from AI map'
        : `${newIdeas.length} nodes added from AI map`,
    );
  }, [pendingImport, cloudLoaded, updateExtras, flow, onPendingImportApplied]);

  // ── Per-task attachment state ───────────────────────────────
  // Counts how many files are attached to each task so we can show a 📎
  // badge on the node, plus tracks which tasks are mid-upload for the
  // spinner UI. We seed counts from the existing `files` table on mount,
  // and bump them locally on a successful upload (instead of refetching).
  const [attachmentCounts, setAttachmentCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [uploadingTaskIds, setUploadingTaskIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const orgId = project.organizationId;
    if (!orgId) {
      setAttachmentCounts(new Map());
      return;
    }
    let cancelled = false;
    void getProjectFiles(project.projectId, orgId, 'project').then((files) => {
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const f of files) {
        if (f.taskId) m.set(f.taskId, (m.get(f.taskId) ?? 0) + 1);
      }
      setAttachmentCounts(m);
    });
    return () => {
      cancelled = true;
    };
  }, [project.projectId, project.organizationId]);

  const handleAttachFilesToTask = useCallback(
    async (taskId: string, files: FileList) => {
      const orgId = project.organizationId;
      if (!orgId) {
        toast.error('Workspace storage isn’t configured for this project.');
        return;
      }
      if (!user?.userId) {
        toast.error('Sign in to attach files.');
        return;
      }
      const list = Array.from(files);
      if (list.length === 0) return;

      setUploadingTaskIds((prev) => {
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });

      const toastId = toast.loading(
        list.length === 1
          ? `Uploading ${list[0].name}…`
          : `Uploading ${list.length} files…`,
      );

      let success = 0;
      let failed = 0;
      for (const file of list) {
        try {
          await uploadFileWithProgress(
            user.userId,
            user.displayName || user.email || 'User',
            orgId,
            { projectId: project.projectId, taskId, file, scope: 'task' },
          );
          success += 1;
        } catch (err) {
          failed += 1;
          // Continue uploading the rest — better partial than silently aborting
          // the entire batch on the first network blip.
        }
      }

      if (success > 0) {
        setAttachmentCounts((prev) => {
          const next = new Map(prev);
          next.set(taskId, (next.get(taskId) ?? 0) + success);
          return next;
        });
      }
      setUploadingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });

      if (failed === 0) {
        toast.success(
          success === 1 ? 'File attached' : `${success} files attached`,
          { id: toastId },
        );
      } else if (success === 0) {
        toast.error('Upload failed. Check your connection and try again.', {
          id: toastId,
        });
      } else {
        toast.warning(`Attached ${success}, ${failed} failed`, { id: toastId });
      }
    },
    [project.projectId, project.organizationId, user?.userId, user?.displayName, user?.email],
  );

  // ── Inline task panel state ─────────────────────────────────
  // Clicking a task node opens this panel instead of switching to the kanban
  // view, so brainstorming and editing happen on the same surface. The panel
  // edits the live Task object in Supabase but never moves the task between
  // columns — the mind map's reconnections stay purely visual.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = useMemo(
    () => (openTaskId ? tasks.find((t) => t.taskId === openTaskId) ?? null : null),
    [openTaskId, tasks],
  );
  const handleOpenTaskInline = useCallback((taskId: string) => {
    setOpenTaskId(taskId);
  }, []);

  // Auto-derived structure from the project + tasks. We intercept the open
  // callback here: the prop `onOpenTask` (used to switch to kanban) is no
  // longer wired into the node — instead we open the inline panel.
  const baseGraph = useMemo(
    () =>
      buildBaseGraph(project, tasks, columns, {
        onOpenTask: handleOpenTaskInline,
        onAttachFilesToTask: handleAttachFilesToTask,
        attachmentCounts,
        uploadingTaskIds,
      }),
    [
      project,
      tasks,
      columns,
      handleOpenTaskInline,
      handleAttachFilesToTask,
      attachmentCounts,
      uploadingTaskIds,
    ],
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

  // ── Placeholder task panel ─────────────────────────────────
  // Clicking a task-shape placeholder opens this panel so the user can
  // edit notes / subtasks / attach files. Everything saves into extras —
  // never touches the kanban tasks table.
  const [openPlaceholderId, setOpenPlaceholderId] = useState<string | null>(null);
  const openPlaceholder = useMemo(
    () =>
      openPlaceholderId
        ? extras.ideas.find((i) => i.id === openPlaceholderId) ?? null
        : null,
    [openPlaceholderId, extras.ideas],
  );
  const handleOpenPlaceholder = useCallback((id: string) => {
    setOpenPlaceholderId(id);
  }, []);

  // Compose final node/edge arrays: base graph + position overrides + user ideas + user edges.
  const composedNodes = useMemo<Node[]>(() => {
    const base = baseGraph.nodes.map((n) => {
      const override = extras.positions[n.id];
      return override ? { ...n, position: override } : n;
    });
    const ideaNodes: Node[] = extras.ideas.map((i) => {
      const subs = i.subtasks ?? [];
      return {
        id: i.id,
        type: 'idea',
        position: extras.positions[i.id] || { x: i.x, y: i.y },
        data: {
          label: i.label,
          color: i.color,
          kind: i.kind,
          // For project-header placeholders, surface the live project
          // description as a subtitle. Real ProjectNode does the same, so the
          // placeholder visually echoes the actual project root.
          projectDescription: i.kind === 'project' ? project.description : undefined,
          // Surface attachment + subtask counts on task placeholders so the
          // node shows the same micro-stats as a real task card.
          attachmentCount: i.kind === 'task' ? (i.attachments?.length ?? 0) : 0,
          subtaskProgress:
            i.kind === 'task'
              ? {
                  completed: subs.filter((s) => s.completed).length,
                  total: subs.length,
                }
              : undefined,
          onOpen: i.kind === 'task' ? () => handleOpenPlaceholder(i.id) : undefined,
          onChange: (label: string) => handleIdeaChange(i.id, { label }),
          onDelete: () => handleIdeaDelete(i.id),
          onColorChange: (color: string) => handleIdeaChange(i.id, { color }),
        } satisfies IdeaNodeData,
      };
    });
    return [...base, ...ideaNodes];
  }, [
    baseGraph.nodes,
    extras,
    handleIdeaChange,
    handleIdeaDelete,
    handleOpenPlaceholder,
    project.description,
  ]);

  /** One-click delete fired from the X button on each edge. We don't touch
   *  the React Flow `edges` state here; the composedEdges memo re-derives
   *  from extras and the seeding useEffect resyncs the canvas, so the click
   *  feels instant without us having to dual-write. Same classification as
   *  the keyboard delete path so auto-edges hide and user-edges remove. */
  const handleDeleteEdgeById = useCallback(
    (edgeId: string) => {
      if (edgeId.startsWith(USER_EDGE_PREFIX)) {
        updateExtras((prev) => ({
          ...prev,
          edges: prev.edges.filter((e) => e.id !== edgeId),
        }));
      } else if (edgeId.startsWith(AUTO_EDGE_PREFIX)) {
        updateExtras((prev) => ({
          ...prev,
          removedAutoEdges: prev.removedAutoEdges.includes(edgeId)
            ? prev.removedAutoEdges
            : [...prev.removedAutoEdges, edgeId],
        }));
      }
    },
    [updateExtras],
  );

  const composedEdges = useMemo<Edge[]>(() => {
    const removed = new Set(extras.removedAutoEdges);
    // Every visible edge — auto or user-drawn — is rendered through the
    // `deletable` custom edge so it gets a one-click X button. The original
    // smoothstep visuals come from the styles we set in buildBaseGraph;
    // DeletableEdge re-uses smoothstep paths via getSmoothStepPath, so the
    // shape stays identical to before — only the click affordance is new.
    const stampDeletable = (edge: Edge): Edge => ({
      ...edge,
      type: 'deletable',
      data: {
        ...(edge.data as Record<string, unknown> | undefined),
        onDelete: handleDeleteEdgeById,
      } satisfies DeletableEdgeData,
    });
    const baseVisible = baseGraph.edges
      .filter((e) => !removed.has(e.id))
      .map(stampDeletable);
    const userEdges: Edge[] = extras.edges.map((e) =>
      stampDeletable({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'rgb(99,102,241)',
          width: 14,
          height: 14,
        },
        style: { stroke: 'rgb(99,102,241)', strokeWidth: 2 },
      }),
    );
    return [...baseVisible, ...userEdges];
  }, [baseGraph.edges, extras.edges, extras.removedAutoEdges, handleDeleteEdgeById]);

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
        type: 'deletable',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'rgb(99,102,241)',
          width: 14,
          height: 14,
        },
        style: { stroke: 'rgb(99,102,241)', strokeWidth: 2 },
        data: { onDelete: handleDeleteEdgeById } satisfies DeletableEdgeData,
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
    [updateExtras, handleDeleteEdgeById],
  );

  // React Flow calls these *before* applying the delete, so we can both filter
  // what the user is allowed to remove and keep our extras store in sync.
  // Idea nodes and *both* edge kinds (user-drawn + auto/structural) are now
  // deletable — for auto edges the deletion is a "hide" (tracked separately
  // so we can restore later). Structural nodes (project / columns / tasks /
  // subtasks) cannot be deleted from the canvas because they reflect data.
  const onBeforeDelete = useCallback(
    async ({ nodes: nDel, edges: eDel }: { nodes: Node[]; edges: Edge[] }) => {
      const deletableNodes = nDel.filter((n) => n.id.startsWith(IDEA_NODE_PREFIX));
      const deletableEdges = eDel.filter(
        (e) =>
          e.id.startsWith(USER_EDGE_PREFIX) ||
          e.id.startsWith(AUTO_EDGE_PREFIX),
      );
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
      const userIds: string[] = [];
      const autoIds: string[] = [];
      for (const e of deleted) {
        if (e.id.startsWith(USER_EDGE_PREFIX)) userIds.push(e.id);
        else if (e.id.startsWith(AUTO_EDGE_PREFIX)) autoIds.push(e.id);
      }
      if (userIds.length === 0 && autoIds.length === 0) return;
      updateExtras((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => !userIds.includes(e.id)),
        // Track hidden auto-edges so they don't reappear on the next render
        // (composedEdges filters them out). Use a Set to dedupe across runs.
        removedAutoEdges:
          autoIds.length > 0
            ? Array.from(new Set([...prev.removedAutoEdges, ...autoIds]))
            : prev.removedAutoEdges,
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

  // ── Add placeholder dialog (mind-map only) ───────────────────
  // Hard rule: NOTHING the user does on the mind map writes to the kanban.
  // The three "Add" options drop a node into the mind map's local extras.
  // Each kind renders in a different visual shell so it visually echoes the
  // matching real node — task-card, column pill, or project header — but
  // the data lives entirely in extras and never reaches the kanban.
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    type: 'task' | 'column' | 'project';
  }>({ open: false, type: 'task' });
  const [addTitle, setAddTitle] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  const openAddDialog = useCallback(
    (type: 'task' | 'column' | 'project') => {
      // Project headers default to the real project name so the user gets
      // a one-tap experience: open dialog, hit Enter, header is on the canvas.
      setAddTitle(type === 'project' ? project.name : '');
      setAddDialog({ open: true, type });
    },
    [project.name],
  );

  const closeAddDialog = useCallback(() => {
    if (addSubmitting) return;
    setAddDialog((s) => ({ ...s, open: false }));
  }, [addSubmitting]);

  const submitAddDialog = useCallback(async () => {
    const title = addTitle.trim();
    if (!title) {
      toast.error('Give it a title first.');
      return;
    }

    setAddSubmitting(true);
    try {
      // Drop the new node near the centre of the current viewport — same
      // placement the existing `addIdea` uses.
      const containerEl = document.querySelector('.react-flow') as HTMLElement | null;
      const rect = containerEl?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const flowPos = flow.screenToFlowPosition({ x: cx, y: cy });
      const id = `${IDEA_NODE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // Default colour per kind. All three names exist in IDEA_PALETTE so
      // the per-node palette swap (hover toolbar) keeps working.
      const colorByType: Record<'task' | 'column' | 'project', string> = {
        task: 'emerald',
        column: 'sky',
        project: 'violet',
      };

      const idea: ExtraIdea = {
        id,
        label: title,
        x: flowPos.x - 100,
        y: flowPos.y - 24,
        color: colorByType[addDialog.type],
        kind: addDialog.type,
      };
      updateExtras((prev) => ({ ...prev, ideas: [...prev.ideas, idea] }));
      requestAnimationFrame(() => {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      });

      const successByKind: Record<'task' | 'column' | 'project', string> = {
        task: 'Task added to mind map',
        column: 'Column added to mind map',
        project: 'Project header added to mind map',
      };
      toast.success(successByKind[addDialog.type]);
      setAddDialog((s) => ({ ...s, open: false }));
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not add — please try again.';
      toast.error(msg);
    } finally {
      setAddSubmitting(false);
    }
  }, [addTitle, addDialog.type, flow, updateExtras]);

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

  /** Wipe every user-added placeholder (Idea / Task / Column / Project) AND any
   *  user-drawn edges in one shot. The auto-derived structural graph stays put
   *  because that mirrors the kanban — we only clear what the user added on
   *  the mind map surface. */
  const deleteAllPlaceholders = useCallback(() => {
    if (extras.ideas.length === 0 && extras.edges.length === 0) {
      toast.message('Nothing to delete — no placeholders or custom links yet.');
      return;
    }
    if (
      !window.confirm(
        `Delete all ${extras.ideas.length} placeholder${extras.ideas.length === 1 ? '' : 's'}` +
          `${extras.edges.length > 0 ? ` and ${extras.edges.length} custom link${extras.edges.length === 1 ? '' : 's'}` : ''}? This cannot be undone.`,
      )
    ) {
      return;
    }
    updateExtras((prev) => ({
      ...prev,
      ideas: [],
      edges: [],
      // Drop manual position overrides for ideas — auto-graph positions stay.
      positions: Object.fromEntries(
        Object.entries(prev.positions).filter(([k]) => !k.startsWith(IDEA_NODE_PREFIX)),
      ),
    }));
    toast.success('Cleared all placeholders');
  }, [extras.ideas.length, extras.edges.length, updateExtras]);

  const fitView = useCallback(() => {
    flow.fitView({ padding: 0.2, duration: 300 });
  }, [flow]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen?.().catch((err: unknown) => {
        toast.error(
          err instanceof Error
            ? `Fullscreen blocked: ${err.message}`
            : 'Fullscreen not available in this browser',
        );
      });
    }
  }, []);

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

  // ── "Connect" tool: click-two-nodes to wire instead of drag ────────
  // Some users (especially on touch devices) struggle with the drag-from-
  // handle gesture. Connect mode lets them tap one node, tap a second, and
  // we wire them up — no precision required.
  const [connectMode, setConnectMode] = useState(false);
  const [connectFirstNodeId, setConnectFirstNodeId] = useState<string | null>(null);

  const exitConnectMode = useCallback(() => {
    setConnectMode(false);
    setConnectFirstNodeId(null);
  }, []);

  // Esc cancels connect mode mid-gesture.
  useEffect(() => {
    if (!connectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitConnectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectMode, exitConnectMode]);

  const handleNodeClickForConnect = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (!connectMode) return;
      if (!connectFirstNodeId) {
        setConnectFirstNodeId(node.id);
        return;
      }
      if (connectFirstNodeId === node.id) {
        // Click same node twice = cancel selection
        setConnectFirstNodeId(null);
        return;
      }
      // Wire it up via the same path drag-connect uses, so persistence and
      // edge styling are identical. Pass null handles so React Flow picks
      // sensible defaults based on node positions.
      onConnect({
        source: connectFirstNodeId,
        target: node.id,
        sourceHandle: null,
        targetHandle: null,
      });
      exitConnectMode();
      toast.success('Connected');
    },
    [connectMode, connectFirstNodeId, onConnect, exitConnectMode],
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={containerRef}
      className="relative h-full w-full bg-background rounded-lg border border-border overflow-hidden"
      onContextMenu={handleContextMenu}
      onClick={closeContextMenu}
    >
      {/* Floating toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-card/95 backdrop-blur px-1.5 py-1 shadow-md">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" title="Add to mind map">
              <Plus className="w-3.5 h-3.5" />
              Add
              <ChevronDown className="w-3 h-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Add to mind map only — kanban is never changed
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openAddDialog('task')}>
              <CheckSquare className="w-3.5 h-3.5 mr-2 text-emerald-500" />
              <div className="flex flex-col">
                <span>Task</span>
                <span className="text-[10px] text-muted-foreground">Task-card shape — like a real task</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAddDialog('column')}>
              <Columns className="w-3.5 h-3.5 mr-2 text-sky-500" />
              <div className="flex flex-col">
                <span>Column</span>
                <span className="text-[10px] text-muted-foreground">Column-pill shape — like a real lane</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openAddDialog('project')}>
              <Sparkles className="w-3.5 h-3.5 mr-2 text-primary" />
              <div className="flex flex-col">
                <span>Project header</span>
                <span className="text-[10px] text-muted-foreground">Header card with the project name</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={addIdea}>
              <Lightbulb className="w-3.5 h-3.5 mr-2 text-amber-500" />
              <div className="flex flex-col">
                <span>Idea</span>
                <span className="text-[10px] text-muted-foreground">Free-form brainstorm note</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant={connectMode ? 'default' : 'ghost'}
          className={cn('h-8 gap-1.5 text-xs', connectMode && 'shadow-sm')}
          onClick={() =>
            connectMode ? exitConnectMode() : setConnectMode(true)
          }
          title="Click a node, then another, to connect them — no drag needed"
          aria-pressed={connectMode}
        >
          <Link2 className="w-3.5 h-3.5" />
          {connectMode ? 'Cancel' : 'Connect'}
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
        {extras.removedAutoEdges.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-amber-600 dark:text-amber-300 hover:bg-amber-500/10"
            onClick={() =>
              updateExtras((prev) => ({ ...prev, removedAutoEdges: [] }))
            }
            title={`Restore ${extras.removedAutoEdges.length} hidden connection${extras.removedAutoEdges.length === 1 ? '' : 's'}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore links ({extras.removedAutoEdges.length})
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
          onClick={deleteAllPlaceholders}
          disabled={extras.ideas.length === 0 && extras.edges.length === 0}
          title="Delete every placeholder & custom link in one go"
        >
          <Eraser className="w-3.5 h-3.5" />
          Clear all
        </Button>
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
          className="h-8 gap-1.5 text-xs"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Open mind map in fullscreen'}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? (
            <Minimize className="w-3.5 h-3.5" />
          ) : (
            <Maximize className="w-3.5 h-3.5" />
          )}
          {isFullscreen ? 'Exit' : 'Fullscreen'}
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

      {/* Connect-mode hint banner */}
      {connectMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shadow-lg">
          <Link2 className="w-3.5 h-3.5" />
          {connectFirstNodeId ? 'Now click the second node' : 'Click the first node to connect'}
          <span className="text-primary-foreground/60 ml-1">· Esc to cancel</span>
        </div>
      )}

      <ReactFlow
        nodes={
          connectMode && connectFirstNodeId
            ? nodes.map((n) =>
                n.id === connectFirstNodeId ? { ...n, selected: true } : n,
              )
            : nodes
        }
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClickForConnect}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        connectionRadius={28}
        connectOnClick={false}
        defaultEdgeOptions={{
          type: 'deletable',
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

      {/* Inline task editor — opens on task-node click. The mind map never
          navigates to the kanban now; everything happens here. */}
      <MindMapTaskPanel
        open={!!openTaskId}
        task={openTask}
        organizationId={project.organizationId || ''}
        userId={user?.userId || ''}
        userDisplayName={user?.displayName || user?.email || 'User'}
        onOpenChange={(v) => {
          if (!v) setOpenTaskId(null);
        }}
        onAttachmentsChanged={(taskId, delta) => {
          setAttachmentCounts((prev) => {
            const next = new Map(prev);
            next.set(taskId, Math.max(0, (next.get(taskId) ?? 0) + delta));
            return next;
          });
        }}
      />

      {/* Placeholder task panel — opens when a task-shape PLACEHOLDER is
          clicked. Same UX as the real task panel but every change writes
          to extras (mind-map only) rather than the tasks table. */}
      <MindMapPlaceholderPanel
        open={!!openPlaceholderId}
        placeholder={openPlaceholder}
        organizationId={project.organizationId || ''}
        projectId={project.projectId}
        userId={user?.userId || ''}
        userDisplayName={user?.displayName || user?.email || 'User'}
        onOpenChange={(v) => {
          if (!v) setOpenPlaceholderId(null);
        }}
        onPatch={async (patch) => {
          if (!openPlaceholderId) return;
          handleIdeaChange(openPlaceholderId, patch);
        }}
      />

      {/* Modal for naming a Task / Column / Project note that lives on the
          mind map only. Everything submitted here goes into per-user
          mind-map state — the kanban board / project columns / tasks table
          are never touched. */}
      <Dialog open={addDialog.open} onOpenChange={(o) => !o && closeAddDialog()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {addDialog.type === 'task' ? (
                <>
                  <CheckSquare className="w-4 h-4 text-emerald-500" /> Add task note
                </>
              ) : addDialog.type === 'column' ? (
                <>
                  <Columns className="w-4 h-4 text-sky-500" /> Add column note
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-primary" /> Add project header
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              This adds a note to the mind map only. Nothing is added to the
              kanban board or project columns.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                {addDialog.type === 'project' ? 'Header label' : 'Title'}
              </label>
              <Input
                autoFocus
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder={
                  addDialog.type === 'task'
                    ? 'e.g. Draft launch announcement'
                    : addDialog.type === 'column'
                      ? 'e.g. Review'
                      : project.name
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submitAddDialog();
                  }
                }}
              />
              {addDialog.type === 'project' && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Pre-filled with this project's name — change it if you want a different label.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeAddDialog} disabled={addSubmitting}>
              Cancel
            </Button>
            <Button onClick={() => void submitAddDialog()} disabled={addSubmitting || !addTitle.trim()}>
              {addSubmitting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add to mind map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Public component (wraps with ReactFlowProvider so useReactFlow works in MindMapInner)
// ─────────────────────────────────────────────────────────────

type MindMapMode = 'project' | 'ai';

interface StructuralMapProps extends ProjectMindMapProps {
  /** Set by the wrapper when the user clicks "Send to Project map" in AI mode.
   *  Consumed once on mount via a useEffect, then cleared via onPendingImportApplied. */
  pendingImport?: AIMapImportPayload | null;
  onPendingImportApplied?: () => void;
}

const ProjectStructuralMap: React.FC<StructuralMapProps> = (props) => {
  // Always mount the canvas so the toolbar's Add button (Task / Column /
  // Project / Idea) is reachable even when the kanban has no tasks yet
  // and no ideas have been saved. A static "empty" placeholder here would
  // hide the canvas the empty-state hint itself tells the user to click,
  // and would also briefly flash after a Send-to-Project-map import
  // completes (between pendingImport clearing and the new ideas being
  // observed via loadExtras).
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  );
};

export const ProjectMindMap: React.FC<ProjectMindMapProps> = (props) => {
  const [mode, setMode] = useState<MindMapMode>('project');
  // Hand-off slot for content sent from the AI map. The structural map drains
  // it on mount via a useEffect, then calls back to clear it. Stored at the
  // wrapper so it survives the ProjectStructuralMap remount that happens
  // when modes flip.
  const [pendingImport, setPendingImport] = useState<AIMapImportPayload | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && props.onOpenTask != null) {
      console.warn(
        '[ProjectMindMap] The `onOpenTask` prop is ignored. Task nodes open the inline mind map task panel instead of invoking this callback. Remove `onOpenTask` or rely on task data updates from your existing queries.',
      );
    }
  }, [props.onOpenTask]);

  const handleSendToProjectMap = useCallback((payload: AIMapImportPayload) => {
    setPendingImport(payload);
    setMode('project');
  }, []);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Mode switcher — sits above the canvas so the existing toolbar inside
          ProjectStructuralMap stays untouched. The AI map is a separate
          self-contained surface; switching modes is purely visual. */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card/80 backdrop-blur p-0.5 self-start shadow-sm">
        <button
          type="button"
          onClick={() => setMode('project')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5',
            mode === 'project'
              ? 'bg-primary text-primary-foreground shadow'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
          )}
          aria-pressed={mode === 'project'}
        >
          <Sparkles className="w-3 h-3" />
          Project map
        </button>
        <button
          type="button"
          onClick={() => setMode('ai')}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5',
            mode === 'ai'
              ? 'bg-primary text-primary-foreground shadow'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
          )}
          aria-pressed={mode === 'ai'}
        >
          <Lightbulb className="w-3 h-3" />
          AI mind map
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {mode === 'project' ? (
          <ProjectStructuralMap
            {...props}
            pendingImport={pendingImport}
            onPendingImportApplied={() => setPendingImport(null)}
          />
        ) : (
          <AIMindMap onSendToProjectMap={handleSendToProjectMap} />
        )}
      </div>
    </div>
  );
};

export default ProjectMindMap;
