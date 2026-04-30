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
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from '@xyflow/react';
import { DeletableEdge, type DeletableEdgeData } from './DeletableEdge';
import '@xyflow/react/dist/style.css';
import {
  Loader2,
  Sparkles,
  Wand2,
  Eraser,
  Lightbulb,
  Plus,
  Trash2,
  Send,
  Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  generateMindMapFromText,
  isAIEnabled,
  type MindMapNode,
  type AIError,
} from '@/services/ai';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────
// Layout — horizontal tidy tree (root on the left, branches grow right).
// We use a per-depth column gap and pack children vertically by their
// own subtree height so siblings don't overlap.
// ─────────────────────────────────────────────────────────────

const COL_GAP = 240;
const ROW_GAP = 56;
const ROOT_X = 0;
const ROOT_Y = 0;

interface PositionedNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  parentId: string | null;
}

function layoutTree(root: MindMapNode): PositionedNode[] {
  const nodes: PositionedNode[] = [];
  // First pass — compute the leaf-row span of each subtree so siblings stack
  // without overlapping their grandchildren.
  const span = new Map<string, number>();
  const computeSpan = (n: MindMapNode): number => {
    if (!n.children || n.children.length === 0) {
      span.set(n.id, 1);
      return 1;
    }
    let total = 0;
    for (const c of n.children) total += computeSpan(c);
    span.set(n.id, total);
    return total;
  };
  computeSpan(root);

  const place = (
    n: MindMapNode,
    depth: number,
    parentId: string | null,
    top: number,
  ) => {
    const rs = span.get(n.id) ?? 1;
    const centerRow = top + rs / 2 - 0.5;
    nodes.push({
      id: n.id,
      label: n.label,
      depth,
      x: ROOT_X + depth * COL_GAP,
      y: ROOT_Y + centerRow * ROW_GAP,
      parentId,
    });
    let cursor = top;
    for (const c of n.children || []) {
      place(c, depth + 1, n.id, cursor);
      cursor += span.get(c.id) ?? 1;
    }
  };
  place(root, 0, null, 0);
  return nodes;
}

// ─────────────────────────────────────────────────────────────
// Per-branch palette — colors radiate from the root.
// ─────────────────────────────────────────────────────────────

const BRANCH_PALETTE = [
  { name: 'orange', stroke: 'rgb(249,115,22)', text: 'text-orange-600 dark:text-orange-300', soft: 'bg-orange-500/10 border-orange-500/30' },
  { name: 'amber',  stroke: 'rgb(245,158,11)', text: 'text-amber-600 dark:text-amber-300',  soft: 'bg-amber-500/10 border-amber-500/30' },
  { name: 'rose',   stroke: 'rgb(244,63,94)',  text: 'text-rose-600 dark:text-rose-300',    soft: 'bg-rose-500/10 border-rose-500/30' },
  { name: 'violet', stroke: 'rgb(139,92,246)', text: 'text-violet-600 dark:text-violet-300', soft: 'bg-violet-500/10 border-violet-500/30' },
  { name: 'sky',    stroke: 'rgb(14,165,233)', text: 'text-sky-600 dark:text-sky-300',      soft: 'bg-sky-500/10 border-sky-500/30' },
  { name: 'emerald', stroke: 'rgb(16,185,129)', text: 'text-emerald-600 dark:text-emerald-300', soft: 'bg-emerald-500/10 border-emerald-500/30' },
  { name: 'teal',   stroke: 'rgb(20,184,166)', text: 'text-teal-600 dark:text-teal-300',    soft: 'bg-teal-500/10 border-teal-500/30' },
  { name: 'fuchsia', stroke: 'rgb(217,70,239)', text: 'text-fuchsia-600 dark:text-fuchsia-300', soft: 'bg-fuchsia-500/10 border-fuchsia-500/30' },
];

function buildBranchColorMap(tree: MindMapNode): Map<string, number> {
  const m = new Map<string, number>();
  m.set(tree.id, -1);
  const assign = (n: MindMapNode, idx: number) => {
    m.set(n.id, idx);
    for (const c of n.children || []) assign(c, idx);
  };
  tree.children?.forEach((c, i) => assign(c, i));
  return m;
}

// ─────────────────────────────────────────────────────────────
// Editable node — used for every node in the AI map (root + branches).
// Double-click to edit the label, drag to move, four-handle support so
// the user can re-wire the diagram any way they want.
// ─────────────────────────────────────────────────────────────

