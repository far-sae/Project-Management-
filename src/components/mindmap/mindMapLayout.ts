// Pure layout helpers for the project mind map: the automatic board layout,
// "Tidy up" for user ideas, and placement of new child / sibling ideas.
// No React / React Flow imports — everything here is unit-tested.

export interface XY {
  x: number;
  y: number;
}

export interface Box extends XY {
  w: number;
  h: number;
}

export type BoardNodeKind = 'project' | 'column' | 'task' | 'subtask';

/** Size estimates used before React Flow has measured a node. */
export const NODE_SIZE: Record<BoardNodeKind | 'idea', { w: number; h: number }> = {
  project: { w: 320, h: 116 },
  column: { w: 264, h: 60 },
  task: { w: 300, h: 108 },
  subtask: { w: 260, h: 40 },
  idea: { w: 220, h: 48 },
};

const COLUMN_X = 440;
const TASK_X = 820;
const SUBTASK_X = 1220;
const TASK_SLOT = 128; // vertical slot per task card
const SUBTASK_GAP = 52; // centre-to-centre distance between subtasks
const LANE_GAP = 48; // vertical gap between lanes

export interface LayoutTask {
  nodeId: string;
  subtaskNodeIds: string[];
}

export interface LayoutLane {
  nodeId: string;
  tasks: LayoutTask[];
}

/** Automatic left-to-right layout: project → columns → tasks → subtasks.
 *  Each column is centred on its tasks, each task on its subtasks, and the
 *  project on its columns. Collapsed lanes take a single slot and their
 *  tasks / subtasks get no position (they are hidden). Returns top-left
 *  positions keyed by node id. */
export function layoutBoard(
  lanes: LayoutLane[],
  collapsed: ReadonlySet<string> = new Set(),
  projectNodeId = 'project',
): Record<string, XY> {
  const pos: Record<string, XY> = {};
  const topLeft = (cy: number, kind: BoardNodeKind) => cy - NODE_SIZE[kind].h / 2;

  let cursor = 0;
  const columnCentres: number[] = [];
  for (const lane of lanes) {
    const isCollapsed = collapsed.has(lane.nodeId);
    const taskCentres: number[] = [];
    if (!isCollapsed) {
      for (const task of lane.tasks) {
        const k = task.subtaskNodeIds.length;
        const block = Math.max(TASK_SLOT, k * SUBTASK_GAP);
        const centre = cursor + block / 2;
        taskCentres.push(centre);
        pos[task.nodeId] = { x: TASK_X, y: topLeft(centre, 'task') };
        task.subtaskNodeIds.forEach((sid, i) => {
          const sc = centre + (i - (k - 1) / 2) * SUBTASK_GAP;
          pos[sid] = { x: SUBTASK_X, y: topLeft(sc, 'subtask') };
        });
        cursor += block;
      }
    }
    let colCentre: number;
    if (taskCentres.length > 0) {
      colCentre = (taskCentres[0] + taskCentres[taskCentres.length - 1]) / 2;
    } else {
      colCentre = cursor + TASK_SLOT / 2;
      cursor += TASK_SLOT;
    }
    columnCentres.push(colCentre);
    pos[lane.nodeId] = { x: COLUMN_X, y: topLeft(colCentre, 'column') };
    cursor += LANE_GAP;
  }

  const projectCentre =
    columnCentres.length > 0
      ? (columnCentres[0] + columnCentres[columnCentres.length - 1]) / 2
      : NODE_SIZE.project.h / 2;
  pos[projectNodeId] = { x: 0, y: topLeft(projectCentre, 'project') };
  return pos;
}

// ─────────────────────────────────────────────────────────────
// Tidy up
// ─────────────────────────────────────────────────────────────

export interface TidyBoardNode extends Box {
  id: string;
  kind: BoardNodeKind;
}

export interface TidyIdea extends Box {
  id: string;
}

export interface TidyInput {
  /** Visible board-derived nodes at their AUTOMATIC positions. */
  board: TidyBoardNode[];
  /** Ideas at their current positions (used to keep the user's ordering). */
  ideas: TidyIdea[];
  /** User-drawn links. Direction is used to pick tree parents. */
  links: Array<{ source: string; target: string }>;
  gapX?: number;
  gapY?: number;
}

interface TreeNode {
  id: string;
  w: number;
  h: number;
  children: TreeNode[];
}

const KIND_SPECIFICITY: Record<BoardNodeKind, number> = {
  subtask: 0,
  task: 1,
  column: 2,
  project: 3,
};

const overlaps = (a: Box, b: Box, margin = 0) =>
  a.x < b.x + b.w + margin &&
  b.x < a.x + a.w + margin &&
  a.y < b.y + b.h + margin &&
  b.y < a.y + a.h + margin;

