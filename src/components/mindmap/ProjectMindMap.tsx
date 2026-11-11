import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
  type EdgeTypes,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
  type ReactFlowState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CheckSquare,
  Columns,
  FileJson,
  Image,
  LayoutGrid,
  Link2,
  Pencil,
  Plus,
  Scan,
  Sparkles,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import type { Project, Task, KanbanColumn } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import {
  saveMindMapState as saveToCloud,
  migrateLocalStorageToCloud,
} from '@/services/supabase/mindmapState';
import { uploadFileWithProgress, getProjectFiles } from '@/services/supabase/storage';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { AIMindMap, type AIMapImportPayload } from './AIMindMap';
import { MindMapTaskPanel } from './MindMapTaskPanel';
import { MindMapPlaceholderPanel } from './MindMapPlaceholderPanel';
import { DeletableEdge, type DeletableEdgeData } from './DeletableEdge';
import { NODE_TYPES, type IdeaNodeData } from './mindMapNodes';
import {
  buildBaseGraph,
  subtaskNodeId,
  USER_EDGE_MARKER,
  USER_EDGE_STYLE,
} from './mindMapGraph';
import {
  AUTO_EDGE_PREFIX,
  COLUMN_NODE_PREFIX,
  EMPTY_EXTRAS,
  IDEA_NODE_PREFIX,
  IDEA_PALETTE,
  PROJECT_NODE_ID,
  TASK_NODE_PREFIX,
  USER_EDGE_PREFIX,
  newIdeaId,
  newUserEdgeId,
  paletteFor,
  type ExtraEdge,
  type ExtraIdea,
  type MindMapExtras,
  type PlaceholderKind,
} from './mindMapTypes';
import { loadExtras, mergeCloudExtras, saveExtras } from './mindMapExtras';
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createHistory,
  peekUndoId,
  pushHistory,
  redoHistory,
  undoHistory,
} from './mindMapHistory';
import {
  NODE_SIZE,
  placeChild,
  placeSibling,
  tidyLayout,
  type BoardNodeKind,
  type Box,
} from './mindMapLayout';
import type { SearchItem } from './mindMapSearch';
import { MindMapModeSwitch, MindMapToolbar, type MindMapMode, type MindMapToolbarProps } from './MindMapToolbar';
import {
  FirstTimeTip,
  HelpButton,
  MindMapEmptyState,
  ShortcutsPanel,
  readTipDismissed,
  writeTipDismissed,
} from './MindMapOverlays';

// Re-exported for MindMapPlaceholderPanel (and any other importer) — the
// types moved to mindMapTypes.ts when this file was split up.
export type { PlaceholderAttachment, PlaceholderSubtask } from './mindMapTypes';

const EDGE_TYPES: EdgeTypes = {
  deletable: DeletableEdge as unknown as EdgeTypes[string],
};

const MINIMAP_PREF_KEY = 'mindmap_minimap_v1';