interface AINodeData extends Record<string, unknown> {
  label: string;
  /** -1 = root, 0..n = branch index. Drives the colour. */
  branchIndex: number;
  /** 0 = root, 1 = main branch, 2+ = sub-points. Drives visual weight. */
  depth: number;
  onChange: (label: string) => void;
  onDelete: () => void;
}

const ConnectionHandles: React.FC = memo(() => {
  // All four sides expose source AND target so users can drag from any side
  // to any other. We keep handles subtly visible at rest (30%) so the user
  // sees where to grab without having to discover them by hovering, then
  // brighten + grow them on hover so the affordance is obvious during a
  // drag attempt — important on touch where there's no hover-then-aim.
  const base =
    '!w-2.5 !h-2.5 !bg-primary !border !border-card opacity-30 group-hover:opacity-100 group-hover:!w-3 group-hover:!h-3 transition-all duration-150 nodrag';
  const tgt = cn(base, '!bg-muted-foreground/70');
  return (
    <>
      <Handle id="t-src" type="source" position={Position.Top} className={base} />
      <Handle id="t-tgt" type="target" position={Position.Top} className={tgt} />
      <Handle id="r-src" type="source" position={Position.Right} className={base} />
      <Handle id="r-tgt" type="target" position={Position.Right} className={tgt} />
      <Handle id="b-src" type="source" position={Position.Bottom} className={base} />
      <Handle id="b-tgt" type="target" position={Position.Bottom} className={tgt} />
      <Handle id="l-src" type="source" position={Position.Left} className={base} />
      <Handle id="l-tgt" type="target" position={Position.Left} className={tgt} />
    </>
  );
});
ConnectionHandles.displayName = 'AIConnectionHandles';

