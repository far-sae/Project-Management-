import type { WorkspaceRules } from "./shared/types.js";

/**
 * The hours emails may go out in. An email is written at any time and sent
 * only while the workspace's window is open; outside it, it waits for the
 * next opening.
 */

type Window = WorkspaceRules["sendWindow"];

/** The weekday (Mon..Sun as 1..7) and hour (0..23) it is in the window's own time zone. */
function localTime(zone: string, at: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")) + 1, hour: Number(part("hour")) % 24 };
}

/** A zone this runtime does not know reads as UTC, so a bad value can delay an email but never lose it. */
function safeZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

export function windowOpen(w: Window, at: Date): boolean {
  const { weekday, hour } = localTime(safeZone(w.timeZone), at);
  if (w.weekdaysOnly && weekday > 5) return false;
  return hour >= w.startHour && hour < w.endHour;
}

const QUARTER_MS = 15 * 60_000;

/**
 * The first moment at or after `at` when the window is open. Looked for in
 * quarter-hour steps (every time zone's offset is a multiple of that) for up
 * to eight days; a window that never opens gives the moment eight days on.
 */
export function nextOpening(w: Window, at: Date): Date {
  if (windowOpen(w, at)) return at;
  let t = Math.ceil(at.getTime() / QUARTER_MS) * QUARTER_MS;
  for (let i = 0; i < 8 * 96; i++, t += QUARTER_MS) if (windowOpen(w, new Date(t))) return new Date(t);
  return new Date(t);
}

/** "Mon 09:00" in the window's own time zone. */
export function windowLabel(w: Window, at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(w.timeZone), weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).replace(/,/g, "");
}