const readMiniMapPref = (): boolean => {
  try {
    const v = window.localStorage.getItem(MINIMAP_PREF_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
};

const PLACEHOLDER_COLOR: Record<PlaceholderKind, string> = {
  task: 'emerald',
  column: 'sky',
  project: 'violet',
};

/** Scoped CSS for React Flow internals we can't reach with Tailwind classes. */
const CANVAS_CSS = `
.mm-canvas .react-flow__node:focus { outline: none; }
.mm-canvas .react-flow__node:focus-visible > div { box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring)); }
.mm-canvas .react-flow__edge.selected .react-flow__edge-path,
.mm-canvas .react-flow__edge:focus-visible .react-flow__edge-path { stroke: hsl(var(--primary)) !important; stroke-width: 2.5px !important; }
.mm-canvas .react-flow__edge:focus { outline: none; }
.mm-canvas .react-flow__selection,
.mm-canvas .react-flow__nodesselection-rect { background: hsl(var(--primary) / 0.06); border: 1px solid hsl(var(--primary) / 0.45); border-radius: 8px; }
.mm-canvas .react-flow__connectionline path { stroke: hsl(var(--primary)); stroke-width: 2; }
.mm-canvas .react-flow__minimap svg { border-radius: 12px; }
`;

const zoomSelector = (s: ReactFlowState) => s.transform[2];

/** Toolbar wrapper that subscribes to zoom only, so panning / zooming doesn't
 *  re-render the whole canvas component. */
const ConnectedToolbar: React.FC<Omit<MindMapToolbarProps, 'zoom'>> = memo((props) => {
  const zoom = useStore(zoomSelector);
  return <MindMapToolbar {...props} zoom={zoom} />;
});
ConnectedToolbar.displayName = 'ConnectedToolbar';

// ─────────────────────────────────────────────────────────────
// Inner mind map (uses useReactFlow — must live under a Provider)
// ─────────────────────────────────────────────────────────────

interface ProjectMindMapProps {
  project: Project;
  tasks: Task[];
  columns: KanbanColumn[];
  onOpenTask?: (taskId: string) => void;
}

interface StructuralMapProps extends ProjectMindMapProps {
  /** Set by the wrapper when the user clicks "Send to Project map" in AI mode.
   *  Consumed once on mount via a useEffect, then cleared via onPendingImportApplied. */
  pendingImport?: AIMapImportPayload | null;
  onPendingImportApplied?: () => void;
  /** Project map / AI mind map segmented control, rendered inside the toolbar. */
  modeSwitch?: React.ReactNode;
  /** Switch to the AI mind map (empty-state action). */
  onOpenAIMode?: () => void;
}

type ConfirmKind = 'clear' | 'reset' | null;

const MindMapInner: React.FC<StructuralMapProps> = ({
  project,
  tasks,
  columns,
  pendingImport,
  onPendingImportApplied,
  modeSwitch,
  onOpenAIMode,
  // `onOpenTask` is intentionally ignored — clicking a task opens the inline
  // MindMapTaskPanel. The prop stays in the type so call sites compile.
}) => {
  const flow = useReactFlow();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Extras (user layer) + undo history ─────────────────────
  const [extras, setExtrasState] = useState<MindMapExtras>(() => loadExtras(project.projectId));
  const extrasRef = useRef(extras);
  const historyRef = useRef(createHistory<MindMapExtras>());
  const [, setHistoryVersion] = useState(0);
  const changeIdRef = useRef(0);
  const cloudSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (next: MindMapExtras) => {
      saveExtras(project.projectId, next);
      if (user?.userId) {
        const userId = user.userId;
        if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
        cloudSaveTimer.current = setTimeout(() => {
          void saveToCloud(project.projectId, userId, next);
        }, 2000);
      }
    },
    [project.projectId, user?.userId],
  );

  const commitExtras = useCallback(
    (next: MindMapExtras) => {
      extrasRef.current = next;
      setExtrasState(next);
      persist(next);
    },
    [persist],
  );

  /** Every user-layer mutation goes through here: it records undo history,
   *  updates state and persists (localStorage now, cloud debounced). Returns
   *  the change id (for toast "Undo" actions) or null if nothing changed. */
  const updateExtras = useCallback(
    (mutator: (prev: MindMapExtras) => MindMapExtras): number | null => {
      const prev = extrasRef.current;
      const next = mutator(prev);
      if (next === prev) return null;
      const id = ++changeIdRef.current;
      historyRef.current = pushHistory(historyRef.current, prev, id);
      setHistoryVersion((v) => v + 1);
      commitExtras(next);
      return id;
    },
    [commitExtras],
  );

  const [editingId, setEditingId] = useState<string | null>(null);

  const undo = useCallback(() => {
    const r = undoHistory(historyRef.current, extrasRef.current);
    if (!r) return false;
    historyRef.current = r.history;
    setHistoryVersion((v) => v + 1);
    setEditingId(null);
    commitExtras(r.state);
    return true;
  }, [commitExtras]);

  const redo = useCallback(() => {
    const r = redoHistory(historyRef.current, extrasRef.current);
    if (!r) return false;
    historyRef.current = r.history;
    setHistoryVersion((v) => v + 1);
    setEditingId(null);
    commitExtras(r.state);
    return true;
  }, [commitExtras]);

  /** Undo a specific change from a toast — only if nothing newer happened. */
  const undoChange = useCallback(
    (id: number | null) => {
      if (id === null) return;
      if (peekUndoId(historyRef.current) !== id) {
        toast.message('Use Undo in the toolbar — newer changes came after this one.');
        return;
      }
      undo();
    },
    [undo],
  );

  const toastWithUndo = useCallback(
    (message: string, id: number | null) => {
      if (id === null) return;
      toast(message, { action: { label: 'Undo', onClick: () => undoChange(id) } });
    },
    [undoChange],
  );

  // Cloud-load gate: until this is true we don't apply a pendingImport, so
  // the import doesn't get clobbered by the cloud snapshot.
  const [cloudLoaded, setCloudLoaded] = useState(false);

  useEffect(() => {
    const userId = user?.userId;
    setCloudLoaded(false);
    const reset = (next: MindMapExtras) => {
      extrasRef.current = next;
      setExtrasState(next);
      historyRef.current = createHistory<MindMapExtras>();
      setHistoryVersion((v) => v + 1);
    };
    if (!userId) {
      reset(loadExtras(project.projectId));
      setCloudLoaded(true);
      return;
    }
    let cancelled = false;
    void migrateLocalStorageToCloud(project.projectId, userId).then((cloud) => {
      if (cancelled) return;
      // Cloud wins when it has data (unchanged); UI-only optional fields the
      // cloud reader drops (collapsed columns) are kept from the local copy.
      reset(mergeCloudExtras(cloud, loadExtras(project.projectId)));
      setCloudLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [project.projectId, user?.userId]);

  // ── Import payload from the AI mind map ─────────────────────
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
    for (const n of pendingImport.nodes) remap.set(n.id, `${IDEA_NODE_PREFIX}${stamp}-${n.id}`);

    // Offset so the imported subtree lands right of the board content.
    const X_OFFSET = 1700;
    const colorFor = (branchIndex: number): string =>
      branchIndex < 0 ? IDEA_PALETTE[0].name : IDEA_PALETTE[branchIndex % IDEA_PALETTE.length].name;

    const newIdeas: ExtraIdea[] = pendingImport.nodes.map((n) => ({
      id: remap.get(n.id) || `${IDEA_NODE_PREFIX}${stamp}-${n.id}`,
      label: n.label,
      x: n.x + X_OFFSET,
      y: n.y,
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

    const changeId = updateExtras((prev) => ({
      ...prev,
      ideas: [...prev.ideas, ...newIdeas],
      edges: [...prev.edges, ...newEdges],
    }));

    requestAnimationFrame(() => {
      try {
        flow.fitView({ padding: 0.2, duration: 200 });
      } catch {
        /* fit ok to fail before the canvas mounts */
      }
    });

    onPendingImportApplied?.();
    toastWithUndo(
      newIdeas.length === 1 ? '1 idea added from the AI mind map' : `${newIdeas.length} ideas added from the AI mind map`,
      changeId,
    );
  }, [pendingImport, cloudLoaded, updateExtras, flow, onPendingImportApplied, toastWithUndo]);

  // ── Per-task attachment state ───────────────────────────────
  const [attachmentCounts, setAttachmentCounts] = useState<Map<string, number>>(new Map());
  const [uploadingTaskIds, setUploadingTaskIds] = useState<Set<string>>(new Set());

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

      setUploadingTaskIds((prev) => new Set(prev).add(taskId));
      const toastId = toast.loading(
        list.length === 1 ? `Uploading ${list[0].name}…` : `Uploading ${list.length} files…`,
      );

      let success = 0;
      let failed = 0;
      for (const file of list) {
        try {
          await uploadFileWithProgress(user.userId, user.displayName || user.email || 'User', orgId, {
            projectId: project.projectId,
            taskId,
            file,
            scope: 'task',
          });
          success += 1;
        } catch {
          failed += 1;
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
        toast.success(success === 1 ? 'File attached' : `${success} files attached`, { id: toastId });
      } else if (success === 0) {
        toast.error('Upload failed. Check your connection and try again.', { id: toastId });
      } else {
        toast.warning(`Attached ${success}, ${failed} failed`, { id: toastId });
      }
    },
    [project.projectId, project.organizationId, user?.userId, user?.displayName, user?.email],
  );

  // ── Inline task panel ───────────────────────────────────────
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = useMemo(
    () => (openTaskId ? tasks.find((t) => t.taskId === openTaskId) ?? null : null),
    [openTaskId, tasks],
  );
  // Refs read by callbacks baked into node data (declared before the graph).
  const connectModeRef = useRef(false);
  const addChildRef = useRef<((id: string) => void) | null>(null);
  const addChildStable = useCallback((id: string) => addChildRef.current?.(id), []);
  const handleOpenTaskInline = useCallback((taskId: string) => {
    // While connecting, a click on a card picks it instead of opening it.
    if (connectModeRef.current) return;
    setOpenTaskId(taskId);
  }, []);

  // ── Placeholder panel ───────────────────────────────────────
  const [openPlaceholderId, setOpenPlaceholderId] = useState<string | null>(null);
  const openPlaceholder = useMemo(
    () => (openPlaceholderId ? extras.ideas.find((i) => i.id === openPlaceholderId) ?? null : null),
    [openPlaceholderId, extras.ideas],
  );

  // ── Collapse columns ────────────────────────────────────────
  const collapsedSet = useMemo(() => new Set(extras.collapsedColumns ?? []), [extras.collapsedColumns]);
  const toggleCollapse = useCallback(
    (columnNodeId: string) => {
      updateExtras((prev) => {
        const cur = new Set(prev.collapsedColumns ?? []);
        if (cur.has(columnNodeId)) cur.delete(columnNodeId);
        else cur.add(columnNodeId);
        const next: MindMapExtras = { ...prev };
        if (cur.size > 0) next.collapsedColumns = [...cur];
        else delete next.collapsedColumns;
        return next;
      });
    },
    [updateExtras],
  );

  // Board-derived graph.
  const baseGraph = useMemo(
    () =>
      buildBaseGraph(project, tasks, columns, {
        onOpenTask: handleOpenTaskInline,
        onAttachFilesToTask: handleAttachFilesToTask,
        attachmentCounts,
        uploadingTaskIds,
        collapsed: collapsedSet,
        onToggleCollapse: toggleCollapse,
        onAddChild: addChildStable,
      }),
    [
      project,
      tasks,
      columns,
      handleOpenTaskInline,
      handleAttachFilesToTask,
      attachmentCounts,
      uploadingTaskIds,
      collapsedSet,
      toggleCollapse,
      addChildStable,
    ],
  );

  // ── React Flow controlled state ─────────────────────────────
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  /** Node to select on the next re-seed (new ideas). */
  const pendingSelectRef = useRef<string | null>(null);

  /** Current on-canvas box for a node (measured size when available). */
  const boxOf = useCallback(
    (id: string): Box | null => {
      const n = nodesRef.current.find((x) => x.id === id);
      if (!n) return null;
      const kind = (n.type ?? 'idea') as BoardNodeKind | 'idea';
      const fallback = NODE_SIZE[kind] ?? NODE_SIZE.idea;
      return {
        x: n.position.x,
        y: n.position.y,
        w: n.measured?.width ?? fallback.w,
        h: n.measured?.height ?? fallback.h,
      };
    },
    [],
  );

  // ── Idea mutations ──────────────────────────────────────────
  const handleIdeaChange = useCallback(
    (id: string, patch: Partial<ExtraIdea>) => {
      updateExtras((prev) => ({
        ...prev,
        ideas: prev.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      }));
    },
    [updateExtras],
  );

  /** Delete ideas and/or links. Auto (board) links are hidden, not deleted;
   *  board cards themselves can't be deleted from the map. */
  const removeItems = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      const ideaSet = new Set(nodeIds.filter((id) => id.startsWith(IDEA_NODE_PREFIX)));
      const userEdgeSet = new Set(edgeIds.filter((id) => id.startsWith(USER_EDGE_PREFIX)));
      const autoIds = edgeIds.filter((id) => id.startsWith(AUTO_EDGE_PREFIX));
      if (ideaSet.size === 0 && userEdgeSet.size === 0 && autoIds.length === 0) {
        if (nodeIds.length > 0) toast.message('Tasks and columns come from the board — edit them there.');
        return;
      }
      const prevEdgeCount = extrasRef.current.edges.length;
      const changeId = updateExtras((prev) => ({
        ...prev,
        ideas: prev.ideas.filter((i) => !ideaSet.has(i.id)),
        edges: prev.edges.filter(
          (e) => !userEdgeSet.has(e.id) && !ideaSet.has(e.source) && !ideaSet.has(e.target),
        ),
        positions: Object.fromEntries(Object.entries(prev.positions).filter(([k]) => !ideaSet.has(k))),
        removedAutoEdges:
          autoIds.length > 0 ? Array.from(new Set([...prev.removedAutoEdges, ...autoIds])) : prev.removedAutoEdges,
      }));
      if (editingId && ideaSet.has(editingId)) setEditingId(null);
      if (openPlaceholderId && ideaSet.has(openPlaceholderId)) setOpenPlaceholderId(null);

      const linkCount = prevEdgeCount - extrasRef.current.edges.length + autoIds.length;
      const parts: string[] = [];
      if (ideaSet.size > 0) parts.push(ideaSet.size === 1 ? '1 idea' : `${ideaSet.size} ideas`);
      if (linkCount > 0) parts.push(linkCount === 1 ? '1 link' : `${linkCount} links`);
      toastWithUndo(`Deleted ${parts.join(' and ')}`, changeId);
    },
    [updateExtras, editingId, openPlaceholderId, toastWithUndo],
  );

  const createIdea = useCallback(
    (idea: ExtraIdea, linkFrom?: string, opts: { edit?: boolean } = {}) => {
      updateExtras((prev) => ({
        ...prev,
        ideas: [...prev.ideas, idea],
        edges: linkFrom
          ? [
              ...prev.edges,
              { id: newUserEdgeId(), source: linkFrom, target: idea.id, sourceHandle: 'r-src', targetHandle: 'l-tgt' },
            ]
          : prev.edges,
      }));
      pendingSelectRef.current = idea.id;
      if (opts.edit !== false) setEditingId(idea.id);
    },
    [updateExtras],
  );

  const viewportCentre = useCallback(() => {
    const el = containerRef.current?.querySelector('.react-flow') as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return flow.screenToFlowPosition({ x: cx, y: cy });
  }, [flow]);

  const addIdeaAt = useCallback(
    (pos: { x: number; y: number }) => {
      createIdea({
        id: newIdeaId(),
        label: 'New idea',
        x: pos.x - NODE_SIZE.idea.w / 2,
        y: pos.y - NODE_SIZE.idea.h / 2,
        color: IDEA_PALETTE[0].name,
      });
    },
    [createIdea],
  );

  const addIdea = useCallback(() => addIdeaAt(viewportCentre()), [addIdeaAt, viewportCentre]);

  const ideaColorOf = useCallback(
    (id: string) => extrasRef.current.ideas.find((i) => i.id === id)?.color,
    [],
  );

  /** Tab: add an idea to the right of `parentId`, linked from it. */
  const addChild = useCallback(
    (parentId: string) => {
      const parent = boxOf(parentId);
      if (!parent) return;
      const childBoxes = extrasRef.current.edges
        .filter((e) => e.source === parentId)
        .map((e) => boxOf(e.target))
        .filter((b): b is Box => !!b && b.x > parent.x);
      const pos = placeChild(parent, childBoxes);
      createIdea(
        {
          id: newIdeaId(),
          label: 'New idea',
          x: pos.x,
          y: pos.y,
          color: ideaColorOf(parentId) ?? IDEA_PALETTE[0].name,
        },
        parentId,
      );
    },
    [boxOf, createIdea, ideaColorOf],
  );
  addChildRef.current = addChild;

  /** Enter on an idea: add a sibling below it (linked from the same parent). */
  const addSibling = useCallback(
    (id: string) => {
      const box = boxOf(id);
      if (!box) return;
      const parentId = extrasRef.current.edges.find((e) => e.target === id)?.source;
      const siblings = parentId
        ? extrasRef.current.edges
            .filter((e) => e.source === parentId && e.target !== id)
            .map((e) => boxOf(e.target))
            .filter((b): b is Box => !!b && Math.abs(b.x - box.x) < 40)
        : [];
      const pos = placeSibling(box, siblings);
      createIdea(
        { id: newIdeaId(), label: 'New idea', x: pos.x, y: pos.y, color: ideaColorOf(id) ?? IDEA_PALETTE[0].name },
        parentId,
      );
    },
    [boxOf, createIdea, ideaColorOf],
  );

  const commitLabel = useCallback(
    (id: string, label: string) => {
      setEditingId((cur) => (cur === id ? null : cur));
      const idea = extrasRef.current.ideas.find((i) => i.id === id);
      if (idea && idea.label !== label) handleIdeaChange(id, { label });
    },
    [handleIdeaChange],
  );

  // ── Compose nodes / edges ───────────────────────────────────
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
          projectDescription: i.kind === 'project' ? project.description : undefined,
          attachmentCount: i.kind === 'task' ? i.attachments?.length ?? 0 : 0,
          subtaskProgress:
            i.kind === 'task' ? { completed: subs.filter((s) => s.completed).length, total: subs.length } : undefined,
          onOpen:
            i.kind === 'task'
              ? () => {
                  if (!connectModeRef.current) setOpenPlaceholderId(i.id);
                }
              : undefined,
          isEditing: editingId === i.id,
          onStartEdit: () => setEditingId(i.id),
          onCommit: (label: string) => commitLabel(i.id, label),
          onCancelEdit: () => setEditingId((cur) => (cur === i.id ? null : cur)),
          onCommitAndAddChild: (label: string) => {
            commitLabel(i.id, label);
            addChild(i.id);
          },
          onDelete: () => removeItems([i.id], []),
          onColorChange: (color: string) => handleIdeaChange(i.id, { color }),
          onAddChild: () => addChild(i.id),
        } satisfies IdeaNodeData,
      };
    });
    return [...base, ...ideaNodes];
  }, [baseGraph.nodes, extras, editingId, project.description, commitLabel, addChild, removeItems, handleIdeaChange]);

  const composedEdges = useMemo<Edge[]>(() => {
    const removed = new Set(extras.removedAutoEdges);
    const visibleIds = new Set(composedNodes.map((n) => n.id));
    const data: DeletableEdgeData = {
      onDelete: (edgeId: string) => removeItems([], [edgeId]),
      curve: 'bezier',
      revealOnHover: true,
    };
    const base = baseGraph.edges
      .filter((e) => !removed.has(e.id))
      .map((e) => ({ ...e, type: 'deletable', data: { ...data, removeLabel: 'Hide link' } }));
    const user: Edge[] = extras.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: 'deletable',
        markerEnd: USER_EDGE_MARKER,
        style: USER_EDGE_STYLE,
        data,
      }));
    return [...base, ...user];
  }, [baseGraph.edges, extras.edges, extras.removedAutoEdges, composedNodes, removeItems]);

  // Re-seed React Flow state when the composition changes, keeping selection
  // and measured sizes so nothing flickers or deselects on every edit.
  useEffect(() => {
    const select = pendingSelectRef.current;
    pendingSelectRef.current = null;
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return composedNodes.map((n) => {
        const old = prevById.get(n.id);
        const selected = select ? n.id === select : !!old?.selected;
        return old?.measured ? { ...n, selected, measured: old.measured } : { ...n, selected };
      });
    });
  }, [composedNodes]);

  useEffect(() => {
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return composedEdges.map((e) => (sel.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [composedEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      const drops = changes.filter(
        (c): c is Extract<NodeChange, { type: 'position' }> =>
          c.type === 'position' && c.dragging === false && !!c.position,
      );
      if (drops.length === 0) return;
      updateExtras((prev) => {
        const positions = { ...prev.positions };
        let changed = false;
        for (const c of drops) {
          if (!c.position) continue;
          const old = positions[c.id];
          if (old && old.x === c.position.x && old.y === c.position.y) continue;
          positions[c.id] = c.position;
          changed = true;
        }
        return changed ? { ...prev, positions } : prev;
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
      if (connection.source === connection.target) return;
      updateExtras((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: newUserEdgeId(),
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle,
            targetHandle: connection.targetHandle,
          },
        ],
      }));
    },
    [updateExtras],
  );

  // ── Add placeholder dialog (mind-map only) ───────────────────
  // Hard rule: NOTHING the user does on the mind map writes to the kanban.
  const [addDialog, setAddDialog] = useState<{ open: boolean; type: PlaceholderKind }>({
    open: false,
    type: 'task',
  });
  const [addTitle, setAddTitle] = useState('');

  const openAddDialog = useCallback(
    (type: PlaceholderKind) => {
      setAddTitle(type === 'project' ? project.name : '');
      setAddDialog({ open: true, type });
    },
    [project.name],
  );

  const submitAddDialog = useCallback(() => {
    const title = addTitle.trim();
    if (!title) {
      toast.error('Give it a title first.');
      return;
    }
    const c = viewportCentre();
    const type = addDialog.type;
    createIdea(
      {
        id: newIdeaId(),
        label: title,
        x: c.x - 150,
        y: c.y - 40,
        color: PLACEHOLDER_COLOR[type],
        kind: type,
      },
      undefined,
      { edit: false },
    );
    setAddDialog((s) => ({ ...s, open: false }));
  }, [addTitle, addDialog.type, viewportCentre, createIdea]);

  // ── Bulk actions (confirmed + undoable) ─────────────────────
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  const clearPlaceholders = useCallback(() => {
    const changeId = updateExtras((prev) =>
      prev.ideas.length === 0 && prev.edges.length === 0
        ? prev
        : {
            ...prev,
            ideas: [],
            edges: [],
            positions: Object.fromEntries(
              Object.entries(prev.positions).filter(([k]) => !k.startsWith(IDEA_NODE_PREFIX)),
            ),
          },
    );
    setEditingId(null);
    setOpenPlaceholderId(null);
    toastWithUndo('Cleared all ideas, placeholders and custom links', changeId);
  }, [updateExtras, toastWithUndo]);

  const resetLayout = useCallback(() => {
    const changeId = updateExtras(() => ({ ...EMPTY_EXTRAS }));
    setEditingId(null);
    setOpenPlaceholderId(null);
    toastWithUndo('Map reset', changeId);
    requestAnimationFrame(() => flow.fitView({ padding: 0.2, duration: 200 }));
  }, [updateExtras, toastWithUndo, flow]);

  const restoreLinks = useCallback(() => {
    const n = extrasRef.current.removedAutoEdges.length;
    const changeId = updateExtras((prev) =>
      prev.removedAutoEdges.length === 0 ? prev : { ...prev, removedAutoEdges: [] },
    );
    toastWithUndo(n === 1 ? 'Restored 1 hidden link' : `Restored ${n} hidden links`, changeId);
  }, [updateExtras, toastWithUndo]);

  const tidyUp = useCallback(
    (animate = true) => {
      const sizeFor = (n: Node, kind: BoardNodeKind | 'idea') => {
        const live = nodesRef.current.find((x) => x.id === n.id);
        const fb = NODE_SIZE[kind] ?? NODE_SIZE.idea;
        return { w: live?.measured?.width ?? fb.w, h: live?.measured?.height ?? fb.h };
      };
      const board = baseGraph.nodes.map((n) => ({
        id: n.id,
        kind: n.type as BoardNodeKind,
        x: n.position.x,
        y: n.position.y,
        ...sizeFor(n, n.type as BoardNodeKind),
      }));
      const ideas = nodesRef.current
        .filter((n) => n.type === 'idea')
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeFor(n, 'idea') }));
      const ideaPositions = tidyLayout({
        board,
        ideas,
        links: extrasRef.current.edges.map((e) => ({ source: e.source, target: e.target })),
      });
      const changeId = updateExtras((prev) => ({ ...prev, positions: ideaPositions }));
      if (changeId === null) return;
      toastWithUndo('Map tidied up', changeId);
      requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: animate ? 200 : 0 }));
    },
    [baseGraph.nodes, updateExtras, toastWithUndo, flow],
  );

  // ── Find ─────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const searchItems = useMemo<SearchItem[]>(() => {
    const colTitle = new Map(columns.map((c) => [c.id, c.title]));
    const items: SearchItem[] = [{ id: PROJECT_NODE_ID, label: project.name, kind: 'project' }];
    for (const c of columns) items.push({ id: `${COLUMN_NODE_PREFIX}${c.id}`, label: c.title, kind: 'column' });
    for (const t of tasks) {
      const col = colTitle.get(t.status) ?? 'Unsorted';
      items.push({ id: `${TASK_NODE_PREFIX}${t.taskId}`, label: t.title, kind: 'task', context: col });
      (t.subtasks ?? []).forEach((s, i) =>
        items.push({ id: subtaskNodeId(t.taskId, s.id, i), label: s.title, kind: 'subtask', context: t.title }),
      );
    }
    for (const i of extras.ideas) {
      items.push({
        id: i.id,
        label: i.label,
        kind: 'idea',
        context: i.kind ? `${i.kind[0].toUpperCase()}${i.kind.slice(1)} placeholder` : undefined,
      });
    }
    return items;
  }, [project.name, columns, tasks, extras.ideas]);

  // One guaranteed fit once the first cards are measured (React Flow's own
  // `fitView` prop can fire before the cloud copy of the layout arrives).
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (didInitialFitRef.current || !cloudLoaded) return;
    if (!nodes.some((n) => n.measured?.width)) return;
    didInitialFitRef.current = true;
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 0 }));
  }, [nodes, cloudLoaded, flow]);

  const pendingFocusRef = useRef<{ id: string; duration: number } | null>(null);

  const focusNode = useCallback(
    (id: string, viaKeyboard: boolean) => {
      const col = baseGraph.columnOf.get(id);
      pendingFocusRef.current = { id, duration: viaKeyboard ? 0 : 250 };
      if (col && collapsedSet.has(col)) {
        // Expand first; the re-seed selects the card once it exists.
        pendingSelectRef.current = id;
        toggleCollapse(col);
      } else {
        setNodes((nds) => nds.map((n) => (n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n)));
      }
    },
    [baseGraph.columnOf, collapsedSet, toggleCollapse],
  );

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const n = nodes.find((x) => x.id === pending.id);
    if (!n?.measured?.width) return; // wait until measured
    pendingFocusRef.current = null;
    flow.fitView({ nodes: [{ id: pending.id }], duration: pending.duration, maxZoom: 1.1, padding: 0.8 });
  }, [nodes, flow]);

  // ── Connect mode ─────────────────────────────────────────────
  const [connectMode, setConnectMode] = useState(false);
  const [connectFirstNodeId, setConnectFirstNodeId] = useState<string | null>(null);
  connectModeRef.current = connectMode;
  const exitConnectMode = useCallback(() => {
    setConnectMode(false);
    setConnectFirstNodeId(null);
  }, []);
  const toggleConnect = useCallback(() => {
    if (connectMode) exitConnectMode();
    else setConnectMode(true);
  }, [connectMode, exitConnectMode]);

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (!connectMode) return;
      if (!connectFirstNodeId) {
        setConnectFirstNodeId(node.id);
        return;
      }
      if (connectFirstNodeId === node.id) {
        setConnectFirstNodeId(null);
        return;
      }
      onConnect({ source: connectFirstNodeId, target: node.id, sourceHandle: null, targetHandle: null });
      exitConnectMode();
      toast.success('Connected');
    },
    [connectMode, connectFirstNodeId, onConnect, exitConnectMode],
  );

  // ── Fullscreen ───────────────────────────────────────────────
  // CSS full-viewport mode (+ browser fullscreen on the document when
  // allowed) so Radix portals — menus, dialogs, panels — stay visible.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );
  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      setIsFullscreen(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } else {
      setIsFullscreen(true);
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  }, [isFullscreen]);

  // ── Help / tip / minimap ─────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tipVisible, setTipVisible] = useState(() => !readTipDismissed());
  const dismissTip = useCallback(() => {
    writeTipDismissed();
    setTipVisible(false);
  }, []);
  const [showMiniMap, setShowMiniMap] = useState(readMiniMapPref);
  const toggleMiniMap = useCallback(() => {
    setShowMiniMap((v) => {
      try {
        window.localStorage.setItem(MINIMAP_PREF_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, []);

  // ── Export ───────────────────────────────────────────────────
  const fileBase = `mindmap-${project.name.replace(/\s+/g, '-').toLowerCase()}`;

  const exportAsJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(flow.toObject(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flow, fileBase]);

  const exportAsPng = useCallback(async () => {
    const el = containerRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    try {
      const rawBg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
      let backgroundColor: string;
      if (rawBg.length === 0) {
        backgroundColor = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#171717' : '#ffffff';
      } else if (rawBg.startsWith('#') || rawBg.includes('(')) {
        backgroundColor = rawBg;
      } else {
        backgroundColor = `hsl(${rawBg})`;
      }
      const { toPng } = (await import('html-to-image')) as {
        toPng: (el: HTMLElement, opts: Record<string, unknown>) => Promise<string>;
      };
      const dataUrl = await toPng(el, {
        backgroundColor,
        pixelRatio: 2,
        filter: (node: Element) => {
          const cls = (node as HTMLElement).className;
          return !(
            typeof cls === 'string' &&
            (cls.includes('react-flow__minimap') ||
              cls.includes('react-flow__controls') ||
              cls.includes('react-flow__edgelabel-renderer'))
          );
        },
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${fileBase}.png`;
      a.click();
    } catch {
      // html-to-image not installed — fall back to JSON
      exportAsJson();
    }
  }, [fileBase, exportAsJson]);

  // ── Context menu ─────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
    nodeType?: string;
    edgeId?: string;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openMenuAt = (e: React.MouseEvent | MouseEvent, extra: Partial<NonNullable<typeof contextMenu>> = {}) => {
    e.preventDefault();
    const W = 232;
    const H = 280;
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - W - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - H - 8)),
      ...extra,
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [contextMenu]);

  // ── Keyboard ─────────────────────────────────────────────────
  // Shortcuts only apply while the map is the active surface: focus is
  // inside it, or nothing is focused and the last click landed inside it.
  const pointerInsideRef = useRef(true);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      pointerInsideRef.current = !!containerRef.current?.contains(e.target as globalThis.Node);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const clearSelection = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEdges((eds) => eds.map((e) => (e.selected ? { ...e, selected: false } : e)));
  }, []);

  const anyModalOpen = addDialog.open || confirm !== null || !!openTaskId || !!openPlaceholderId;

  // Latest-value ref so the window listener never goes stale.
  const keyStateRef = useRef({
    addIdea,
    addChild,
    addSibling,
    undo,
    redo,
    removeItems,
    clearSelection,
    exitConnectMode,
    connectMode,
    showShortcuts,
    contextMenu: !!contextMenu,
    isFullscreen,
    anyModalOpen,
  });
  keyStateRef.current = {
    addIdea,
    addChild,
    addSibling,
    undo,
    redo,
    removeItems,
    clearSelection,
    exitConnectMode,
    connectMode,
    showShortcuts,
    contextMenu: !!contextMenu,
    isFullscreen,
    anyModalOpen,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = keyStateRef.current;
      if (s.anyModalOpen || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const inside = !!target && !!containerRef.current?.contains(target);
      const bodyTarget = !target || target === document.body || target === document.documentElement;
      if (!inside && !(bodyTarget && pointerInsideRef.current)) return;

      const typing =
        !!target &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const lower = key.toLowerCase();

      if (mod && lower === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (typing) return;
      // Keys keep their normal meaning on focused controls: any button for
      // Enter, and chrome outside the cards (toolbar, menus) for the rest.
      const onControl = !!target?.closest('button, a, [role="menuitem"], [role="option"], [role="radio"]');
      const onChrome = onControl && !target?.closest('.react-flow__node');

      if (mod && lower === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && lower === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      // Keyboard-driven camera moves are instant (no animation).
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault();
        void flow.zoomIn({ duration: 0 });
        return;
      }
      if (mod && key === '-') {
        e.preventDefault();
        void flow.zoomOut({ duration: 0 });
        return;
      }
      if (mod && key === '0') {
        e.preventDefault();
        void flow.fitView({ padding: 0.2, duration: 0 });
        return;
      }
      if (mod || e.altKey) return;

      const selectedNodes = nodesRef.current.filter((n) => n.selected);
      const single = selectedNodes.length === 1 ? selectedNodes[0] : null;

      switch (key) {
        case 'n':
        case 'N':
          if (onChrome) return;
          e.preventDefault();
          s.addIdea();
          return;
        case 'c':
        case 'C':
          if (onChrome) return;
          e.preventDefault();
          if (s.connectMode) s.exitConnectMode();
          else setConnectMode(true);
          return;
        case '?':
          e.preventDefault();
          setShowShortcuts((v) => !v);
          return;
        case 'Tab':
          if (onChrome || !single || e.shiftKey) return;
          e.preventDefault();
          s.addChild(single.id);
          return;
        case 'Enter':
          if (onControl || !single || single.type !== 'idea') return;
          e.preventDefault();
          s.addSibling(single.id);
          return;
        case 'F2':
          if (!single || single.type !== 'idea') return;
          e.preventDefault();
          setEditingId(single.id);
          return;
        case 'Delete':
        case 'Backspace': {
          if (onChrome) return;
          const nodeIds = selectedNodes.map((n) => n.id);
          const edgeIds = edgesRef.current.filter((x) => x.selected).map((x) => x.id);
          if (nodeIds.length === 0 && edgeIds.length === 0) return;
          e.preventDefault();
          s.removeItems(nodeIds, edgeIds);
          return;
        }
        case 'Escape':
          if (s.contextMenu) setContextMenu(null);
          else if (s.connectMode) s.exitConnectMode();
          else if (s.showShortcuts) setShowShortcuts(false);
          else if (selectedNodes.length > 0 || edgesRef.current.some((x) => x.selected)) s.clearSelection();
          else if (s.isFullscreen && !document.fullscreenElement) setIsFullscreen(false);
          return;
        default:
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flow]);

  // ── Toolbar props ────────────────────────────────────────────
  const history = historyRef.current;
  const toolbarProps: Omit<MindMapToolbarProps, 'zoom'> = {
    modeSwitch,
    onAddIdea: addIdea,
    // Dialogs open a frame after the dropdown closes so Radix focus /
    // pointer-events handling of the two layers can't collide.
    onAddShape: (kind) => requestAnimationFrame(() => openAddDialog(kind)),
    connectMode,
    onToggleConnect: toggleConnect,
    onTidyUp: () => tidyUp(true),
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    onUndo: undo,
    onRedo: redo,
    onZoomIn: () => void flow.zoomIn({ duration: 150 }),
    onZoomOut: () => void flow.zoomOut({ duration: 150 }),
    onZoomReset: () => void flow.zoomTo(1, { duration: 150 }),
    onFitView: () => void flow.fitView({ padding: 0.2, duration: 200 }),
    find: { open: findOpen, onOpenChange: setFindOpen, items: searchItems, onSelect: focusNode },
    onExportPng: () => void exportAsPng(),
    onExportJson: exportAsJson,
    hiddenLinkCount: extras.removedAutoEdges.length,
    onRestoreLinks: restoreLinks,
    canClearPlaceholders: extras.ideas.length > 0 || extras.edges.length > 0,
    onClearPlaceholders: () => requestAnimationFrame(() => setConfirm('clear')),
    onResetLayout: () => requestAnimationFrame(() => setConfirm('reset')),
    showMiniMap,
    onToggleMiniMap: toggleMiniMap,
    onShowShortcuts: () => setShowShortcuts(true),
    isFullscreen,
    onToggleFullscreen: toggleFullscreen,
  };

  const isEmpty = tasks.length === 0 && extras.ideas.length === 0;
  const menuItem =
    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground';
  const ctxNode = contextMenu?.nodeId;
  const ctxIsIdea = !!ctxNode?.startsWith(IDEA_NODE_PREFIX);

  return (
    <div
      ref={containerRef}
      className={cn(
        'mm-canvas relative h-full w-full overflow-hidden bg-background',
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'rounded-xl border border-border',
      )}
      onClick={contextMenu ? closeContextMenu : undefined}
    >
      <style>{CANVAS_CSS}</style>

      <ConnectedToolbar {...toolbarProps} />

      {isEmpty && (
        <MindMapEmptyState onAddIdea={addIdea} onOpenAI={() => onOpenAIMode?.()} />
      )}

      {/* Bottom-left: help button + shortcuts / first-time tip */}
      <HelpButton
        open={showShortcuts}
        onToggle={() => {
          setShowShortcuts((v) => !v);
          if (tipVisible) dismissTip();
        }}
      />
      {showShortcuts ? (
        <ShortcutsPanel onClose={() => setShowShortcuts(false)} />
      ) : (
        tipVisible && !isEmpty && <FirstTimeTip onDismiss={dismissTip} />
      )}

      {connectMode && (
        <div
          role="status"
          className="absolute bottom-4 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3.5 py-2 text-[13px] font-medium text-popover-foreground shadow-lg"
        >
          <Link2 className="h-4 w-4 text-primary" aria-hidden />
          {connectFirstNodeId ? 'Now click the card to connect to' : 'Click the first card'}
          <span className="text-muted-foreground">· Esc to cancel</span>
        </div>
      )}

      {/* Right-click menu */}
      {contextMenu && (
        <div
          role="menu"
          aria-label="Map actions"
          className="fixed z-50 w-[232px] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!ctxNode && !contextMenu.edgeId && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                addIdeaAt(flow.screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }));
                closeContextMenu();
              }}
            >
              <Plus /> Add idea here
            </button>
          )}
          {ctxNode && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                addChild(ctxNode);
                closeContextMenu();
              }}
            >
              <Plus /> Add connected idea
              <span className="ml-auto text-[11px] text-muted-foreground">Tab</span>
            </button>
          )}
          {contextMenu.nodeType === 'task' && ctxNode && (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                setOpenTaskId(ctxNode.slice(TASK_NODE_PREFIX.length));
                closeContextMenu();
              }}
            >
              <ExternalLink /> Open task
            </button>
          )}
          {ctxIsIdea && ctxNode && (
            <>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setEditingId(ctxNode);
                  closeContextMenu();
                }}
              >
                <Pencil /> Rename
                <span className="ml-auto text-[11px] text-muted-foreground">F2</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(menuItem, 'text-destructive [&_svg]:text-destructive')}
                onClick={() => {
                  removeItems([ctxNode], []);
                  closeContextMenu();
                }}
              >
                <Trash2 /> Delete
                <span className="ml-auto text-[11px] text-muted-foreground">Del</span>
              </button>
            </>
          )}
          {contextMenu.edgeId && (
            <button
              type="button"
              role="menuitem"
              className={cn(menuItem, 'text-destructive [&_svg]:text-destructive')}
              onClick={() => {
                removeItems([], [contextMenu.edgeId!]);
                closeContextMenu();
              }}
            >
              <Trash2 /> {contextMenu.edgeId.startsWith(AUTO_EDGE_PREFIX) ? 'Hide link' : 'Delete link'}
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={menuItem} onClick={() => { tidyUp(true); closeContextMenu(); }}>
            <LayoutGrid /> Tidy up
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              void flow.fitView({ padding: 0.2, duration: 200 });
              closeContextMenu();
            }}
          >
            <Scan /> Fit to screen
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { void exportAsPng(); closeContextMenu(); }}>
            <Image /> Export PNG
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { exportAsJson(); closeContextMenu(); }}>
            <FileJson /> Export JSON
          </button>
        </div>
      )}

      <ReactFlow
        nodes={
          connectMode && connectFirstNodeId
            ? nodes.map((n) => (n.id === connectFirstNodeId ? { ...n, selected: true } : n))
            : nodes
        }
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={(_e, node) => {
          if (node.type === 'idea') setEditingId(node.id);
        }}
        onPaneClick={() => {
          if (editingId) setEditingId(null);
        }}
        onNodeContextMenu={(e, node) => openMenuAt(e, { nodeId: node.id, nodeType: node.type })}
        onEdgeContextMenu={(e, edge) => openMenuAt(e, { edgeId: edge.id })}
        onPaneContextMenu={(e) => openMenuAt(e)}
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        connectionRadius={28}
        connectOnClick={false}
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: 'deletable' }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="hsl(var(--muted-foreground) / 0.3)"
        />
        {showMiniMap && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Mini map"
            className="!rounded-xl !border !border-border !bg-card !shadow-sm"
            maskColor="hsl(var(--background) / 0.65)"
            nodeBorderRadius={6}
            nodeColor={(n) => {
              if (n.type === 'project') return 'hsl(var(--primary))';
              if (n.type === 'column') {
                return (n.data as { color?: string } | undefined)?.color || 'hsl(var(--muted-foreground))';
              }
              if (n.type === 'idea') return paletteFor((n.data as { color?: string } | undefined)?.color).solid;
              if (n.type === 'subtask') return 'hsl(var(--muted-foreground) / 0.3)';
              return 'hsl(var(--muted-foreground) / 0.55)';
            }}
          />
        )}
      </ReactFlow>

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

      {/* Name a Task / Column / Project placeholder (mind map only). */}
      <Dialog open={addDialog.open} onOpenChange={(o) => !o && setAddDialog((s) => ({ ...s, open: false }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {addDialog.type === 'task' ? (
                <>
                  <CheckSquare className="h-4 w-4 text-muted-foreground" /> Add task card
                </>
              ) : addDialog.type === 'column' ? (
                <>
                  <Columns className="h-4 w-4 text-muted-foreground" /> Add column
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 text-muted-foreground" /> Add project header
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              A placeholder on the mind map only — nothing is added to the board.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label
              htmlFor="mm-add-title"
              className="mb-1.5 block text-[12px] font-medium text-muted-foreground"
            >
              {addDialog.type === 'project' ? 'Header label' : 'Title'}
            </label>
            <Input
              id="mm-add-title"
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
                  submitAddDialog();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddDialog((s) => ({ ...s, open: false }))}>
              Cancel
            </Button>
            <Button onClick={submitAddDialog} disabled={!addTitle.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              Add to map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmations for bulk actions — both are undoable afterwards. */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'reset' ? 'Reset the map layout?' : 'Clear all placeholders?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reset'
                ? 'Every card goes back to its automatic position, and your ideas, custom links and hidden-link settings are removed. The board itself is not changed. You can undo this.'
                : `Removes ${extras.ideas.length === 1 ? '1 idea / placeholder' : `${extras.ideas.length} ideas and placeholders`}${
                    extras.edges.length > 0
                      ? ` and ${extras.edges.length === 1 ? '1 custom link' : `${extras.edges.length} custom links`}`
                      : ''
                  }. Board tasks and columns stay. You can undo this.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirm === 'reset') resetLayout();
                else clearPlaceholders();
                setConfirm(null);
              }}
            >
              {confirm === 'reset' ? 'Reset layout' : 'Clear placeholders'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────

const ProjectStructuralMap: React.FC<StructuralMapProps> = (props) => (
  // Always mount the canvas so the toolbar is reachable even when the board
  // has no tasks yet; the empty-state card sits on top of it.
  <ReactFlowProvider>
    <MindMapInner {...props} />
  </ReactFlowProvider>
);

export const ProjectMindMap: React.FC<ProjectMindMapProps> = (props) => {
  const [mode, setMode] = useState<MindMapMode>('project');
  // Hand-off slot for content sent from the AI map. Stored at the wrapper so
  // it survives the ProjectStructuralMap remount when modes flip.
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

  const clearPendingImport = useCallback(() => setPendingImport(null), []);
  const modeSwitch = <MindMapModeSwitch mode={mode} onChange={setMode} />;

  return (
    <div className="h-full">
      {mode === 'project' ? (
        <ProjectStructuralMap
          {...props}
          pendingImport={pendingImport}
          onPendingImportApplied={clearPendingImport}
          modeSwitch={modeSwitch}
          onOpenAIMode={() => setMode('ai')}
        />
      ) : (
        <AIMindMap onSendToProjectMap={handleSendToProjectMap} headerSlot={modeSwitch} />
      )}
    </div>
  );
};

export default ProjectMindMap;
