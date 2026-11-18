/**
 * Class names for the call stage.
 *
 * The stage stays near-black in both the light and the dark theme, so it
 * cannot use the theme tokens (they flip with the theme). These are the fixed
 * greys from the approved call mock, kept in one place.
 */

/** The stage itself: near-black with white text. */
export const CALL_STAGE = 'bg-[#0a0a0a] text-white';
/** Tiles and cards that sit on the stage: slightly lighter. */
export const CALL_SURFACE = 'bg-[#1c1c1c]';
/** Hairline between parts of the stage. */
export const CALL_HAIRLINE = 'border-[#262626]';
/** Border of a card or button on the stage. */
export const CALL_BORDER = 'border-[#3a3a3a]';
/** Secondary text on the stage. */
export const CALL_MUTED_TEXT = 'text-[#a3a3a3]';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]';

/**
 * Bordered dark button for the top bar (32px; 40px on touch screens).
 * Add `px-3` for a labelled button or `w-10 md:w-8` for an icon-only one.
 */
export const CALL_BAR_BUTTON = `inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#3a3a3a] bg-[#1c1c1c] text-[13px] font-medium text-white transition-colors hover:bg-[#3a3a3a] disabled:pointer-events-none disabled:opacity-50 md:h-8 ${FOCUS}`;

/** Round control (mute, camera, …). Add a size and one of the states below. */
export const CALL_ROUND = `inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
/** Resting state: dark button, white icon. */
export const CALL_ROUND_IDLE = 'bg-[#262626] text-white hover:bg-[#3a3a3a]';
/** Toggled state (muted, camera off, blur on, sharing): light button, dark icon. */
export const CALL_ROUND_TOGGLED = 'bg-white text-[#0a0a0a] hover:bg-[#e5e5e5]';
/** End call, stop recording. */
export const CALL_ROUND_DANGER =
  'bg-destructive text-destructive-foreground hover:bg-destructive/90';

/** "Recording" badge shown to everyone on the call. */
export const CALL_RECORDING_BADGE =
  'inline-flex items-center gap-1.5 rounded-full bg-destructive font-medium text-destructive-foreground';
