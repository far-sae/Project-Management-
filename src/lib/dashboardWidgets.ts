// Pure, testable widget-list helpers for the Insights dashboard.
//
// These operate structurally on anything with `{ id; order; size }`, so they
// can be unit-tested without pulling in the Supabase service. The Insights
// page uses them with the full `Widget` type from
// `@/services/dashboards/dashboards`.
//
// All helpers are non-mutating: they return a fresh array with `order`
// re-sequenced to a clean 0..n-1 run so persistence + rendering stay in sync.

export type WidgetSize = "sm" | "md" | "lg";

/** Minimal structural shape the helpers need. */
export interface WidgetLike {
  id: string;
  order: number;
  size: WidgetSize;
}

/** Re-sequence `order` to 0..n-1 following current array position. */
const resequence = <T extends WidgetLike>(widgets: T[]): T[] =>
  widgets.map((w, i) => (w.order === i ? w : { ...w, order: i }));

/** Append a widget to the end, normalizing order across the whole list. */
export const addWidget = <T extends WidgetLike>(widgets: T[], widget: T): T[] =>
  resequence([...widgets, widget]);

/** Drop the widget with `id` (no-op if absent), then re-sequence. */
export const removeWidget = <T extends WidgetLike>(widgets: T[], id: string): T[] =>
  resequence(widgets.filter((w) => w.id !== id));

/** Move the widget with `id` one slot up/down. Edges + unknown id are no-ops. */
export const reorderWidget = <T extends WidgetLike>(
  widgets: T[],
  id: string,
  dir: "up" | "down",
): T[] => {
  // Operate on a position-sorted copy so the visible order matches `order`.
  const sorted = [...widgets].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((w) => w.id === id);
  if (idx === -1) return resequence(widgets);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= sorted.length) return resequence(widgets);
  const next = [...sorted];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return resequence(next);
};

/** Set the size of the widget with `id` (no-op if absent). */
export const setWidgetSize = <T extends WidgetLike>(
  widgets: T[],
  id: string,
  size: WidgetSize,
): T[] => widgets.map((w) => (w.id === id ? { ...w, size } : w));
