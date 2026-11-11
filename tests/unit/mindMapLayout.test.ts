import { describe, expect, it } from 'vitest';
import {
  NODE_SIZE,
  layoutBoard,
  placeChild,
  placeSibling,
  tidyLayout,
  type Box,
  type TidyBoardNode,
  type TidyIdea,
} from '@/components/mindmap/mindMapLayout';

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const centreY = (y: number, kind: keyof typeof NODE_SIZE) => y + NODE_SIZE[kind].h / 2;

describe('layoutBoard', () => {
  const lanes = [
    {
      nodeId: 'col-a',
      tasks: [
        { nodeId: 'task-1', subtaskNodeIds: ['sub-1-a', 'sub-1-b', 'sub-1-c'] },
        { nodeId: 'task-2', subtaskNodeIds: [] },
      ],
    },
    { nodeId: 'col-b', tasks: [] },
    { nodeId: 'col-c', tasks: [{ nodeId: 'task-3', subtaskNodeIds: [] }] },
  ];

  it('positions every node left-to-right by level', () => {
    const p = layoutBoard(lanes);
    expect(Object.keys(p).sort()).toEqual(
      ['project', 'col-a', 'col-b', 'col-c', 'task-1', 'task-2', 'task-3', 'sub-1-a', 'sub-1-b', 'sub-1-c'].sort(),
    );
    expect(p.project.x).toBeLessThan(p['col-a'].x);
    expect(p['col-a'].x).toBeLessThan(p['task-1'].x);
    expect(p['task-1'].x).toBeLessThan(p['sub-1-a'].x);
  });

  it('centres a column on its tasks and a task on its subtasks', () => {
    const p = layoutBoard(lanes);
    const colA = centreY(p['col-a'].y, 'column');
    const t1 = centreY(p['task-1'].y, 'task');
    const t2 = centreY(p['task-2'].y, 'task');
    expect(colA).toBeCloseTo((t1 + t2) / 2);
    const subMid = centreY(p['sub-1-b'].y, 'subtask');
    expect(subMid).toBeCloseTo(t1);
  });

  it('keeps lanes in order without vertical overlap between tasks', () => {
    const p = layoutBoard(lanes);
    expect(p['task-2'].y).toBeGreaterThan(p['task-1'].y + NODE_SIZE.task.h);
    expect(p['col-b'].y).toBeGreaterThan(p['col-a'].y);
    expect(p['task-3'].y).toBeGreaterThan(p['task-2'].y + NODE_SIZE.task.h);
    // Subtasks of the first task don't poke above the lane start.
    expect(p['sub-1-a'].y).toBeGreaterThanOrEqual(0);
  });

  it('collapsed lanes take one slot and hide their tasks', () => {
    const open = layoutBoard(lanes);
    const closed = layoutBoard(lanes, new Set(['col-a']));
    expect(closed['task-1']).toBeUndefined();
    expect(closed['sub-1-a']).toBeUndefined();
    expect(closed['col-a']).toBeDefined();
    expect(closed['task-3'].y).toBeLessThan(open['task-3'].y);
  });

  it('handles an empty board', () => {
    const p = layoutBoard([]);
    expect(p.project).toEqual({ x: 0, y: 0 });
  });
});

