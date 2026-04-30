import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, Sparkles, Wand2, Eraser, Lightbulb } from 'lucide-react';
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
  /** Height in row-units (1 = leaf, larger for nodes with descendants). */
  rowSpan: number;
}

function layoutTree(root: MindMapNode): PositionedNode[] {
  const nodes: PositionedNode[] = [];

  // First pass — compute the leaf-row span of each subtree.
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

  // Second pass — recursively place children.
  // `top` is the top row index allocated to this subtree.
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
      rowSpan: rs,
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
// Per-branch palette — colors radiate from the root, mirroring
// the screenshot the user referenced.
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

// Walk the tree to assign each node a branch index (the top-level child
// it descends from). The root itself gets index -1 and a neutral colour.
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
// Node renderers
// ─────────────────────────────────────────────────────────────

interface AIRootNodeData extends Record<string, unknown> {
  label: string;
}

const AIRootNode: React.FC<{ data: AIRootNodeData }> = memo(({ data }) => (
  <div className="rounded-2xl border-2 border-primary/40 bg-card px-4 py-3 shadow-md min-w-[220px] max-w-[320px]">
    <Handle id="r-src" type="source" position={Position.Right} className="!bg-primary !w-2 !h-2 !border-card" />
    <Handle id="l-tgt" type="target" position={Position.Left} className="!bg-primary !w-2 !h-2 !border-card opacity-0" />
    <div className="flex items-center gap-2">
      <Sparkles className="w-3.5 h-3.5 text-primary" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Topic</p>
    </div>
    <p className="mt-0.5 text-base font-semibold text-foreground leading-snug">
      {data.label}
    </p>
  </div>
));
AIRootNode.displayName = 'AIRootNode';

interface AIBranchNodeData extends Record<string, unknown> {
  label: string;
  branchIndex: number;
  /** depth >= 1; visual weight tapers with depth. */
  depth: number;
  isLeaf: boolean;
}

const AIBranchNode: React.FC<{ data: AIBranchNodeData }> = memo(({ data }) => {
  const palette =
    data.branchIndex >= 0
      ? BRANCH_PALETTE[data.branchIndex % BRANCH_PALETTE.length]
      : BRANCH_PALETTE[0];
  // Depth 1 = main branch (pill, coloured). Depth 2+ = sub-points (lighter,
  // smaller). Leaves at the deepest level are rendered as plain text bullets
  // so the diagram doesn't drown in boxes — same look as the reference image.
  const isMainBranch = data.depth === 1;
  const isPureLeaf = data.isLeaf && data.depth >= 2;

  return (
    <div
      className={cn(
        'relative px-3 py-1.5 transition-colors',
        isMainBranch
          ? cn(
              'rounded-full border font-semibold text-sm shadow-sm min-w-[160px] max-w-[260px]',
              palette.soft,
              palette.text,
            )
          : isPureLeaf
            ? 'text-sm text-foreground/90'
            : cn(
                'rounded-md border bg-card text-sm font-medium text-foreground/90 max-w-[260px]',
                'border-border',
              ),
      )}
    >
      <Handle id="l-tgt" type="target" position={Position.Left} className="!w-1.5 !h-1.5 !border-0 opacity-0" />
      <Handle id="r-src" type="source" position={Position.Right} className="!w-1.5 !h-1.5 !border-0 opacity-0" />
      <span className="block leading-snug">{data.label}</span>
    </div>
  );
});
AIBranchNode.displayName = 'AIBranchNode';

const NODE_TYPES: NodeTypes = {
  aiRoot: AIRootNode as unknown as NodeTypes[string],
  aiBranch: AIBranchNode as unknown as NodeTypes[string],
};

// ─────────────────────────────────────────────────────────────
// Build React Flow nodes/edges from the parsed tree.
// ─────────────────────────────────────────────────────────────

function buildFlowGraph(tree: MindMapNode): { nodes: Node[]; edges: Edge[] } {
  const positioned = layoutTree(tree);
  const colorMap = buildBranchColorMap(tree);

  // Quick child lookup so we know which positioned items are leaves.
  const childCount = new Map<string, number>();
  const walk = (n: MindMapNode) => {
    childCount.set(n.id, n.children?.length ?? 0);
    n.children?.forEach(walk);
  };
  walk(tree);

  const nodes: Node[] = positioned.map((p) => {
    if (p.depth === 0) {
      return {
        id: p.id,
        type: 'aiRoot',
        position: { x: p.x, y: p.y },
        data: { label: p.label } satisfies AIRootNodeData,
      };
    }
    const bi = colorMap.get(p.id) ?? 0;
    return {
      id: p.id,
      type: 'aiBranch',
      position: { x: p.x, y: p.y },
      data: {
        label: p.label,
        branchIndex: bi,
        depth: p.depth,
        isLeaf: (childCount.get(p.id) ?? 0) === 0,
      } satisfies AIBranchNodeData,
    };
  });

  const edges: Edge[] = [];
  for (const p of positioned) {
    if (!p.parentId) continue;
    const bi = colorMap.get(p.id) ?? 0;
    const palette = bi >= 0 ? BRANCH_PALETTE[bi % BRANCH_PALETTE.length] : BRANCH_PALETTE[0];
    edges.push({
      id: `e-${p.parentId}-${p.id}`,
      source: p.parentId,
      sourceHandle: 'r-src',
      target: p.id,
      targetHandle: 'l-tgt',
      type: 'smoothstep',
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
    });
  }
  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const SAMPLES = [
  'Marketing campaign launch plan with research, creative, channels, and post-launch analysis',
  'Onboarding flow for a new SaaS user from sign-up to first value moment',
  'Q3 product roadmap covering platform, growth, and infra workstreams',
];

const AIMindMapInner: React.FC = () => {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [tree, setTree] = useState<MindMapNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiAvailable = isAIEnabled();

  const flowGraph = useMemo(() => (tree ? buildFlowGraph(tree) : null), [tree]);

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
      setTree(result);
    } catch (err) {
      const msg =
        (err as AIError)?.message ||
        (err instanceof Error ? err.message : 'Failed to generate mind map');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [user?.userId, text]);

  const handleClear = useCallback(() => {
    setTree(null);
    setError(null);
  }, []);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Prompt strip */}
      <div className="rounded-lg border border-border bg-card/80 p-3 backdrop-blur">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">AI mind map</p>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Describe a topic and let AI structure it for you
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
              {loading ? 'Generating…' : 'Generate'}
            </Button>
            {tree && (
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
            <span className="ml-auto text-[10px] text-muted-foreground hidden sm:inline">
              ⌘/Ctrl + ↵ to generate
            </span>
          </div>
          {!aiAvailable && (
            <p className="text-xs text-muted-foreground">
              AI is not configured for this workspace — ask an admin to enable the AI service.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!tree && !loading && !error && (
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
        {flowGraph ? (
          <ReactFlow
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} className="opacity-50" />
            <MiniMap
              pannable
              zoomable
              className="!bg-card !border !border-border"
              nodeColor={(n) => {
                const data = n.data as AIBranchNodeData | AIRootNodeData | undefined;
                if (n.type === 'aiRoot') return 'rgb(99,102,241)';
                const bi = (data as AIBranchNodeData | undefined)?.branchIndex ?? 0;
                return bi >= 0
                  ? BRANCH_PALETTE[bi % BRANCH_PALETTE.length].stroke
                  : 'rgb(148,163,184)';
              }}
            />
            <Controls className="!bg-card !border !border-border" showInteractive={false} />
          </ReactFlow>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
            <Lightbulb className="w-10 h-10 mb-3 text-amber-500/70" />
            <p className="text-sm font-medium text-foreground mb-1">
              Your AI-generated mind map will appear here
            </p>
            <p className="text-xs max-w-md">
              Describe what you're thinking about above — a project plan, a strategy, an
              architecture, a research topic — and we'll turn it into a clean tree of branches and
              sub-points.
            </p>
          </div>
        )}
        {loading && flowGraph && (
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

export const AIMindMap: React.FC = () => (
  <ReactFlowProvider>
    <AIMindMapInner />
  </ReactFlowProvider>
);

export default AIMindMap;
