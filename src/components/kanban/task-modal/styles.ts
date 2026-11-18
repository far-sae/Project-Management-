/**
 * Shared class strings for the task dialog so spacing, radius, focus and
 * motion stay consistent across its pieces.
 *
 * Control heights come from the primitives (Button / Input / SelectTrigger:
 * 32px on desktop, 44px on touch); nothing here overrides them.
 *
 * Motion rules: transform/opacity/colour only, ≤ 200ms, ease-out
 * (cubic-bezier(0.23,1,0.32,1)), never `transition: all`, and nothing when
 * the user prefers reduced motion.
 */

/** Press feedback for buttons. */
export const PRESS =
  'motion-safe:transition-[color,background-color,border-color,box-shadow,transform] motion-safe:duration-150 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.97]';

/** Visible keyboard focus ring for custom (non-shadcn) controls. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Value control in the properties panel: looks like plain text until
 * hovered/focused. Its box starts at the value column's edge and its text
 * 8px in (`px-2`) — the one left edge every value in the panel shares.
 */
export const GHOST_FIELD =
  'w-full gap-2 rounded-md border border-transparent bg-transparent px-2 text-left text-[13px] font-medium shadow-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-offset-0 data-[state=open]:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';

/** Section heading in the main column (sentence case, one style everywhere). */
export const SECTION_LABEL = 'text-[13px] font-medium text-muted-foreground';

/** Links inside task text: plain foreground, underlined. */
export const TEXT_LINK = 'text-foreground decoration-foreground/40 hover:decoration-foreground';

/** Small neutral count / meta text next to a section heading. */
export const SECTION_META = 'text-xs text-muted-foreground tabular-nums';

/** 28px icon-only ghost button for inline row actions (40px on touch). */
export const ICON_BUTTON_SM =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50 md:h-7 md:w-7';

/**
 * The properties panel grid: a 96px label column and a value column. Every
 * row in the panel (including Meeting, Lock/PIN and Created/Updated) is laid
 * out on this template so labels and values each share one left edge.
 */
export const PROPERTY_GRID = 'grid grid-cols-[96px_minmax(0,1fr)] items-start gap-y-1';

/** Label cell of a property row: one control tall. */
export const PROPERTY_LABEL =
  'flex h-11 select-none items-center text-[13px] text-muted-foreground md:h-8';

/** Value cell of a property row: at least one control tall. */
export const PROPERTY_VALUE = 'flex min-h-11 min-w-0 flex-col justify-center md:min-h-8';

/** Plain (non-control) value content, on the shared value text edge. */
export const PROPERTY_TEXT = 'flex min-h-11 min-w-0 items-center gap-2 px-2 text-[13px] md:min-h-8';
