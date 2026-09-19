// The sequence cycle: one pass that turns due enrollments into queued mail.
//
// This is the materializer, and it is deliberately the smallest of the three
// loops. A sequence step is an ORDINARY email_messages row: the mailbox pool,
// the daily and hourly caps, the warmup ramp, the send window, the suppression
// list and the retry budget all belong to claim_email_batch() and engine.ts,
// and none of them are reimplemented or second-guessed here. What this file
// does is exactly two things per pass — run the reconcile sweep, then call
// claim_sequence_enrollments(), which advances each due enrollment AND writes
// its queued message in one statement. This file writes nothing itself.
//
// Everything with a side effect — the database and the clock — arrives through
// `SequenceDeps`, so `runSequenceCycle` runs end to end in
// tests/unit/emailSequenceCycle.test.ts with no database and no network. No
// decision about WHICH enrollment is due, or what happens to one that is
// suppressed, stopped or finished, lives here: that is all inside
// claim_sequence_enrollments() (migration 159), which makes the decision and
// the advance one statement so the same step cannot be handed out twice.
//
// The rules that shape the code below, and must not be quietly undone:
//
//   * IT NEVER SENDS. No transport, no SMTP, no claim_email_batch(), no
//     record_send_result(). It writes a queued row and stops, and phase 1's
//     send cycle picks that row up with every one of its gates applied. A
//     sequence that could send on its own would be a second sender against the
//     same outbox, which is how a recipient gets the same message twice — the
//     precise thing migration 156 removed the Vercel tick to prevent.
//   * THE WRITE IS NOT THIS FILE'S. It used to be: the claim handed back rows
//     and this file inserted one email_messages row per row, a second round
//     trip. That split the advance from the write across two transactions,
//     and the advance clears next_due_at — so any failure in between left an
//     enrollment advanced past a step that does not exist, never claimed
//     again, never completed, never sent to, and shown as "Active, nothing
//     scheduled", which is what a healthy in-flight enrollment looks like. One
//     timed-out response on the claim, AFTER PostgREST committed it, stranded
//     the whole batch over a single log line. The insert now lives inside
//     claim_sequence_enrollments(), in the same statement as the advance, and
//     this file counts what comes back.
//   * A FAILED CLAIM COSTS NOTHING. It is one transaction: either the
//     enrollments advanced and their messages exist, or neither happened and
//     the next pass takes the same set. There is no half state left to clean
//     up, which is why there is no per-row error handling here any more.
//   * `shouldStop` IS CHECKED BETWEEN CALLS, NEVER INSIDE ONE.
//   * Nothing logged or recorded from here may carry a recipient address, a
//     subject or a body. Errors are one line and name an enrollment id.

