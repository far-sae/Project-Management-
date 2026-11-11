import { EMPTY_EXTRAS, type MindMapExtras } from './mindMapTypes';

/** localStorage key — unchanged since v1 so existing maps keep loading. */
export const storageKey = (projectId: string) => `mindmap_extras_v1:${projectId}`;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce any persisted value (old or new shape, or garbage) into a valid
 *  MindMapExtras. Ideas/edges are passed through untouched (same as the
 *  original loader) so existing data round-trips byte-for-byte; only the
 *  newer optional fields get validated + defaulted. */
export function normalizeExtras(raw: unknown): MindMapExtras {
  if (!isPlainObject(raw)) return { ...EMPTY_EXTRAS };
  const parsed = raw as Partial<MindMapExtras>;
  const out: MindMapExtras = {
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    positions: isPlainObject(parsed.positions)
      ? (parsed.positions as MindMapExtras['positions'])
      : {},
    removedAutoEdges: Array.isArray(parsed.removedAutoEdges)
      ? parsed.removedAutoEdges.filter((v): v is string => typeof v === 'string')
      : [],
  };
  if (Array.isArray(parsed.collapsedColumns)) {
    const cols = parsed.collapsedColumns.filter((v): v is string => typeof v === 'string');
    if (cols.length > 0) out.collapsedColumns = cols;
  }
  return out;
}

export function loadExtras(projectId: string): MindMapExtras {
  if (typeof window === 'undefined') return { ...EMPTY_EXTRAS };
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return { ...EMPTY_EXTRAS };
    return normalizeExtras(JSON.parse(raw));
  } catch {
    return { ...EMPTY_EXTRAS };
  }
}

export function saveExtras(projectId: string, extras: MindMapExtras): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(extras));
  } catch {
    /* storage full / disabled — soft-fail */
  }
}

/** Same "has data" test the original cloud loader used: ideas, edges or
 *  position overrides. (Hidden links alone never made cloud win.) */
export function cloudHasData(cloud: MindMapExtras): boolean {
  return cloud.ideas.length > 0 || cloud.edges.length > 0 || Object.keys(cloud.positions).length > 0;
}

/** Pick the state to show after the cloud fetch resolves. Cloud wins when it
 *  has data (unchanged behaviour). The cloud reader in services/ strips
 *  fields it doesn't know about, so UI-only optional fields such as
 *  `collapsedColumns` are carried over from the local copy when the cloud
 *  copy lacks them. */
export function mergeCloudExtras(cloud: MindMapExtras, local: MindMapExtras): MindMapExtras {
  if (!cloudHasData(cloud)) return local;
  const merged = normalizeExtras(cloud);
  if (!merged.collapsedColumns && local.collapsedColumns) {
    merged.collapsedColumns = local.collapsedColumns;
  }
  return merged;
}
