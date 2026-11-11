// Shared types + constants for the project mind map. Kept free of React /
// React Flow imports so the pure helpers (layout, history, search, extras
// migration) can be unit-tested without a DOM canvas.

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

/** Subtasks for a placeholder. Same shape the real Task uses. */
export interface PlaceholderSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export type PlaceholderKind = 'task' | 'column' | 'project';

export interface ExtraIdea {
  id: string;
  label: string;
  x: number;
  y: number;
  color?: string;
  /** Optional visual style for this placeholder. Undefined = brainstorm idea.
   *  'task' / 'column' / 'project' render in the matching board-derived shape
   *  — purely cosmetic, the data lives in extras and never reaches the kanban. */
  kind?: PlaceholderKind;
  /** Free-form notes shown when the placeholder panel is open. */
  description?: string;
  /** Mind-map-only subtasks — never written to the kanban. */
  subtasks?: PlaceholderSubtask[];
  /** Files uploaded for this placeholder (stored as project files). */
  attachments?: PlaceholderAttachment[];
}

export interface ExtraEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Persisted per-user, per-project layer on top of the board-derived graph.
 *  Shape is shared by localStorage (`mindmap_extras_v1:<projectId>`) and the
 *  cloud `mind_map_state.state` JSONB column. New fields MUST be optional. */
export interface MindMapExtras {
  ideas: ExtraIdea[];
  edges: ExtraEdge[];
  /** node id → manual position override (covers board-derived nodes too). */
  positions: Record<string, { x: number; y: number }>;
  /** Auto-edge ids the user has hidden from the canvas. */
  removedAutoEdges: string[];
  /** Column node ids (`col-<columnId>`) whose tasks are collapsed. Optional —
   *  added in the 2026-11 mind map refresh; older data simply lacks it. */
  collapsedColumns?: string[];
}

export const EMPTY_EXTRAS: MindMapExtras = {
  ideas: [],
  edges: [],
  positions: {},
  removedAutoEdges: [],
};

// Edge IDs starting with USER_EDGE_PREFIX are drawn by the user. AUTO_EDGE_PREFIX
// edges are derived from the project structure; the user can hide them.
export const USER_EDGE_PREFIX = 'extra-edge-';
export const AUTO_EDGE_PREFIX = 'auto-edge-';
export const IDEA_NODE_PREFIX = 'idea-';
export const PROJECT_NODE_ID = 'project';
export const COLUMN_NODE_PREFIX = 'col-';
export const TASK_NODE_PREFIX = 'task-';
export const SUBTASK_NODE_PREFIX = 'sub-';

/** Idea colours. Names are persisted in `ExtraIdea.color` — never rename. */
export const IDEA_PALETTE: Array<{
  name: string;
  ring: string;
  bg: string;
  dot: string;
  /** Solid colour for the minimap. */
  solid: string;
}> = [
  { name: 'violet', ring: 'border-violet-500/35', bg: 'bg-violet-500/[0.07]', dot: 'bg-violet-500', solid: 'rgb(139,92,246)' },
  { name: 'sky', ring: 'border-sky-500/35', bg: 'bg-sky-500/[0.07]', dot: 'bg-sky-500', solid: 'rgb(14,165,233)' },
  { name: 'emerald', ring: 'border-emerald-500/35', bg: 'bg-emerald-500/[0.07]', dot: 'bg-emerald-500', solid: 'rgb(16,185,129)' },
  { name: 'amber', ring: 'border-amber-500/35', bg: 'bg-amber-500/[0.08]', dot: 'bg-amber-500', solid: 'rgb(245,158,11)' },
  { name: 'rose', ring: 'border-rose-500/35', bg: 'bg-rose-500/[0.07]', dot: 'bg-rose-500', solid: 'rgb(244,63,94)' },
];

export const paletteFor = (name: string | undefined) =>
  IDEA_PALETTE.find((p) => p.name === name) || IDEA_PALETTE[0];

export const newIdeaId = () =>
  `${IDEA_NODE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const newUserEdgeId = () =>
  `${USER_EDGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
