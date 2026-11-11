// Find-on-map matching + ranking. Pure so it can be unit-tested.

export type SearchKind = 'task' | 'subtask' | 'column' | 'idea' | 'project';

export interface SearchItem {
  id: string;
  label: string;
  kind: SearchKind;
  /** Secondary text shown under the label (e.g. the column a task is in). */
  context?: string;
}

export interface SearchResult extends SearchItem {
  score: number;
}

/** Lower = more important when two matches score the same. */
const KIND_ORDER: Record<SearchKind, number> = {
  task: 0,
  idea: 1,
  column: 2,
  subtask: 3,
  project: 4,
};

export const normalizeForSearch = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Score a label against an already-normalised query. Lower is better;
 *  null = no match.
 *   0 exact · 1 prefix · 2 word prefix · 3 substring · 4 all words present */
export function matchScore(label: string, normalizedQuery: string): number | null {
  if (!normalizedQuery) return null;
  const l = normalizeForSearch(label);
  if (!l) return null;
  if (l === normalizedQuery) return 0;
  if (l.startsWith(normalizedQuery)) return 1;
  const words = l.split(/[\s\-_/.,:;()[\]]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(normalizedQuery))) return 2;
  if (l.includes(normalizedQuery)) return 3;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => l.includes(t))) return 4;
  return null;
}

export function searchMindMap(items: SearchItem[], query: string, limit = 8): SearchResult[] {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const out: SearchResult[] = [];
  for (const item of items) {
    const score = matchScore(item.label, q);
    if (score !== null) out.push({ ...item, score });
  }
  out.sort(
    (a, b) =>
      a.score - b.score ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.label.length - b.label.length ||
      a.label.localeCompare(b.label),
  );
  return out.slice(0, Math.max(0, limit));
}
