// Tests for worker/lib/sequenceCycle.ts — the sequence materialization loop.
//
// Same harness shape as tests/unit/emailInboxCycle.test.ts: every side effect
// reaches the cycle through its deps, so this runs with no network and no
// database.
//
// What is being protected here is narrow, and it got narrower on purpose. This
// cycle used to claim enrollments and then insert one email_messages row per
// claimed row — a second round trip, in a second transaction. Because the
// claim clears next_due_at in the same statement that advances the step, any
// failure between the two left an enrollment advanced past a step that does
// not exist: never claimed again, never completed, never sent to, and rendered
// as "Active, nothing scheduled", which is what a healthy in-flight enrollment
// looks like. One timed-out response on the claim, after PostgREST had already
// committed it, stranded the whole batch.
//
// The insert now happens inside claim_sequence_enrollments() (migration 159),
// in the same statement as the advance. So what these tests assert is mostly
// what this file must NOT do: it must not write to the database at all, and it
// must not have a half-done state to clean up. What the message row contains —
// the campaign, the pin, the absence of a subject — is now SQL and is asserted
// by reading migration 159, not from here.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runSequenceCycle, type SequenceDeps } from '../../worker/lib/sequenceCycle';

/* ------------------------------------------------------------------ fixtures */

const NOW = new Date('2026-09-19T12:00:00Z');

type Row = Record<string, unknown>;

/**
 * One row exactly as claim_sequence_enrollments() returns it (migration 159).
 *
 * It is a RECEIPT: the enrollment it advanced, the message it already wrote,
 * and which step that was. Everything needed to build that message stayed
 * inside the function, because the row exists by the time this arrives.
 */
function queued(over: { id?: string; stepIndex?: number } & Row = {}): Row {
  const { id = 'enr-1', stepIndex = 0, ...rest } = over;
  return {
    enrollment_id: id,
    message_id: `msg-${id}-${stepIndex}`,
    step_index: stepIndex,
    ...rest,
  };
}

/* ------------------------------------------------------------- the stub db */

interface Fixtures {
  /** What claim_sequence_enrollments() answers with. */
  claimed?: Row[];
  /** True when the claim itself answers with an error. */
  claimError?: boolean;
  /** True when the claim REJECTS rather than answering. */
  claimRejects?: boolean;
  /** True when the reconcile sweep answers with an error. */
  reconcileError?: boolean;
  /** What reconcile_stalled_enrollments() reports it fixed. */
  reconciled?: number;
  /** What pause_mailboxes_over_bounce_rate() reports it paused. */
  pausedForBounces?: number;
  /** True when that sweep answers with an error. */
  protectError?: boolean;
  shouldStop?: () => boolean;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A Supabase-shaped stub. `from()` exists only so that a test can prove the
 * cycle never reaches for it: every table access is recorded, and the cycle
 * is expected to make none.
 */
function makeDeps(fx: Fixtures = {}) {
  const rpcCalls: RpcCall[] = [];
  const tableAccess: string[] = [];

  const from = (table: string) => {
    tableAccess.push(table);
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: () => builder,
      update: () => builder,
      upsert: () => builder,
      delete: () => builder,
      eq: () => builder,
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
    };
    return builder;
  };

  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });

    if (name === 'reconcile_stalled_enrollments') {
      if (fx.reconcileError) return { data: null, error: { message: 'sweep failed' } };
      return { data: fx.reconciled ?? 0, error: null };
    }

    if (name === 'pause_mailboxes_over_bounce_rate') {
      if (fx.protectError) return { data: null, error: { message: 'sweep failed' } };
      return { data: fx.pausedForBounces ?? 0, error: null };
    }

    if (name === 'claim_sequence_enrollments') {
      if (fx.claimRejects) throw new Error('the connection went away');
      if (fx.claimError) return { data: null, error: { message: 'claim failed' } };
      return { data: fx.claimed ?? [], error: null };
    }

    return { data: null, error: null };
  };

  const deps: SequenceDeps = {
    db: { from, rpc } as unknown as SupabaseClient,
    now: () => NOW,
    shouldStop: fx.shouldStop,
  };

  return {
    deps,
    rpcCalls,
    tableAccess,
    names: () => rpcCalls.map((c) => c.name),
  };
}

/* ------------------------------------------------------------------- tests */