import type { SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------- types */

export interface SequenceDeps {
  db: SupabaseClient;
  now: () => Date;
  /**
   * True once the process has been asked to stop. Checked BETWEEN enrollments
   * only — see the rules above: an enrollment the claim advanced and this file
   * did not write a message for is a step that will never be sent.
   */
  shouldStop?: () => boolean;
}

export interface SequenceResult {
  /** Steps materialized into queued email_messages rows this pass. */
  queued: number;
  /**
   * Enrollments the reconcile sweep stopped this pass — each one an enrollment
   * that was stranded active with nothing left that could ever move it. A
   * non-zero count is not routine: it means one of the paths described on
   * `reconcile` below fired, so the worker logs it.
   */
  reconciled: number;
  /** Distinct failure reasons, each naming the enrollment that produced it. */
  errors: string[];
}

/**
 * One row of claim_sequence_enrollments() (migration 159), which is the
 * authority on this shape: the enrollment it advanced, the message it wrote
 * for it, and which step that was.
 *
 * It is a receipt, not an instruction. Everything needed to build the message
 * — the recipient, the merge data, the campaign carrying the wording, the
 * pinned mailbox — stayed inside the function, because the row it describes
 * already exists by the time this arrives.
 */
interface QueuedStep {
  enrollment_id: string;
  message_id: string;
  step_index: number;
}

/**
 * How many enrollments one pass takes. Fifty a minute per worker is far more
 * than the send cycle can drain at any realistic warmup limit, and the point
 * of the cap is that one transaction stays short: it holds a row lock on every
 * enrollment it is advancing, and a long one would block a second worker and a
 * hand-run query alike.
 */
const CLAIM_LIMIT = 50;

const short = (err: unknown): string =>
  String((err as { message?: string } | null)?.message ?? err)
    .replace(/\s+/g, ' ')
    .slice(0, 500);

const stopped = (deps: SequenceDeps): boolean => deps.shouldStop?.() === true;

type Note = (scope: string, message: string) => void;

/* ------------------------------------------------------------------- cycle */

export async function runSequenceCycle(deps: SequenceDeps): Promise<SequenceResult> {
  const result: SequenceResult = { queued: 0, reconciled: 0, errors: [] };

  // Deduplicated per scope, as in the inbox and send cycles: one database
  // problem is one problem however many rows it is hit on. The scope is the
  // enrollment id, so two enrollments failing the same way are still two
  // lines — which is the point, because each is a step that was lost.
  const seen = new Set<string>();
  const note: Note = (scope, message) => {
    const line = `${scope}: ${message}`;
    if (seen.has(line)) return;
    seen.add(line);
    result.errors.push(line);
  };

  // FIRST, and every pass. See `reconcile` for what it is under.
  result.reconciled = await reconcile(deps, note);

  // Nothing is claimed while the process is shutting down. There is no harm in
  // it — the claim is one transaction and would either complete or not — but a
  // batch of mail queued in the last second before exit sits until the next
  // process starts, and it costs nothing to not do it.
  if (stopped(deps)) return result;

  const claimed = await claim(deps, note);
  // A failed claim is reported by `claim` and there is nothing else to do this
  // pass. Nothing is half done: the advance and the message are one statement,
  // so either both happened or neither did, and the next pass takes the same
  // set with their due dates untouched.
  if (claimed === null) return result;

  result.queued = claimed.length;
  return result;
}

/**
 * The net under the whole cycle: reconcile_stalled_enrollments() (migration
 * 159, section f), run once per pass, BEFORE the claim.
 *
 * The bug it is under: the claim advances current_step and clears next_due_at
 * in one statement, and the claim takes nothing with a null due date. From
 * that instant the only thing that can move an enrollment again is its message
 * reaching a terminal state. Any path that ends a message without ending or
 * rescheduling its enrollment leaves that person stopped for ever while every
 * screen reports them active — and at least one such path is not fixable where
 * the others were, because claim_email_batch() marks a message 'suppressed'
 * nowhere near record_send_result().
 *
 * Before the claim, not after, so an enrollment this sweep resolves is in its
 * final state by the time the same pass looks for work rather than a minute
 * later.
 *
 * A failure here is reported and stepped past — never fatal. The sweep is a
 * net, not a gate: a database blip on it must not stop the product
 * materializing mail for a minute, and the stall it would have fixed is still
 * there, unchanged, on the next pass.
 */
async function reconcile(deps: SequenceDeps, note: Note): Promise<number> {
  try {
    const { data, error } = await deps.db.rpc('reconcile_stalled_enrollments');
    if (error) {
      note('reconcile', `stalled enrollments could not be reconciled: ${error.message}`);
      return 0;
    }
    // The function returns the row count it fixed. Coerced rather than trusted:
    // PostgREST hands back a scalar as JSON and a null here must read as zero,
    // never as NaN in a log line.
    const fixed = Number(data ?? 0);
    return Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
  } catch (err) {
    // postgrest-js answers with `{ error }` rather than rejecting, but only
    // until someone sets throwOnError() or the fetch itself fails.
    note('reconcile', `stalled enrollments could not be reconciled: ${short(err)}`);
    return 0;
  }
}

/**
 * The due enrollments, one step each, already advanced by the time they get
 * here.
 *
 * Returns null when the claim itself failed, which is different from an empty
 * batch: nothing was taken, so there is nothing to write and nothing to
 * report beyond the one error line.
 */
async function claim(deps: SequenceDeps, note: Note): Promise<QueuedStep[] | null> {
  try {
    const { data, error } = await deps.db.rpc('claim_sequence_enrollments', {
      p_limit: CLAIM_LIMIT,
    });
    if (error) {
      note('sequences', `due enrollments could not be claimed: ${error.message}`);
      return null;
    }
    return (data ?? []) as unknown as QueuedStep[];
  } catch (err) {
    note('sequences', `due enrollments could not be claimed: ${short(err)}`);
    return null;
  }
}

