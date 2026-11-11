import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('@/services/supabase/config', () => {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: h.state === null ? null : { state: h.state }, error: null }),
  };
  return { supabase: { from: () => q } };
});

import { loadMindMapState } from '@/services/supabase/mindmapState';

describe('loadMindMapState', () => {
  beforeEach(() => {
    h.state = null;
  });

  it('keeps collapsed columns so they sync between devices', async () => {
    h.state = { ideas: [], edges: [], positions: {}, removedAutoEdges: [], collapsedColumns: ['todo', 7, 'done'] };
    const s = await loadMindMapState('p1', 'u1');
    expect(s.collapsedColumns).toEqual(['todo', 'done']);
  });

  it('old saved maps without the field still load', async () => {
    h.state = { ideas: [{ id: 'idea-1' }], edges: [], positions: {}, removedAutoEdges: [] };
    const s = await loadMindMapState('p1', 'u1');
    expect(s.ideas).toHaveLength(1);
    expect(s.collapsedColumns).toBeUndefined();
  });
});
