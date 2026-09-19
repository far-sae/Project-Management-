// Tests for worker/lib/sequenceCycle.ts — the sequence materialization loop.
//
// Same harness shape as tests/unit/emailInboxCycle.test.ts: every side effect
// reaches the cycle through its deps, so this runs with no network and no
// database. The assertions are on what was RECORDED — which RPCs were called,
// in what order, and what row was written to email_messages — rather than on
// what the stubs returned, because the returns are this file's own fixtures.
//
// What is being protected here is narrow and specific: this cycle turns a
// claimed enrollment into ONE queued email_messages row and does nothing else.
// It never sends, it never claims a send batch, and it never writes a subject
// or a body — email_messages has neither column, and the step's hidden
// campaign is where engine.ts reads the wording from.

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runSequenceCycle, type SequenceDeps } from '../../worker/lib/sequenceCycle';

/* ------------------------------------------------------------------ fixtures */

const NOW = new Date('2026-09-19T12:00:00Z');

type Row = Record<string, unknown>;

/**
 * One row exactly as claim_sequence_enrollments() returns it (migration 159):
 * no subject and no body, because neither exists on email_messages.
 */
function enrollment(over: { id?: string; stepIndex?: number } & Row = {}): Row {
  const { id = 'enr-1', stepIndex = 0, ...rest } = over;
  return {
    enrollment_id: id,
    sequence_id: 'seq-1',
    organization_id: 'org-1',
    contact_id: 'con-1',
    step_id: `step-${stepIndex}`,
    step_index: stepIndex,
    campaign_id: `camp-step-${stepIndex}`,
    account_id: 'mbx-1',
    to_email: 'ada@acme.com',
    to_name: 'Ada',
    merge_data: { first_name: 'Ada' },
    last_message_id: null,
    ...rest,
  };
}

/* ------------------------------------------------------------- the stub db */

interface Fixtures {
  /** What claim_sequence_enrollments() answers with. */
  claimed?: Row[];
  /** How many leading inserts into email_messages answer with an error. */
  insertErrors?: number;
  /** True when the claim itself answers with an error. */
  claimError?: boolean;
  /** True when the reconcile sweep answers with an error. */
  reconcileError?: boolean;
  /** What reconcile_stalled_enrollments() reports it fixed. */
  reconciled?: number;
  shouldStop?: () => boolean;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A Supabase-shaped stub supporting only the chain the cycle actually uses.
 * Every insert records the table and the row, so a test can assert both that
 * exactly one message was written AND that nothing was written anywhere else.
 */
function makeDeps(fx: Fixtures = {}) {
  const rpcCalls: RpcCall[] = [];
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const writes: Array<{ table: string; op: string }> = [];

  let claimed: Row[] = fx.claimed ?? [];
  let insertCalls = 0;

  const from = (table: string) => {
    const write = (op: string, rows?: Row | Row[]) => {
      writes.push({ table, op });
      if (op === 'insert') {
        insertCalls += 1;
        const batch = Array.isArray(rows) ? rows : rows ? [rows] : [];
        // Recorded even when the insert is about to fail: the assertion that
        // matters for a failed insert is that the cycle carried on, and the
        // row it tried to write is what proves which enrollment was lost.
        if (insertCalls > (fx.insertErrors ?? 0)) inserts.push({ table, rows: batch });
      }
      return builder;
    };

    const failing = (): boolean => insertCalls <= (fx.insertErrors ?? 0);

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (rows: Row | Row[]) => write('insert', rows),
      update: () => write('update'),
      upsert: () => write('upsert'),
      delete: () => write('delete'),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(
          failing()
            ? { data: null, error: { message: `could not write ${table}` } }
            : { data: null, error: null },
        ).then(ok, bad),
    };
    return builder;
  };

  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });
    if (name === 'claim_sequence_enrollments') {
      return fx.claimError
        ? { data: null, error: { message: 'could not claim enrollments' } }
        : { data: claimed, error: null };
    }
    if (name === 'reconcile_stalled_enrollments') {
      return fx.reconcileError
        ? { data: null, error: { message: 'could not reconcile' } }
        : { data: fx.reconciled ?? 0, error: null };
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
    writes,
    names: () => rpcCalls.map((c) => c.name),
    /** The rows successfully written to a table this cycle. */
    inserted: (table: string): Row[] =>
      inserts.filter((i) => i.table === table).flatMap((i) => i.rows),
    /** Change what the next claim answers with, to drive a second pass. */
    claimReturns: (rows: Row[]) => {
      claimed = rows;
    },
  };
}

/* ------------------------------------------------------------------- tests */