const AINode: React.FC<{ data: AINodeData; selected?: boolean }> = memo(
  ({ data, selected }) => {
    const palette =
      data.branchIndex >= 0
        ? BRANCH_PALETTE[data.branchIndex % BRANCH_PALETTE.length]
        : BRANCH_PALETTE[0];
    const isRoot = data.depth === 0;
    const isMainBranch = data.depth === 1;

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(data.label);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

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

    const wrapperClass = isRoot
      ? 'rounded-2xl border-2 border-primary/40 bg-card px-4 py-3 shadow-md min-w-[220px] max-w-[320px]'
      : isMainBranch
        ? cn(
            'rounded-full border font-semibold text-sm shadow-sm min-w-[160px] max-w-[260px] px-3 py-1.5',
            palette.soft,
            palette.text,
          )
        : 'rounded-md border border-border bg-card text-sm font-medium text-foreground/90 max-w-[260px] px-3 py-1.5';

    return (
      <div
        className={cn(
          'group relative transition-all',
          wrapperClass,
          selected && 'ring-2 ring-primary/40 shadow-md',
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <ConnectionHandles />

        {isRoot && !editing && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <Sparkles className="w-3 h-3 text-primary" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
              Topic
            </p>
          </div>
        )}

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
            rows={isRoot ? 2 : 1}
            className={cn(
              'nodrag w-full bg-background/60 border border-border/60 rounded-md px-2 py-1 outline-none focus:ring-2 focus:ring-primary/30 resize-none min-w-0',
              isRoot ? 'text-base font-semibold' : 'text-sm font-medium',
            )}
          />
        ) : (
          <p
            className={cn(
              'leading-snug whitespace-pre-wrap break-words',
              isRoot ? 'text-base font-semibold text-foreground' : '',
            )}
          >
            {data.label || 'Untitled'}
          </p>
        )}

        {/* Hover toolbar — edit / delete. The root cannot be deleted (the tree
            needs a centre); all other nodes can be removed at any time. */}
        <div
          className={cn(
            'nodrag absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border border-border bg-card shadow-md px-0.5 py-0.5 transition-opacity',
            selected
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            title="Edit label"
            aria-label="Edit label"
            className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            Edit
          </button>
          {!isRoot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onDelete();
              }}
              title="Delete node"
              aria-label="Delete node"
              className="px-1 py-0.5 text-destructive hover:bg-destructive/10 rounded"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  },
);
AINode.displayName = 'AINode';

const NODE_TYPES: NodeTypes = {
  ai: AINode as unknown as NodeTypes[string],
};

const EDGE_TYPES: EdgeTypes = {
  deletable: DeletableEdge as unknown as EdgeTypes[string],
};

// ─────────────────────────────────────────────────────────────
// Tree → React Flow nodes/edges (initial layout from a generation).
// All resulting nodes are the editable `ai` type, and edges are styled
// with the branch colour but otherwise behave like ordinary edges (the
// user can delete and reconnect them freely).
// ─────────────────────────────────────────────────────────────

function buildFlowGraph(
  tree: MindMapNode,
  cb: {
    onChange: (id: string, label: string) => void;
    onDelete: (id: string) => void;
    onEdgeDelete: (edgeId: string) => void;
  },
): { nodes: Node[]; edges: Edge[] } {
  const positioned = layoutTree(tree);
  const colorMap = buildBranchColorMap(tree);

  const nodes: Node[] = positioned.map((p) => {
    const bi = colorMap.get(p.id) ?? 0;
    return {
      id: p.id,
      type: 'ai',
      position: { x: p.x, y: p.y },
      data: {
        label: p.label,
        branchIndex: bi,
        depth: p.depth,
        onChange: (label: string) => cb.onChange(p.id, label),
        onDelete: () => cb.onDelete(p.id),
      } satisfies AINodeData,
    };
  });

  const edges: Edge[] = [];
  for (const p of positioned) {
    if (!p.parentId) continue;
    const bi = colorMap.get(p.id) ?? 0;
    const palette = bi >= 0 ? BRANCH_PALETTE[bi % BRANCH_PALETTE.length] : BRANCH_PALETTE[0];
    edges.push({
      id: `ai-edge-${p.parentId}-${p.id}`,
      source: p.parentId,
      sourceHandle: 'r-src',
      target: p.id,
      targetHandle: 'l-tgt',
      type: 'deletable',
      style: {
        stroke: palette.stroke,
        strokeWidth: p.depth === 1 ? 2.25 : 1.5,
        strokeOpacity: p.depth >= 3 ? 0.65 : 0.9,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: palette.stroke,
        width: 14,
        height: 14,
      },
      data: { onDelete: cb.onEdgeDelete } satisfies DeletableEdgeData,
    });
  }
  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────
// Cross-map "send" payload — the shape ProjectMindMap consumes when
// the user clicks "Send to Project map". Decoupled from React Flow
// types so the wrapper doesn't need a Flow dependency.
// ─────────────────────────────────────────────────────────────

export interface AIMapImportPayload {
  nodes: Array<{
    /** Stable id — the receiver remaps it to a fresh id to avoid collisions. */
    id: string;
    label: string;
    /** -1 = root, 0..n = branch index (drives palette colour). */
    branchIndex: number;
    x: number;
    y: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    /** Branch index that owns this edge — used to colour-match the connector. */
    branchIndex: number;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const SAMPLES = [
  'Marketing campaign launch plan with research, creative, channels, and post-launch analysis',
  'Onboarding flow for a new SaaS user from sign-up to first value moment',
  'Q3 product roadmap covering platform, growth, and infra workstreams',
];

interface AIMindMapInnerProps {
  /** When provided, shows a "Send to Project map" button that ships the
   *  current canvas (nodes + edges + positions) to the project map's
   *  ideas/user-edges layer. The receiver remaps ids and offsets positions
   *  so the imported subgraph lands cleanly next to existing content. */
  onSendToProjectMap?: (payload: AIMapImportPayload) => void;
}

const AIMindMapInner: React.FC<AIMindMapInnerProps> = ({ onSendToProjectMap }) => {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const aiAvailable = isAIEnabled();

  // Controlled React Flow state. Once we generate the first map the user can
  // drag, edit labels, delete nodes, delete edges, and draw new connections —
  // exactly like the project map. Re-generating starts fresh; clearing wipes
  // the canvas. The state lives entirely in this component (not persisted)
  // because AI mind maps are intended as scratch boards.
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Bumped each time a generation completes so React Flow re-fits the view.
  const [generationCount, setGenerationCount] = useState(0);

  const updateNodeLabel = useCallback((id: string, label: string) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          ? { ...n, data: { ...(n.data as AINodeData), label } }
          : n,
      ),
    );
  }, []);

  const deleteNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  // Re-bind the latest callbacks to every node's data on each render so the
  // closures inside AINode always call the up-to-date setters. Without this,
  // a node generated earlier would be calling a stale `setNodes`/`setEdges`.
  const liveNodes = useMemo<Node[]>(
    () =>
      nodes.map((n) => {
        if (n.type !== 'ai') return n;
        const data = n.data as AINodeData;
        return {
          ...n,
          data: {
            ...data,
            onChange: (label: string) => updateNodeLabel(n.id, label),
            onDelete: () => deleteNode(n.id),
          } satisfies AINodeData,
        };
      }),
    [nodes, updateNodeLabel, deleteNode],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  /** Removes an edge by id. Used by the X button on each edge — same primitive
   *  the keyboard delete path uses, so click and key produce identical state. */
  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, []);

  // Re-bind onDelete on every edge each render so an edge created with a
  // stale closure (e.g. before deleteEdge existed) still calls the latest
  // setter. The pattern mirrors `liveNodes` above.
  const liveEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        ...e,
        type: 'deletable',
        data: {
          ...(e.data as Record<string, unknown> | undefined),
          onDelete: deleteEdge,
        } satisfies DeletableEdgeData,
      })),
    [edges, deleteEdge],
  );

  // ── Click-to-connect tool ────────────────────────────────────
  // Same simplification the project map offers: click one node, click another,
  // we wire them. No precision drag required — accessible on touch devices
  // and friendlier for non-technical users.
  const [connectMode, setConnectMode] = useState(false);
  const [connectFirstId, setConnectFirstId] = useState<string | null>(null);
  const exitConnectMode = useCallback(() => {
    setConnectMode(false);
    setConnectFirstId(null);
  }, []);
  useEffect(() => {
    if (!connectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitConnectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectMode, exitConnectMode]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const newEdge: Edge = {
        id: `ai-edge-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        data: { onDelete: deleteEdge } satisfies DeletableEdgeData,
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [deleteEdge],
  );

  const handleGenerate = useCallback(async () => {
    if (!user?.userId) {
      const msg = 'Sign in to generate AI mind maps.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!text.trim()) {
      setError('Type or paste something to map.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await generateMindMapFromText(user.userId, text);
      const { nodes: nextNodes, edges: nextEdges } = buildFlowGraph(result, {
        onChange: updateNodeLabel,
        onDelete: deleteNode,
        onEdgeDelete: deleteEdge,
      });
      setNodes(nextNodes);
      setEdges(nextEdges);
      setHasGenerated(true);
      setGenerationCount((c) => c + 1);
    } catch (err) {
      const msg =
        (err as AIError)?.message ||
        (err instanceof Error ? err.message : 'Failed to generate mind map');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [user?.userId, text, updateNodeLabel, deleteNode, deleteEdge]);

  const handleClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setError(null);
    setHasGenerated(false);
  }, []);

  // Serialise the current canvas into a payload the project map can ingest.
  // We only forward ai-typed nodes (drop accidental other types) and edges
  // whose endpoints both still exist (so a half-deleted edge can't poison
  // the import). Branch index is taken straight from each node's data.
  const handleSendToProjectMap = useCallback(() => {
    if (!onSendToProjectMap) return;
    if (nodes.length === 0) {
      toast.message('Generate or add nodes first.');
      return;
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    const payloadNodes: AIMapImportPayload['nodes'] = nodes
      .filter((n) => n.type === 'ai')
      .map((n) => {
        const data = n.data as AINodeData;
        return {
          id: n.id,
          label: data.label,
          branchIndex: data.branchIndex,
          x: n.position.x,
          y: n.position.y,
        };
      });
    const payloadEdges: AIMapImportPayload['edges'] = edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => {
        const targetNode = nodes.find((n) => n.id === e.target);
        const bi =
          targetNode && targetNode.type === 'ai'
            ? (targetNode.data as AINodeData).branchIndex
            : 0;
        return {
          source: e.source,
          target: e.target,
          branchIndex: bi >= 0 ? bi : 0,
        };
      });

    onSendToProjectMap({ nodes: payloadNodes, edges: payloadEdges });
    toast.success(
      payloadNodes.length === 1
        ? '1 node sent to Project map'
        : `${payloadNodes.length} nodes sent to Project map`,
    );
  }, [nodes, edges, onSendToProjectMap]);

  // Add a free-floating idea node near the centre of the viewport so users
  // can grow the map manually after generation (or even with no generation).
  const handleAddIdea = useCallback(() => {
    const id = `ai-node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const containerEl = document.querySelector('.ai-mindmap-flow') as HTMLElement | null;
    const rect = containerEl?.getBoundingClientRect();
    const x = rect ? rect.width / 2 - 80 : 200;
    const y = rect ? rect.height / 2 - 24 : 200;
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: 'ai',
        position: { x, y },
        data: {
          label: 'New idea',
          branchIndex: ns.length % BRANCH_PALETTE.length,
          depth: 1,
          onChange: (label: string) => updateNodeLabel(id, label),
          onDelete: () => deleteNode(id),
        } satisfies AINodeData,
      },
    ]);
  }, [updateNodeLabel, deleteNode]);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Prompt strip */}
      <div className="rounded-lg border border-border bg-card/80 p-3 backdrop-blur">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">AI mind map</p>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Generate a starting tree, then drag, edit, delete and reconnect anywhere
            </span>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Plan a marketing launch for our new pricing page — list the phases, owners, and dependencies."
            rows={3}
            className="text-sm"
            disabled={loading}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleGenerate();
              }
            }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleGenerate()}
              disabled={loading || !text.trim() || !aiAvailable}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {loading ? 'Generating…' : hasGenerated ? 'Regenerate' : 'Generate'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleAddIdea}
              className="gap-1.5"
              title="Add a blank node — drag a connector to attach it"
            >
              <Plus className="w-3.5 h-3.5" />
              Add node
            </Button>
            <Button
              type="button"
              size="sm"
              variant={connectMode ? 'default' : 'outline'}
              onClick={() =>
                connectMode ? exitConnectMode() : setConnectMode(true)
              }
              className="gap-1.5"
              aria-pressed={connectMode}
              title="Click two nodes to connect them — no drag required"
            >
              <Link2 className="w-3.5 h-3.5" />
              {connectMode ? 'Cancel' : 'Connect'}
            </Button>
            {hasGenerated && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleClear}
                className="gap-1.5 text-muted-foreground"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
            {onSendToProjectMap && nodes.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleSendToProjectMap}
                className="gap-1.5"
                title="Copy this mind map into the Project map as ideas + connections"
              >
                <Send className="w-3.5 h-3.5" />
                Send to Project map
              </Button>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground hidden sm:inline">
              ⌘/Ctrl + ↵ to generate · Double-click a node to rename · Del to remove
            </span>
          </div>
          {!aiAvailable && (
            <p className="text-xs text-muted-foreground">
              AI is not configured for this workspace — ask an admin to enable the AI service.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!hasGenerated && !loading && !error && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] text-muted-foreground mr-1">Try:</span>
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setText(s)}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-background hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  {s.length > 56 ? `${s.slice(0, 56)}…` : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 min-h-0 relative rounded-lg border border-border bg-background overflow-hidden">
        {connectMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shadow-lg">
            <Link2 className="w-3.5 h-3.5" />
            {connectFirstId ? 'Now click the second node' : 'Click the first node to connect'}
            <span className="text-primary-foreground/60 ml-1">· Esc to cancel</span>
          </div>
        )}
        {nodes.length > 0 ? (
          <ReactFlow
            key={generationCount}
            nodes={
              connectMode && connectFirstId
                ? liveNodes.map((n) =>
                    n.id === connectFirstId ? { ...n, selected: true } : n,
                  )
                : liveNodes
            }
            edges={liveEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, node) => {
              if (!connectMode) return;
              if (!connectFirstId) {
                setConnectFirstId(node.id);
                return;
              }
              if (connectFirstId === node.id) {
                setConnectFirstId(null);
                return;
              }
              onConnect({
                source: connectFirstId,
                target: node.id,
                sourceHandle: null,
                targetHandle: null,
              });
              exitConnectMode();
              toast.success('Connected');
            }}
            deleteKeyCode={['Delete', 'Backspace']}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            connectionRadius={28}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            className="ai-mindmap-flow"
          >
            <Background gap={20} size={1} className="opacity-50" />
            <MiniMap
              pannable
              zoomable
              className="!bg-card !border !border-border"
              nodeColor={(n) => {
                const data = n.data as AINodeData | undefined;
                const bi = data?.branchIndex ?? 0;
                if (bi < 0) return 'rgb(99,102,241)';
                return BRANCH_PALETTE[bi % BRANCH_PALETTE.length].stroke;
              }}
            />
            <Controls className="!bg-card !border !border-border" />
          </ReactFlow>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
            <Lightbulb className="w-10 h-10 mb-3 text-amber-500/70" />
            <p className="text-sm font-medium text-foreground mb-1">
              Your AI-generated mind map will appear here
            </p>
            <p className="text-xs max-w-md">
              Describe what you're thinking about above — a project plan, a strategy, an
              architecture — and we'll turn it into a starting tree of branches and sub-points.
              Once it's there, drag, edit, delete, and reconnect anywhere.
            </p>
          </div>
        )}
        {loading && nodes.length > 0 && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-foreground rounded-md border border-border bg-card px-3 py-2 shadow">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Regenerating…
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface AIMindMapProps {
  onSendToProjectMap?: (payload: AIMapImportPayload) => void;
}

export const AIMindMap: React.FC<AIMindMapProps> = ({ onSendToProjectMap }) => (
  <ReactFlowProvider>
    <AIMindMapInner onSendToProjectMap={onSendToProjectMap} />
  </ReactFlowProvider>
);

export default AIMindMap;