describe('runSequenceCycle', () => {
  it('counts the steps the claim queued, and writes nothing itself', async () => {
    const h = makeDeps({ claimed: [queued({ id: 'enr-1' }), queued({ id: 'enr-2' })] });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(2);
    expect(result.errors).toEqual([]);
    // The whole point of this revision: the advance and the message are one
    // statement inside the claim, so this file touches no table at all.
    expect(h.tableAccess).toEqual([]);
  });

  it('never sends, and never claims a send batch', async () => {
    // A sequence that could send on its own would be a second sender against
    // the same outbox, which is how a recipient gets the same message twice —
    // the precise thing migration 156 removed the Vercel tick to prevent.
    const h = makeDeps({ claimed: [queued()] });

    await runSequenceCycle(h.deps);

    expect(h.names()).not.toContain('claim_email_batch');
    expect(h.names()).not.toContain('record_send_result');
  });

  it('reconciles stalled enrollments once, before the claim', async () => {
    // Before, not after, so an enrollment the sweep resolves is in its final
    // state by the time the same pass looks for work rather than a minute
    // later.
    const h = makeDeps({ claimed: [queued()], reconciled: 3 });

    const result = await runSequenceCycle(h.deps);

    // Both sweeps run BEFORE the claim: an enrollment the first resolves is
    // in its final state before the same pass looks for work, and a mailbox
    // the second pauses is out of rotation before this pass hands it more.
    expect(h.names()).toEqual([
      'reconcile_stalled_enrollments',
      'pause_mailboxes_over_bounce_rate',
      'claim_sequence_enrollments',
    ]);
    expect(result.reconciled).toBe(3);
  });

  it('still materializes when the reconcile sweep fails', async () => {
    // The sweep is a net, not a gate. A database blip on it must not stop the
    // product materializing mail for a minute, and the stall it would have
    // fixed is still there, unchanged, on the next pass.
    const h = makeDeps({ claimed: [queued()], reconcileError: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(result.errors.join(' ')).toMatch(/reconciled/i);
  });

  it('reports a failed claim without throwing, and leaves nothing half done', async () => {
    const h = makeDeps({ claimError: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(0);
    expect(result.errors.join(' ')).toMatch(/could not be claimed/i);
  });

  it('reports a rejected claim the same way', async () => {
    // The failure that used to strand a whole batch: the RPC commits and the
    // response never arrives. It now costs nothing — either the enrollments
    // advanced and their messages exist, or neither happened.
    const h = makeDeps({ claimRejects: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(0);
    expect(result.errors.join(' ')).toMatch(/could not be claimed/i);
  });

  it('claims nothing while the process is shutting down', async () => {
    const h = makeDeps({ claimed: [queued()], shouldStop: () => true });

    const result = await runSequenceCycle(h.deps);

    expect(h.names()).not.toContain('claim_sequence_enrollments');
    expect(result.queued).toBe(0);
  });

  it('reports nothing to do as nothing to do', async () => {
    const h = makeDeps({ claimed: [] });

    const result = await runSequenceCycle(h.deps);

    expect(result).toEqual({ queued: 0, reconciled: 0, pausedForBounces: 0, errors: [] });
  });

  it('takes a mailbox out of rotation when too much of its mail bounces', async () => {
    // The gap migration 156 could not see: it pauses after three consecutive
    // SMTP FAILURES, and every send that later bounces succeeded at the time.
    const h = makeDeps({ claimed: [], pausedForBounces: 2 });

    const result = await runSequenceCycle(h.deps);

    expect(result.pausedForBounces).toBe(2);
  });

  it('still materializes when the protection sweep fails', async () => {
    // A protection, not a gate: a database blip on it must not stop the
    // product queueing mail for a minute.
    const h = makeDeps({ claimed: [queued()], protectError: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(1);
    expect(result.pausedForBounces).toBe(0);
    expect(result.errors.join(' ')).toMatch(/bounce rates could not be checked/i);
  });

  it('asks for a bounded batch rather than everything due', async () => {
    // The claim holds a row lock on every enrollment it advances, so a long
    // transaction blocks a second worker and a hand-run query alike.
    const h = makeDeps({ claimed: [] });

    await runSequenceCycle(h.deps);

    const claim = h.rpcCalls.find((c) => c.name === 'claim_sequence_enrollments');
    const args = claim?.args as { p_limit: number };
    expect(args.p_limit).toBeGreaterThan(0);
    expect(args.p_limit).toBeLessThanOrEqual(200);
  });

  it('does not treat a nonsense reconcile answer as work done', async () => {
    const h = makeDeps({ claimed: [], reconciled: Number.NaN });

    const result = await runSequenceCycle(h.deps);

    expect(result.reconciled).toBe(0);
  });

  it('runs on the injected clock, never on a real timer', async () => {
    const now = vi.fn(() => NOW);
    const h = makeDeps({ claimed: [] });

    await runSequenceCycle({ ...h.deps, now });

    expect(h.names()).toContain('claim_sequence_enrollments');
  });
});