describe('runSequenceCycle', () => {
  it('queues exactly one message per due enrollment', async () => {
    const h = makeDeps({ claimed: [enrollment({ stepIndex: 0 })] });

    const result = await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages')).toHaveLength(1);
    expect(h.inserted('email_messages')[0]).toMatchObject({
      campaign_id: 'camp-step-0',
      enrollment_id: 'enr-1',
      step_index: 0,
      to_email: 'ada@acme.com',
      status: 'queued',
    });
    expect(result.queued).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('writes no subject and no body, and never claims a send batch', async () => {
    // email_messages has neither column (migration 152); the step's hidden
    // campaign carries the wording and engine.ts reads it from there. Writing
    // one here would give a message two places to disagree about itself.
    //
    // And this loop never sends: it writes a queued row and stops, so the
    // pool, the caps, the warmup, the window and the suppression list are all
    // applied afterwards by phase 1's send cycle on the row it produced.
    const h = makeDeps({ claimed: [enrollment()] });

    await runSequenceCycle(h.deps);

    const row = h.inserted('email_messages')[0];
    expect(row).not.toHaveProperty('subject');
    expect(row).not.toHaveProperty('body_html');
    expect(row.send_after).toBe(NOW.toISOString());
    expect(h.names()).not.toContain('claim_email_batch');
    expect(h.names()).not.toContain('record_send_result');
    // The one table this cycle writes to.
    expect(h.writes.map((w) => `${w.table}.${w.op}`)).toEqual(['email_messages.insert']);
  });

  it('reconciles stalled enrollments once, before the claim', async () => {
    // The claim advances current_step and clears next_due_at in one statement,
    // and it takes nothing with a null due date — so any path that ends a
    // message without ending or rescheduling its enrollment strands that
    // person for ever while every screen reports them active. The sweep is the
    // net under that, and it runs first so a stall fixed this pass can be
    // claimed on the next one rather than waiting a whole extra cycle.
    const h = makeDeps({ claimed: [enrollment()], reconciled: 2 });

    const result = await runSequenceCycle(h.deps);

    expect(h.names()).toEqual(['reconcile_stalled_enrollments', 'claim_sequence_enrollments']);
    expect(result.reconciled).toBe(2);
    expect(result.queued).toBe(1);
  });

  it('still materializes when the reconcile sweep fails', async () => {
    // The sweep is a net, not a gate. A database blip on it must not stop the
    // whole product sending for a minute; the stall it would have fixed is
    // still there next pass.
    const h = makeDeps({ claimed: [enrollment()], reconcileError: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(1);
    expect(result.reconciled).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('does not queue twice for an enrollment the claim already advanced', async () => {
    // The claim advances current_step in the same statement that returns the
    // row, so a second cycle over the same data claims nothing. This asserts
    // the cycle adds no second path of its own.
    const h = makeDeps({ claimed: [enrollment({ stepIndex: 0 })] });

    await runSequenceCycle(h.deps);
    h.claimReturns([]);
    await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages')).toHaveLength(1);
  });

  it('records a failed insert without losing the enrollment', async () => {
    // The claim has already advanced the enrollment, so a failed insert means
    // that step will never be sent. It must be loud, and it must not take the
    // rest of the batch down with it.
    const h = makeDeps({
      claimed: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      insertErrors: 1,
    });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/enr-1/);
    // Named by enrollment, never by address: the error line is logged, and an
    // operator does not need the recipient to find the row.
    expect(result.errors[0]).not.toMatch(/ada@acme\.com/);
  });

  it('records a rejected insert promise the same way', async () => {
    // postgrest-js answers with `{ error }` rather than rejecting — until
    // someone sets throwOnError() or the fetch itself fails. A rejection must
    // not escape the per-enrollment catch and end the pass for other tenants.
    const db = {
      from: () => ({
        insert: () => ({
          then: (_ok: unknown, bad: (e: unknown) => unknown) =>
            Promise.reject(new Error('socket hang up')).catch(bad),
        }),
      }),
      rpc: vi.fn(async (name: string) =>
        name === 'claim_sequence_enrollments'
          ? { data: [enrollment({ id: 'enr-7' })], error: null }
          : { data: 0, error: null },
      ),
    };

    const result = await runSequenceCycle({
      db: db as unknown as SupabaseClient,
      now: () => NOW,
    });

    expect(result.queued).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/enr-7/);
  });

  it('reports a failed claim without throwing', async () => {
    const h = makeDeps({ claimError: true });

    const result = await runSequenceCycle(h.deps);

    expect(result.queued).toBe(0);
    expect(h.inserted('email_messages')).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('stops between enrollments when the process is shutting down', async () => {
    const h = makeDeps({
      claimed: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      shouldStop: () => true,
    });

    await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages').length).toBeLessThan(2);
  });

  it('finishes the enrollment it started before stopping', async () => {
    // shouldStop is read BETWEEN enrollments, never inside one: a claimed
    // enrollment whose message was not written is a step nothing will ever
    // send again, so the unit of work is one whole enrollment.
    let inserted = 0;
    const h = makeDeps({
      claimed: [enrollment({ id: 'enr-1' }), enrollment({ id: 'enr-2' })],
      shouldStop: () => inserted >= 1,
    });
    const realFrom = h.deps.db.from.bind(h.deps.db);
    h.deps.db.from = ((table: string) => {
      const builder = realFrom(table) as unknown as Record<string, unknown>;
      const insert = builder.insert as (rows: unknown) => unknown;
      builder.insert = (rows: unknown) => {
        inserted += 1;
        return insert(rows);
      };
      return builder;
    }) as SupabaseClient['from'];

    const result = await runSequenceCycle(h.deps);

    expect(h.inserted('email_messages')).toHaveLength(1);
    expect(result.queued).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
