import { afterEach, describe, expect, it } from 'vitest';
import {
  cloudHasData,
  loadExtras,
  mergeCloudExtras,
  normalizeExtras,
  saveExtras,
  storageKey,
} from '@/components/mindmap/mindMapExtras';
import type { MindMapExtras } from '@/components/mindmap/mindMapTypes';

// A v1 payload exactly as older builds wrote it — no collapsedColumns.
const legacy = {
  ideas: [
    { id: 'idea-1', label: 'Brainstorm', x: 10, y: 20, color: 'sky' },
    {
      id: 'idea-2',
      label: 'Launch checklist',
      x: 300,
      y: 40,
      color: 'emerald',
      kind: 'task',
      description: 'Notes',
      subtasks: [{ id: 's1', title: 'Write copy', completed: true }],
      attachments: [
        {
          fileId: 'f1',
          fileName: 'a.png',
          fileUrl: 'https://x/a.png',
          fileType: 'image/png',
          fileSize: 12,
          storagePath: 'p/a.png',
        },
      ],
    },
  ],
  edges: [{ id: 'extra-edge-1', source: 'task-t1', target: 'idea-1', sourceHandle: 'r-src', targetHandle: null }],
  positions: { 'task-t1': { x: 900, y: 12 }, 'idea-1': { x: 11, y: 21 } },
  removedAutoEdges: ['auto-edge-project-col-todo'],
};

afterEach(() => window.localStorage.clear());

describe('normalizeExtras', () => {
  it('loads legacy data unchanged and without new fields', () => {
    const out = normalizeExtras(JSON.parse(JSON.stringify(legacy)));
    expect(out).toEqual(legacy);
    expect('collapsedColumns' in out).toBe(false);
  });

  it('defaults missing / malformed fields safely', () => {
    expect(normalizeExtras(null)).toEqual({ ideas: [], edges: [], positions: {}, removedAutoEdges: [] });
    expect(normalizeExtras('nope')).toEqual({ ideas: [], edges: [], positions: {}, removedAutoEdges: [] });
    expect(
      normalizeExtras({ ideas: 'x', edges: {}, positions: [], removedAutoEdges: ['a', 1, null], collapsedColumns: 'col-a' }),
    ).toEqual({ ideas: [], edges: [], positions: {}, removedAutoEdges: ['a'] });
  });

  it('keeps valid collapsed columns and drops junk entries', () => {
    const out = normalizeExtras({ ...legacy, collapsedColumns: ['col-done', 3, 'col-todo'] });
    expect(out.collapsedColumns).toEqual(['col-done', 'col-todo']);
    expect(normalizeExtras({ ...legacy, collapsedColumns: [] }).collapsedColumns).toBeUndefined();
  });
});

describe('localStorage round-trip', () => {
  it('reads the unchanged v1 key', () => {
    expect(storageKey('p1')).toBe('mindmap_extras_v1:p1');
    window.localStorage.setItem('mindmap_extras_v1:p1', JSON.stringify(legacy));
    expect(loadExtras('p1')).toEqual(legacy);
  });

  it('returns empty extras for missing or corrupt data', () => {
    expect(loadExtras('nothing')).toEqual({ ideas: [], edges: [], positions: {}, removedAutoEdges: [] });
    window.localStorage.setItem('mindmap_extras_v1:bad', '{not json');
    expect(loadExtras('bad').ideas).toEqual([]);
  });

  it('saves and reloads new optional fields', () => {
    const next: MindMapExtras = { ...legacy, collapsedColumns: ['col-a'] } as MindMapExtras;
    saveExtras('p2', next);
    expect(loadExtras('p2')).toEqual(next);
  });
});

describe('mergeCloudExtras', () => {
  const empty: MindMapExtras = { ideas: [], edges: [], positions: {}, removedAutoEdges: [] };

  it('keeps local when the cloud copy is empty (original behaviour)', () => {
    const local = normalizeExtras(legacy);
    expect(mergeCloudExtras(empty, local)).toBe(local);
    expect(cloudHasData({ ...empty, removedAutoEdges: ['x'] })).toBe(false);
  });

  it('prefers cloud data but carries local collapsed columns the cloud reader drops', () => {
    const cloud = normalizeExtras(legacy);
    const local: MindMapExtras = { ...empty, collapsedColumns: ['col-done'] };
    const out = mergeCloudExtras(cloud, local);
    expect(out.ideas).toEqual(legacy.ideas);
    expect(out.collapsedColumns).toEqual(['col-done']);
  });

  it('lets the cloud value win when it has collapsed columns of its own', () => {
    const cloud = normalizeExtras({ ...legacy, collapsedColumns: ['col-a'] });
    const out = mergeCloudExtras(cloud, { ...empty, collapsedColumns: ['col-b'] });
    expect(out.collapsedColumns).toEqual(['col-a']);
  });
});
