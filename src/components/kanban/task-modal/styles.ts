/**
 * Shared class strings for the task dialog so spacing, radius, focus and
 * motion stay consistent across its pieces.
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
 * hovered/focused. 40px tall on touch, 32px on desktop.
 */
export const GHOST_FIELD =
  'h-10 md:h-8 min-h-0 md:min-h-0 w-full justify-start gap-2 rounded-md border border-transparent bg-transparent px-2 text-left text-sm font-normal shadow-none transition-colors hover:bg-muted focus:ring-2 focus:ring-ring focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 data-[state=open]:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';

/** Small uppercase section heading in the main column. */
export const SECTION_LABEL =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground';