/** Lay out a forest as columns-by-depth, children centred on parents.
 *  Positions are written into `out`; returns the forest's bounding size. */
function placeForest(
  forest: TreeNode[],
  x0: number,
  top: number,
  gapX: number,
  gapY: number,
  out: Record<string, XY>,
): { w: number; h: number } {
  const heights = new Map<string, number>();
  const subtreeH = (n: TreeNode): number => {
    const cached = heights.get(n.id);
    if (cached !== undefined) return cached;
    const kids = n.children.reduce((s, c) => s + subtreeH(c), 0) + gapY * Math.max(0, n.children.length - 1);
    const h = Math.max(n.h, kids);
    heights.set(n.id, h);
    return h;
  };
  const depthW: number[] = [];
  const walk = (n: TreeNode, d: number) => {
    depthW[d] = Math.max(depthW[d] ?? 0, n.w);
    n.children.forEach((c) => walk(c, d + 1));
  };
  forest.forEach((r) => walk(r, 0));
  const colX: number[] = [];
  depthW.forEach((_, d) => {
    colX[d] = d === 0 ? x0 : colX[d - 1] + depthW[d - 1] + gapX;
  });

  const place = (n: TreeNode, d: number, t: number) => {
    const H = subtreeH(n);
    out[n.id] = { x: colX[d], y: t + (H - n.h) / 2 };
    const total =
      n.children.reduce((s, c) => s + subtreeH(c), 0) + gapY * Math.max(0, n.children.length - 1);
    let cy = t + (H - total) / 2;
    for (const c of n.children) {
      place(c, d + 1, cy);
      cy += subtreeH(c) + gapY;
    }
  };

  let y = top;
  forest.forEach((r, i) => {
    place(r, 0, y);
    y += subtreeH(r) + (i < forest.length - 1 ? gapY : 0);
  });
  const width = depthW.length > 0 ? colX[depthW.length - 1] + depthW[depthW.length - 1] - x0 : 0;
  return { w: width, h: y - top };
}

/** Arrange ideas neatly near what they're connected to.
 *
 *  - Ideas linked (directly or through other ideas) to a board node form a
 *    tree that sits to the right of that node, in the first free space in
 *    its row band, vertically centred on it.
 *  - Ideas not linked to the board are laid out as trees in a parking area
 *    below the board.
 *  - Blocks never overlap each other or board nodes.
 *
 *  Returns new positions for every idea (board nodes are not included — the
 *  caller drops their overrides so they fall back to the automatic layout). */