describe('tidyLayout', () => {
  const board: TidyBoardNode[] = [
    { id: 'project', kind: 'project', x: 0, y: 0, w: 320, h: 116 },
    { id: 'col-a', kind: 'column', x: 440, y: 30, w: 264, h: 60 },
    { id: 'task-1', kind: 'task', x: 820, y: 0, w: 300, h: 108 },
    { id: 'sub-1', kind: 'subtask', x: 1220, y: 30, w: 260, h: 40 },
    { id: 'task-2', kind: 'task', x: 820, y: 200, w: 300, h: 108 },
  ];
  const idea = (id: string, x = 5000, y = 5000): TidyIdea => ({ id, x, y, w: 220, h: 48 });

  it('returns nothing when there are no ideas', () => {
    expect(tidyLayout({ board, ideas: [], links: [] })).toEqual({});
  });

  it('puts a linked idea to the right of its card, clear of other cards', () => {
    const out = tidyLayout({
      board,
      ideas: [idea('idea-a')],
      links: [{ source: 'task-1', target: 'idea-a' }],
    });
    const box = { ...out['idea-a'], w: 220, h: 48 };
    expect(box.x).toBeGreaterThan(820 + 300);
    for (const b of board) expect(overlap(box, b)).toBe(false);
    // Vertically near its task.
    expect(Math.abs(box.y + 24 - (0 + 54))).toBeLessThan(60);
  });

  it('lays out idea chains as a tree with children right of parents', () => {
    const out = tidyLayout({
      board,
      ideas: [idea('idea-a'), idea('idea-b'), idea('idea-c')],
      links: [
        { source: 'task-2', target: 'idea-a' },
        { source: 'idea-a', target: 'idea-b' },
        { source: 'idea-a', target: 'idea-c' },
      ],
    });
    expect(out['idea-b'].x).toBeGreaterThan(out['idea-a'].x);
    expect(out['idea-c'].x).toBe(out['idea-b'].x);
    expect(Math.abs(out['idea-b'].y - out['idea-c'].y)).toBeGreaterThanOrEqual(48);
  });

  it('never overlaps blocks from different anchors', () => {
    const ideas = Array.from({ length: 6 }, (_, i) => idea(`idea-${i}`, 0, i));
    const links = ideas.map((x, i) => ({ source: i % 2 ? 'task-1' : 'task-2', target: x.id }));
    const out = tidyLayout({ board, ideas, links });
    const boxes = ideas.map((x) => ({ ...out[x.id], w: x.w, h: x.h }));
    for (let i = 0; i < boxes.length; i++) {
      for (const b of board) expect(overlap(boxes[i], b)).toBe(false);
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
  });

  it('parks unlinked ideas below the board, keeping their own links as trees', () => {
    const out = tidyLayout({
      board,
      ideas: [idea('idea-x', 0, 1), idea('idea-y', 0, 2), idea('idea-z', 0, 3)],
      links: [{ source: 'idea-x', target: 'idea-y' }],
    });
    const boardBottom = Math.max(...board.map((b) => b.y + b.h));
    for (const id of ['idea-x', 'idea-y', 'idea-z']) expect(out[id].y).toBeGreaterThan(boardBottom);
    expect(out['idea-y'].x).toBeGreaterThan(out['idea-x'].x);
    expect(out['idea-z'].y).toBeGreaterThan(out['idea-x'].y);
  });

  it('prefers the most specific card when an idea links to several', () => {
    const out = tidyLayout({
      board,
      ideas: [idea('idea-a')],
      links: [
        { source: 'project', target: 'idea-a' },
        { source: 'sub-1', target: 'idea-a' },
      ],
    });
    expect(out['idea-a'].x).toBeGreaterThan(1220 + 260);
  });

  it('survives cycles and links to unknown nodes', () => {
    const out = tidyLayout({
      board,
      ideas: [idea('idea-a'), idea('idea-b')],
      links: [
        { source: 'idea-a', target: 'idea-b' },
        { source: 'idea-b', target: 'idea-a' },
        { source: 'idea-a', target: 'idea-a' },
        { source: 'ghost', target: 'idea-a' },
      ],
    });
    expect(Object.keys(out).sort()).toEqual(['idea-a', 'idea-b']);
  });
});

describe('placeChild / placeSibling', () => {
  const parent: Box = { x: 100, y: 100, w: 200, h: 60 };

  it('places a first child to the right, vertically centred', () => {
    const p = placeChild(parent, [], { w: 220, h: 40 }, 80);
    expect(p).toEqual({ x: 380, y: 110 });
  });

  it('places further children below existing ones', () => {
    const p = placeChild(parent, [{ x: 380, y: 110, w: 220, h: 40 }], { w: 220, h: 40 }, 80, 16);
    expect(p).toEqual({ x: 380, y: 166 });
  });

  it('places a sibling below the lowest of node and siblings', () => {
    expect(placeSibling({ x: 10, y: 10, w: 100, h: 40 }, [], 16)).toEqual({ x: 10, y: 66 });
    expect(placeSibling({ x: 10, y: 10, w: 100, h: 40 }, [{ x: 10, y: 100, w: 100, h: 40 }], 16)).toEqual({
      x: 10,
      y: 156,
    });
  });
});
