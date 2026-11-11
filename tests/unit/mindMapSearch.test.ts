import { describe, expect, it } from 'vitest';
import {
  matchScore,
  normalizeForSearch,
  searchMindMap,
  type SearchItem,
} from '@/components/mindmap/mindMapSearch';

const items: SearchItem[] = [
  { id: 'project', label: 'Website relaunch', kind: 'project' },
  { id: 'col-todo', label: 'To do', kind: 'column' },
  { id: 'col-design', label: 'Design', kind: 'column' },
  { id: 'task-1', label: 'Design homepage', kind: 'task', context: 'To do' },
  { id: 'task-2', label: 'Review page design', kind: 'task', context: 'To do' },
  { id: 'task-3', label: 'Redesign pricing', kind: 'task', context: 'Design' },
  { id: 'sub-1', label: 'Design tokens', kind: 'subtask', context: 'Design homepage' },
  { id: 'idea-1', label: 'Design system?', kind: 'idea' },
  { id: 'idea-2', label: 'Café menu', kind: 'idea' },
];

describe('normalizeForSearch', () => {
  it('lower-cases, strips accents and collapses spaces', () => {
    expect(normalizeForSearch('  Café   MENU ')).toBe('cafe menu');
  });
});

describe('matchScore', () => {
  it('ranks exact < prefix < word prefix < substring < all-words', () => {
    expect(matchScore('Design', 'design')).toBe(0);
    expect(matchScore('Design homepage', 'design')).toBe(1);
    expect(matchScore('Review page design', 'design')).toBe(2);
    expect(matchScore('Redesign pricing', 'design')).toBe(3);
    expect(matchScore('Review page design', 'review design')).toBe(4);
    expect(matchScore('Pricing', 'design')).toBeNull();
    expect(matchScore('', 'x')).toBeNull();
    expect(matchScore('x', '')).toBeNull();
  });
});

describe('searchMindMap', () => {
  it('returns nothing for an empty query', () => {
    expect(searchMindMap(items, '   ')).toEqual([]);
  });

  it('orders by match quality, then kind, then label length', () => {
    const ids = searchMindMap(items, 'design').map((r) => r.id);
    expect(ids).toEqual([
      'col-design', // exact
      'task-1', // prefix, task
      'idea-1', // prefix, idea
      'sub-1', // prefix, subtask
      'task-2', // word prefix
      'task-3', // substring
    ]);
  });

  it('matches accents and multiple words', () => {
    expect(searchMindMap(items, 'cafe').map((r) => r.id)).toEqual(['idea-2']);
    expect(searchMindMap(items, 'review design').map((r) => r.id)).toEqual(['task-2']);
  });

  it('respects the limit and keeps context', () => {
    const res = searchMindMap(items, 'de', 2);
    expect(res).toHaveLength(2);
    expect(searchMindMap(items, 'homepage')[0].context).toBe('To do');
  });
});
