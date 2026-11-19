import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../errors.js";

/**
 * Rate limits for the documents server, kept in public.sr_attempts (one row
 * per attempt: tool, key, created_at). Service role only.
 *
 * spend() inserts first and counts second, so two parallel requests can't both
 * slip under the limit. It fails CLOSED: a store error refuses the request (the
 * caller answers 503) instead of letting it run.
 */

export const ATTEMPTS_TABLE = "sr_attempts";
const DAY_MS = 86_400_000;
/** Chance per allowed request of deleting rows older than a day. */
const CLEANUP_CHANCE = 0.05;

export const UNAVAILABLE_MESSAGE = "This tool is busy right now. Please try again in a minute.";

export const minutes = (m: number) => `${m} minute${m === 1 ? "" : "s"}`;

export type SpendResult = { ok: true } | { ok: false; minutesLeft: number; unavailable?: boolean };

const UNAVAILABLE: SpendResult = { ok: false, minutesLeft: 1, unavailable: true };

/** The workspace's own bucket in sr_attempts. */
export const workspaceLimitKey = (workspaceId: string) => `workspace:${workspaceId}`;

/** Pure: given this key's attempt times (including the one just made), may it proceed? */
export function limitVerdict(
  attemptTimes: string[],
  now: Date,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; minutesLeft: number } {
  const since = now.getTime() - windowMs;
  const recent = attemptTimes.map((t) => Date.parse(t)).filter((t) => t > since).sort((a, b) => a - b);
  if (recent.length <= limit) return { ok: true };
  const freesAt = recent[recent.length - limit] + windowMs;
  return { ok: false, minutesLeft: Math.max(1, Math.ceil((freesAt - now.getTime()) / 60_000)) };
}

export async function spend(
  sb: SupabaseClient,
  tool: string,
  key: string,
  limit: number,
  windowMin: number,
): Promise<SpendResult> {
  const windowMs = windowMin * 60_000;
  const since = new Date(Date.now() - windowMs).toISOString();
  try {
    const ins = await sb.from(ATTEMPTS_TABLE).insert({ tool, key });
    if (ins.error) return UNAVAILABLE;
    const got = await sb
      .from(ATTEMPTS_TABLE)
      .select("created_at")
      .eq("tool", tool)
      .eq("key", key)
      .gte("created_at", since);
    if (got.error || !got.data) return UNAVAILABLE;
    const times = (got.data as { created_at: string }[]).map((r) => r.created_at);
    if (times.length <= limit) {
      if (Math.random() < CLEANUP_CHANCE) {
        await sb
          .from(ATTEMPTS_TABLE)
          .delete()
          .lt("created_at", new Date(Date.now() - DAY_MS).toISOString())
          .then(() => undefined, () => undefined);
      }
      return { ok: true };
    }
    const verdict = limitVerdict(times, new Date(), limit, windowMs);
    // The database clock and ours can disagree by a moment; the count already said "over".
    return { ok: false, minutesLeft: verdict.ok === false ? verdict.minutesLeft : 1 };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Read-only twin of spend(): counts this tool+key's attempts in the window
 * without adding one, plus one synthetic "now" entry, so a key already at the
 * limit reads as blocked, exactly as spend() would score the next attempt.
 * Fails closed.
 */
export async function peek(
  sb: SupabaseClient,
  tool: string,
  key: string,
  limit: number,
  windowMin: number,
): Promise<SpendResult> {
  const windowMs = windowMin * 60_000;
  const since = new Date(Date.now() - windowMs).toISOString();
  try {
    const got = await sb
      .from(ATTEMPTS_TABLE)
      .select("created_at")
      .eq("tool", tool)
      .eq("key", key)
      .gte("created_at", since);
    if (got.error || !got.data) return UNAVAILABLE;
    const now = new Date();
    const times = [...(got.data as { created_at: string }[]).map((r) => r.created_at), now.toISOString()];
    return limitVerdict(times, now, limit, windowMs);
  } catch {
    return UNAVAILABLE;
  }
}

/** A refused sr_attempts verdict as an AppError: 503 when the store failed, else 429. */
export function refuseVerdict(v: SpendResult, message: (minutesLeft: number) => string): void {
  if (v.ok !== false) return;
  if (v.unavailable) throw new AppError(UNAVAILABLE_MESSAGE, 503);
  throw new AppError(message(Math.max(1, v.minutesLeft)), 429);
}
