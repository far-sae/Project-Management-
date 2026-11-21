/**
 * Saved views of the Leads list: a name for the search, filters and sorting in
 * use, so they come back with one click. They are kept in the browser, for the
 * person who made them. Pure functions, plus two that read and write storage
 * and never throw.
 */
import type { LeadOwnerView, LeadStep } from '@/lib/crmFlow';
import type { LeadSort } from '@/lib/crmListTools';

export interface LeadViewState {
  search: string;
  step: LeadStep | 'all';
  /** 'all', the "no category" value of the page, or a category name. */
  category: string;
  owner: LeadOwnerView;
  sort: LeadSort | null;
}

export interface SavedView {
  id: string;
  name: string;
  state: LeadViewState;
  /** True for a view the whole team has; such a view is kept with the workspace, not in a browser. */
  shared?: boolean;
}

/** The most views one person keeps for one workspace. */
export const MAX_VIEWS = 20;
export const VIEW_NAME_LIMIT = 40;

export const viewsKey = (userId: string, workspaceId: string): string => `crm.leadViews.${userId}.${workspaceId}`;

const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

/** A stored state made safe to use: anything missing or of the wrong kind becomes the default. */
export function tidyViewState(raw: unknown): LeadViewState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sort = r.sort && typeof r.sort === 'object' ? (r.sort as Record<string, unknown>) : null;
  const sortOk = sort
    && ['name', 'company', 'step', 'owner', 'added'].includes(String(sort.key))
    && (sort.direction === 'asc' || sort.direction === 'desc');
  return {
    search: text(r.search, ''),
    step: text(r.step, 'all') as LeadViewState['step'],
    category: text(r.category, 'all'),
    owner: (['all', 'mine', 'none'].includes(String(r.owner)) ? r.owner : 'all') as LeadOwnerView,
    sort: sortOk ? ({ key: sort.key, direction: sort.direction } as LeadSort) : null,
  };
}

/** True when two views would show the same list. */
export function sameView(a: LeadViewState, b: LeadViewState): boolean {
  return a.search.trim() === b.search.trim() && a.step === b.step && a.category === b.category && a.owner === b.owner
    && (a.sort?.key ?? null) === (b.sort?.key ?? null) && (a.sort?.direction ?? null) === (b.sort?.direction ?? null);
}

/**
 * The views with this one added. A view with the same name (capitals do not
 * matter) is replaced, keeping its place. Past the limit the oldest goes.
 */
export function withView(views: SavedView[], name: string, state: LeadViewState, id: string): SavedView[] {
  const clean = name.trim().slice(0, VIEW_NAME_LIMIT);
  if (!clean) return views;
  const tidy = { ...state, search: state.search.trim() };
  const at = views.findIndex((v) => v.name.toLowerCase() === clean.toLowerCase());
  if (at >= 0) return views.map((v, i) => (i === at ? { ...v, name: clean, state: tidy } : v));
  return [...views, { id, name: clean, state: tidy }].slice(-MAX_VIEWS);
}

export const withoutView = (views: SavedView[], id: string): SavedView[] => views.filter((v) => v.id !== id);

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The saved views, or none when storage is empty, blocked or holds something else. */
export function readViews(storage: Store | null | undefined, key: string): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string' && v.name.trim() !== '')
      .slice(0, MAX_VIEWS)
      .map((v) => ({ id: v.id as string, name: (v.name as string).slice(0, VIEW_NAME_LIMIT), state: tidyViewState(v.state) }));
  } catch {
    return [];
  }
}

/** Writes the views. False when the browser would not keep them (private window, storage full). */
export function writeViews(storage: Store | null | undefined, key: string, views: SavedView[]): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}
