// The sequence cycle: one pass that turns due enrollments into queued mail.
//
// This is the materializer, and it is deliberately the smallest of the three
// loops. A sequence step is an ORDINARY email_messages row: the mailbox pool,
// the daily and hourly caps, the warmup ramp, the send window, the suppression
// list and the retry budget all belong to claim_email_batch() and engine.ts,
// and none of them are reimplemented or second-guessed here. What this file
// does is exactly two things per pass — run the reconcile sweep, then turn
// each row claim_sequence_enrollments() hands back into one queued message.
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
//   * NO SUBJECT AND NO BODY. email_messages has neither column (migration
//     152): the step's hidden email_campaigns row carries the wording and
//     engine.ts already reads it from there for every message it sends.
//     Writing one here would give a message two places to disagree about its
//     own wording, and the claim returns neither for the same reason.
//   * ONE ENROLLMENT CANNOT END THE CYCLE. Each runs in its own try/catch and
//     a failure is recorded and stepped past — the next enrollment is somebody
//     else's tenant, and the claim has already advanced all of them, so an
//     early return would strand every enrollment ordered after the bad one.
//   * A FAILED INSERT IS LOUD. The claim advanced current_step before this
//     file ever saw the row, so a step that fails to insert is a step nobody
//     will ever send: nothing re-offers it, because next_due_at was cleared in
//     that same statement. It goes into `errors` naming the enrollment id —
//     never the address, never a body, never a subject — and the reconcile
//     sweep below is what eventually stops the enrollment rather than leaving
//     it active for ever.
//   * `shouldStop` IS CHECKED BETWEEN ENROLLMENTS, NEVER INSIDE ONE. One
//     enrollment is the unit of work, for the same reason: a claimed
//     enrollment whose message was not written is a step that is simply gone.
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
 * authority on this shape.
 *
 * There is no subject and no body here on purpose — see the rules at the top.
 *
 * `account_id` and `last_message_id` come back and are deliberately NOT
 * written to the message: email_messages has no column for either. The pinned
 * mailbox lives on the step's campaign, and the thread is rebuilt from the
 * enrollment's own message rows when the send path builds the headers. They
 * are typed here because the claim returns them and a reader of this file
 * should not have to open the SQL to find out why they are unused.
 */
interface ClaimedEnrollment {
  enrollment_id: string;
  sequence_id: string;
  organization_id: string;
  contact_id: string | null;
  step_id: string;
  step_index: number;
  campaign_id: string;
  account_id: string | null;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  last_message_id: string | null;
}

/**
 * How many enrollments one pass takes. Fifty a minute per worker is far more
 * than the send cycle can drain at any realistic warmup limit, and the point
 * of the cap is that a pass stays short: a cycle that claimed thousands would
 * hold its rows advanced-but-unwritten for as long as it took to insert them
 * all, and a crash in the middle of that is exactly the stall the sweep exists
 * to clean up after.
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

  const claimed = await claim(deps, note);
  // A failed claim is reported by `claim` and there is nothing else to do this
  // pass. The enrollments keep their due dates — the claim either advanced
  // them or it did not — so the next pass takes exactly the same set.
  if (claimed === null) return result;

  for (const row of claimed) {
    // Checked before the enrollment, so a stop never lands between the claim's
    // advance and the message that advance was for.
    if (stopped(deps)) return result;

    // One tenant's failed insert is one tenant's problem. Without this, the
    // first throw ends the pass for every enrollment ordered after it — and
    // all of them have already been advanced, so every one of those steps
    // would be lost, not merely delayed.
    try {
      const wrote = await queueStep(deps, note, row);
      if (wrote) result.queued += 1;
    } catch (err) {
      note(`enrollment ${row.enrollment_id}`, `this step could not be queued: ${short(err)}`);
    }
  }

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
async function claim(deps: SequenceDeps, note: Note): Promise<ClaimedEnrollment[] | null> {
  try {
    const { data, error } = await deps.db.rpc('claim_sequence_enrollments', {
      p_limit: CLAIM_LIMIT,
    });
    if (error) {
      note('sequences', `due enrollments could not be claimed: ${error.message}`);
      return null;
    }
    return (data ?? []) as unknown as ClaimedEnrollment[];
  } catch (err) {
    note('sequences', `due enrollments could not be claimed: ${short(err)}`);
    return null;
  }
}

/**
 * One claimed step, written as one ordinary queued message.
 *
 * Returns whether the row reached the database. A false is already in
 * `errors`, and it is the loudest thing this file can say: the claim advanced
 * this enrollment before handing it over, so this step will not be offered
 * again by anything.
 */
async function queueStep(
  deps: SequenceDeps,
  note: Note,
  row: ClaimedEnrollment,
): Promise<boolean> {
  const { error } = await deps.db.from('email_messages').insert({
    // The step's hidden campaign. It is what carries the subject and the body,
    // and the claim refuses to hand over a step that has not got one.
    campaign_id: row.campaign_id,
    organization_id: row.organization_id,
    contact_id: row.contact_id,
    // The two columns migration 158 added, and the only thing that makes this
    // an ordinary message with a sequence behind it: record_send_result()
    // reads them to schedule the next step without a three-table lookup inside
    // the statement every send runs through.
    enrollment_id: row.enrollment_id,
    step_index: row.step_index,
    to_email: row.to_email,
    to_name: row.to_name,
    merge_data: row.merge_data,
    // The mailbox this step must go through, or null for "any pool member".
    //
    // Null on the first step of an enrollment, which is how it starts a thread
    // from whichever mailbox the pool had free; record_send_result() stamps
    // the enrollment's account_id from that send, and every later step is
    // claimed here carrying it. Without this the follow-up leaves from a
    // different address than the message it is replying to, which breaks the
    // recipient's own threading and reads as a second stranger.
    //
    // It cannot live on the campaign: a step's hidden campaign is shared by
    // every enrollment at that step, so pinning it there would route all of
    // them through one mailbox and undo the pool for sequences. See migrations
    // 158d and 160.
    pinned_account_id: row.account_id,
    // 'queued' and nothing else. Every gate that decides whether this may
    // actually go out is applied later, by claim_email_batch().
    status: 'queued',
    // Due immediately. Not "when the window opens" and not "now plus a delay":
    // the delay between steps was already spent waiting for next_due_at, and
    // the send window is claim_email_batch()'s to hold the row for. Deciding
    // it twice is how a three-day sequence drifts into a week.
    send_after: deps.now().toISOString(),
  });

  if (!error) return true;

  // `error.message` only, never `details` or `hint`: a constraint violation's
  // detail carries the values of the row, which here is the recipient's
  // address. The enrollment id is what an operator needs, and it is enough to
  // find everything else.
  note(
    `enrollment ${row.enrollment_id}`,
    `step ${row.step_index} could not be queued, so it will not be sent: ${error.message}`,
  );
  return false;
}