export function tidyLayout(input: TidyInput): Record<string, XY> {
  const gapX = input.gapX ?? 72;
  const gapY = input.gapY ?? 20;
  const out: Record<string, XY> = {};
  if (input.ideas.length === 0) return out;

  const ideaById = new Map(input.ideas.map((i) => [i.id, i]));
  const boardById = new Map(input.board.map((b) => [b.id, b]));

  // Undirected adjacency + directed "has parent among ideas" info.
  const neighbours = new Map<string, Set<string>>();
  const addN = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  const hasIdeaParent = new Set<string>();
  for (const l of input.links) {
    if (l.source === l.target) continue;
    const sKnown = ideaById.has(l.source) || boardById.has(l.source);
    const tKnown = ideaById.has(l.target) || boardById.has(l.target);
    if (!sKnown || !tKnown) continue;
    addN(l.source, l.target);
    addN(l.target, l.source);
    if (ideaById.has(l.source) && ideaById.has(l.target)) hasIdeaParent.add(l.target);
  }

  const byCurrentPos = (a: string, b: string) => {
    const A = ideaById.get(a)!;
    const B = ideaById.get(b)!;
    return A.y - B.y || A.x - B.x || a.localeCompare(b);
  };

  const assigned = new Set<string>();
  // Build a tree rooted at `rootIds` (already marked assigned) via BFS so each
  // idea is attached to the nearest parent.
  const buildForest = (rootIds: string[]): TreeNode[] => {
    const nodes = new Map<string, TreeNode>();
    const mk = (id: string): TreeNode => {
      const i = ideaById.get(id)!;
      const n: TreeNode = { id, w: i.w, h: i.h, children: [] };
      nodes.set(id, n);
      return n;
    };
    const roots = rootIds.map(mk);
    const queue = [...rootIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const kids = [...(neighbours.get(id) ?? [])]
        .filter((n) => ideaById.has(n) && !assigned.has(n))
        .sort(byCurrentPos);
      for (const k of kids) {
        assigned.add(k);
        nodes.get(id)!.children.push(mk(k));
        queue.push(k);
      }
    }
    return roots;
  };

  // 1) Board-anchored groups — most specific board nodes claim ideas first.
  const anchors = [...input.board].sort(
    (a, b) => KIND_SPECIFICITY[a.kind] - KIND_SPECIFICITY[b.kind] || a.y - b.y || a.x - b.x,
  );
  const groups: Array<{ anchor: TidyBoardNode; forest: TreeNode[] }> = [];
  for (const anchor of anchors) {
    const direct = [...(neighbours.get(anchor.id) ?? [])]
      .filter((n) => ideaById.has(n) && !assigned.has(n))
      .sort(byCurrentPos);
    if (direct.length === 0) continue;
    direct.forEach((d) => assigned.add(d));
    groups.push({ anchor, forest: buildForest(direct) });
  }

  const placedBlocks: Box[] = [];
  const boardBoxes: Box[] = input.board;

  // Measure each group, then place in order of anchor centre so blocks stack
  // top-to-bottom without leapfrogging.
  const measured = groups
    .map((g) => {
      const scratch: Record<string, XY> = {};
      const size = placeForest(g.forest, 0, 0, gapX, gapY, scratch);
      return { ...g, size, scratch, centre: g.anchor.y + g.anchor.h / 2 };
    })
    .sort((a, b) => a.centre - b.centre || a.anchor.x - b.anchor.x);

  for (const g of measured) {
    let top = g.centre - g.size.h / 2;
    let x = g.anchor.x + g.anchor.w + gapX;
    for (let guard = 0; guard < 500; guard++) {
      // First free x in this row band, to the right of the anchor.
      const band: Box = { x: g.anchor.x + g.anchor.w, y: top, w: Number.MAX_SAFE_INTEGER / 4, h: g.size.h };
      let right = g.anchor.x + g.anchor.w;
      for (const b of boardBoxes) {
        if (b === g.anchor) continue;
        if (b.x + b.w > g.anchor.x + g.anchor.w && overlaps(band, b, gapY / 2)) {
          right = Math.max(right, b.x + b.w);
        }
      }
      x = right + gapX;
      const candidate: Box = { x, y: top, w: g.size.w, h: g.size.h };
      const hit = placedBlocks.find((p) => overlaps(candidate, p, gapY / 2));
      if (!hit) break;
      top = hit.y + hit.h + gapY;
    }
    for (const [id, p] of Object.entries(g.scratch)) out[id] = { x: p.x + x, y: p.y + top };
    placedBlocks.push({ x, y: top, w: g.size.w, h: g.size.h });
  }

  // 2) Free-floating components — parked below everything else.
  const remaining = input.ideas.map((i) => i.id).filter((id) => !assigned.has(id)).sort(byCurrentPos);
  if (remaining.length > 0) {
    const all = [...boardBoxes, ...placedBlocks];
    const left = all.length > 0 ? Math.min(...all.map((b) => b.x)) : 0;
    let top = all.length > 0 ? Math.max(...all.map((b) => b.y + b.h)) + gapY * 4 : 0;
    for (const id of remaining) {
      if (assigned.has(id)) continue; // claimed by an earlier component
      // Prefer a root without an idea parent in this component.
      const component: string[] = [];
      const seen = new Set([id]);
      const q = [id];
      while (q.length > 0) {
        const c = q.shift()!;
        component.push(c);
        for (const n of neighbours.get(c) ?? []) {
          if (ideaById.has(n) && !seen.has(n) && !assigned.has(n)) {
            seen.add(n);
            q.push(n);
          }
        }
      }
      const root = component.filter((c) => !hasIdeaParent.has(c)).sort(byCurrentPos)[0] ?? id;
      assigned.add(root);
      const forest = buildForest([root]);
      const size = placeForest(forest, left, top, gapX, gapY, out);
      top += size.h + gapY * 2;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// New idea placement (Tab = child, Enter = sibling)
// ─────────────────────────────────────────────────────────────

/** Position for a new child to the right of `parent`, below any existing
 *  children so nothing overlaps. */
export function placeChild(
  parent: Box,
  existingChildren: Box[],
  size: { w: number; h: number } = NODE_SIZE.idea,
  gapX = 72,
  gapY = 16,
): XY {
  if (existingChildren.length === 0) {
    return { x: parent.x + parent.w + gapX, y: parent.y + parent.h / 2 - size.h / 2 };
  }
  const bottom = Math.max(...existingChildren.map((c) => c.y + c.h));
  const x = Math.min(...existingChildren.map((c) => c.x));
  return { x, y: bottom + gapY };
}

/** Position for a new sibling directly below `node` (and below any other
 *  siblings that already sit lower). */
export function placeSibling(node: Box, siblings: Box[], gapY = 16): XY {
  const bottom = Math.max(node.y + node.h, ...siblings.map((s) => s.y + s.h));
  return { x: node.x, y: bottom + gapY };
}
