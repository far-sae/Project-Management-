// Tests for worker/lib/engine.ts — the send cycle.
//
// Every side effect the cycle has reaches it through `CycleDeps`, so the whole
// thing runs here with stubs: no Supabase client, no DNS resolver, no SMTP
// socket, no timers. The assertions are on the calls that were *recorded* —
// which mailbox was claimed for, with what budget, and how each message was
// settled — rather than on what the stubs returned, because the returns are
// this file's own fixtures and asserting them would prove nothing.
//
// The encryption is real: the fake `email_account_secrets` rows hold genuine
// ciphertext from src/lib/email/crypto, so the decrypt path in the worker is
// exercised rather than mocked away, and the "secret will not decrypt" case is
// a genuinely undecryptable value rather than a thrown stub.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transporter } from 'nodemailer';

import { encryptSecret } from '@/lib/email/crypto';
import { runCycle, type CycleDeps } from '../../worker/lib/engine';

/* ------------------------------------------------------------------ fixtures */

// A real 32-byte base64url key, so encryptSecret/decryptSecret both work.
const KEY = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc';

// Wednesday 2026-09-16, 10:00 UTC — inside the default 08:00–18:00 Mon–Fri
// window; and 03:00 the same day, which is outside it.
const INSIDE = new Date('2026-09-16T10:00:00Z');
const OUTSIDE = new Date('2026-09-16T03:00:00Z');

type Row = Record<string, unknown>;

let CIPHERTEXT = '';
beforeAll(async () => {
  CIPHERTEXT = await encryptSecret('app-specific-password', KEY);
});

function mailboxRow(over: Row = {}): Row {
  return {
    id: 'mbx-1',
    organization_id: 'org-1',
    label: 'Ada',
    from_email: 'ada@example.com',
    status: 'active',
    is_active: true,
    paused_reason: null,
    consecutive_failures: 0,
    last_sent_at: '2026-09-15T09:00:00Z',
    daily_limit: 40,
    warmup_enabled: false,
    warmup_started_on: null,
    warmup_start_volume: 5,
    warmup_increment: 3,
    effective_limit: 40,
    sent_today: 0,
    ...over,
  };
}

function accountRow(over: Row = {}): Row {
  return {
    id: 'mbx-1',
    organization_id: 'org-1',
    label: 'Ada',
    from_name: 'Ada Lovelace',
    from_email: 'ada@example.com',
    reply_to: null,
    smtp_host: 'smtp.example.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_username: 'ada@example.com',
    ...over,
  };
}

function campaignRow(over: Row = {}): Row {
  return {
    id: 'camp-1',
    organization_id: 'org-1',
    kind: 'bulk',
    subject: 'Hello {{first_name}}',
    body_html: '<p>Hi {{first_name}}</p>',
    ...over,
  };
}

function claimedRow(n: number, over: Row = {}): Row {
  return {
    message_id: `msg-${n}`,
    campaign_id: 'camp-1',
    organization_id: 'org-1',
    to_email: `person${n}@recipient.test`,
    to_name: `Person ${n}`,
    merge_data: { first_name: `Person ${n}` },
    attempts: 1,
    ...over,
  };
}

/** An SMTP rejection as nodemailer surfaces one: a numeric `responseCode`. */
function smtpError(responseCode: number, message = 'server said no'): Error {
  return Object.assign(new Error(message), { responseCode });
}

/* ------------------------------------------------------------- the stub db */

interface Fixtures {
  settings?: Row[];
  mailboxes?: Row[];
  accounts?: Row[];
  secrets?: Row[];
  campaigns?: Row[];
  /** account id -> the rows claim_email_batch hands back for that mailbox. */
  claims?: Record<string, Row[]>;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A Supabase-shaped stub. `from(...)` supports only the chain the engine
 * actually uses (select / eq / in / single, and awaiting the builder), and
 * every write verb records itself so a test can assert the engine wrote
 * nothing — `email_settings` in particular, which the worker must never
 * create a row in.
 */
function makeDb(fx: Fixtures) {
  const tables: Record<string, Row[]> = {
    email_settings: fx.settings ?? [],
    mailbox_status: fx.mailboxes ?? [],
    email_accounts: fx.accounts ?? [],
    email_account_secrets: fx.secrets ?? [],
    email_campaigns: fx.campaigns ?? [],
  };

  const rpcCalls: RpcCall[] = [];
  const reads: string[] = [];
  const writes: Array<{ table: string; op: string }> = [];

  const from = (table: string) => {
    reads.push(table);
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const write = (op: string) => {
      writes.push({ table, op });
      return builder;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      insert: () => write('insert'),
      update: () => write('update'),
      upsert: () => write('upsert'),
      delete: () => write('delete'),
      single: async () => {
        const found = rows();
        return found.length > 0
          ? { data: found[0], error: null }
          : { data: null, error: { message: `no row in ${table}` } };
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return builder;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'claim_email_batch') {
      const account = String(args.p_account);
      const limit = Number(args.p_limit);
      return { data: (fx.claims?.[account] ?? []).slice(0, limit), error: null };
    }
    return { data: null, error: null };
  };

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    rpcCalls,
    reads,
    writes,
    claims: () => rpcCalls.filter((c) => c.name === 'claim_email_batch'),
    settlements: () => rpcCalls.filter((c) => c.name === 'record_send_result'),
  };
}

/* -------------------------------------------------------- the stub mailer */

function makeMailer(send: (opts: Record<string, unknown>) => Promise<{ messageId?: string }>) {
  const created: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  let closed = 0;

  const createTransport = (cfg: Record<string, unknown>) => {
    created.push(cfg);
    return {
      sendMail: async (opts: Record<string, unknown>) => {
        sent.push(opts);
        return send(opts);
      },
      close: () => {
        closed += 1;
      },
    } as unknown as Transporter;
  };

  return { createTransport, created, sent, closedCount: () => closed };
}

const okSend = async () => ({ messageId: '<generated@smtp.example.com>' });

function makeDeps(
  db: SupabaseClient,
  createTransport: (cfg: never) => Transporter,
  over: Partial<CycleDeps> = {},
): CycleDeps {
  return {
    db,
    createTransport: createTransport as CycleDeps['createTransport'],
    domainAcceptsMail: async () => true,
    sleep: vi.fn(async () => undefined),
    now: () => INSIDE,
    env: {
      tokenKey: KEY,
      unsubscribeSecret: 'unsubscribe-secret',
      siteUrl: 'https://tasks.example.com',
    },
    maxPerCycle: 25,
    ...over,
  };
}

/** The common "one healthy mailbox, one campaign, N claimed rows" world. */
function oneMailbox(rows: Row[], fx: Fixtures = {}) {
  return makeDb({
    mailboxes: [mailboxRow()],
    accounts: [accountRow()],
    secrets: [{ account_id: 'mbx-1', secret_encrypted: CIPHERTEXT }],
    campaigns: [campaignRow()],
    claims: { 'mbx-1': rows },
    ...fx,
  });
}

/* ------------------------------------------------------------------ tests */

describe('worker/lib/engine — the send window', () => {
  it('claims nothing outside the window and names the window in `blocked`', async () => {
    const stub = oneMailbox([claimedRow(1)]);
    const mailer = makeMailer(okSend);

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport, { now: () => OUTSIDE }));

    expect(stub.claims()).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
    expect(result.claimed).toBe(0);
    // The default window, because there is no email_settings row: 08:00-18:00,
    // Mon-Fri, UTC.
    expect(result.blocked).toContain('08:00');
    expect(result.blocked).toContain('18:00');
    expect(result.blocked).toContain('UTC');
    // A missing settings row means the column defaults, never a row the worker
    // writes for itself.
    expect(stub.writes).toEqual([]);
  });

  it('reads the organisation window when a settings row exists', async () => {
    const stub = oneMailbox([claimedRow(1)], {
      settings: [
        {
          organization_id: 'org-1',
          send_window_enabled: true,
          send_window_start: 9,
          send_window_end: 17,
          send_days: [1, 2, 3, 4, 5],
          send_timezone: 'Australia/Sydney',
          jitter_min_ms: 1000,
          jitter_max_ms: 2000,
        },
      ],
    });
    const mailer = makeMailer(okSend);

    // 10:00 UTC on a Wednesday is 20:00 in Sydney — inside the default window,
    // outside this organisation's.
    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(stub.claims()).toHaveLength(0);
    expect(result.blocked).toContain('Australia/Sydney');
  });
});

describe('worker/lib/engine — the mailbox pool', () => {
  it('claims nothing when the pool is empty and says so', async () => {
    const stub = makeDb({ mailboxes: [] });
    const mailer = makeMailer(okSend);

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(stub.claims()).toHaveLength(0);
    expect(result.claimed).toBe(0);
    expect(result.blocked).toMatch(/no mailboxes/i);
  });

  it('claims least-recently-used first, each with its own id and budget', async () => {
    const stub = makeDb({
      mailboxes: [
        // Deliberately out of order, and with different allowances left, so
        // neither the order nor the budgets can come from the input order.
        mailboxRow({
          id: 'mbx-recent',
          from_email: 'recent@example.com',
          last_sent_at: '2026-09-16T09:00:00Z',
          effective_limit: 8,
          sent_today: 3,
        }),
        mailboxRow({
          id: 'mbx-stale',
          from_email: 'stale@example.com',
          last_sent_at: '2026-09-10T09:00:00Z',
        }),
      ],
      accounts: [
        accountRow({ id: 'mbx-recent', from_email: 'recent@example.com' }),
        accountRow({ id: 'mbx-stale', from_email: 'stale@example.com' }),
      ],
      secrets: [
        { account_id: 'mbx-recent', secret_encrypted: CIPHERTEXT },
        { account_id: 'mbx-stale', secret_encrypted: CIPHERTEXT },
      ],
      campaigns: [campaignRow()],
      claims: {},
    });
    const mailer = makeMailer(okSend);

    await runCycle(makeDeps(stub.db, mailer.createTransport, { maxPerCycle: 15 }));

    expect(stub.claims().map((c) => c.args)).toEqual([
      // Least recently used first, capped at PER_MAILBOX_SLICE (10)...
      { p_account: 'mbx-stale', p_limit: 10 },
      // ...then what is left of the budget, capped at this mailbox's own
      // remaining allowance for today (8 - 3 = 5).
      { p_account: 'mbx-recent', p_limit: 5 },
    ]);
  });
});

describe('worker/lib/engine — settling a send', () => {
  it('records a resolved send once, as `sent`, with the provider message id', async () => {
    const stub = oneMailbox([claimedRow(1)]);
    const mailer = makeMailer(okSend);

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(mailer.sent).toHaveLength(1);
    // Exactly ONE settlement call per message: the status and the provider id
    // are written together, so a crash between two writes cannot strand the
    // row in 'sending'.
    expect(stub.settlements()).toEqual([
      {
        name: 'record_send_result',
        args: {
          p_message: 'msg-1',
          p_account: 'mbx-1',
          p_outcome: 'sent',
          p_error: null,
          p_provider_message_id: '<generated@smtp.example.com>',
        },
      },
    ]);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.claimed).toBe(1);
  });

  it('skips a recipient whose domain cannot receive mail and records a hard bounce', async () => {
    const stub = oneMailbox([claimedRow(1)]);
    const mailer = makeMailer(okSend);

    const result = await runCycle(
      makeDeps(stub.db, mailer.createTransport, { domainAcceptsMail: async () => false }),
    );

    // Never handed to SMTP: the point of the check is to not spend a send on
    // an address that can only bounce.
    expect(mailer.sent).toHaveLength(0);
    expect(stub.settlements()).toHaveLength(1);
    expect(stub.settlements()[0].args.p_outcome).toBe('hard_bounce');
    expect(stub.settlements()[0].args.p_message).toBe('msg-1');
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('records a 535 as `permanent`', async () => {
    const stub = oneMailbox([claimedRow(1)]);
    const mailer = makeMailer(async () => {
      throw smtpError(535, 'authentication failed');
    });

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(stub.settlements()[0].args.p_outcome).toBe('permanent');
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('records a 550 as `hard_bounce`', async () => {
    const stub = oneMailbox([claimedRow(1)]);
    const mailer = makeMailer(async () => {
      throw smtpError(550, 'no such mailbox');
    });

    await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(stub.settlements()[0].args.p_outcome).toBe('hard_bounce');
  });

  it('records a 451 as `transient`, and reports one error for two identical failures', async () => {
    const stub = oneMailbox([claimedRow(1), claimedRow(2)]);
    const mailer = makeMailer(async () => {
      throw smtpError(451, 'try again later');
    });

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    expect(stub.settlements().map((c) => c.args.p_outcome)).toEqual(['transient', 'transient']);
    expect(result.failed).toBe(2);
    // Deduplicated per mailbox: one throttled mailbox is one problem, not one
    // problem per recipient.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/throttling/i);
  });

  it('only ever passes an outcome record_send_result understands', async () => {
    const stub = oneMailbox([claimedRow(1), claimedRow(2), claimedRow(3)]);
    let n = 0;
    const mailer = makeMailer(async () => {
      n += 1;
      if (n === 1) return { messageId: '<a@smtp>' };
      throw smtpError(n === 2 ? 421 : 553);
    });

    await runCycle(makeDeps(stub.db, mailer.createTransport));

    for (const call of stub.settlements()) {
      expect(['sent', 'transient', 'permanent', 'hard_bounce']).toContain(call.args.p_outcome);
    }
  });
});

describe('worker/lib/engine — pacing', () => {
  it('sleeps between messages, for an interval inside the configured jitter range', async () => {
    const stub = oneMailbox([claimedRow(1), claimedRow(2), claimedRow(3)], {
      settings: [
        {
          organization_id: 'org-1',
          send_window_enabled: true,
          send_window_start: 8,
          send_window_end: 18,
          send_days: [1, 2, 3, 4, 5],
          send_timezone: 'UTC',
          jitter_min_ms: 1200,
          jitter_max_ms: 1800,
        },
      ],
    });
    const mailer = makeMailer(okSend);
    const sleep = vi.fn(async () => undefined);

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport, { sleep }));

    expect(result.sent).toBe(3);
    // Between, so three messages produce two pauses.
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as Array<[number]>) {
      expect(ms).toBeGreaterThanOrEqual(1200);
      expect(ms).toBeLessThanOrEqual(1800);
    }
  });
});

describe('worker/lib/engine — a mailbox that cannot be used', () => {
  it('skips a mailbox whose secret will not decrypt, untouched, and sends from the other', async () => {
    const stub = makeDb({
      mailboxes: [
        // Least recently used, so it is tried first and the cycle has to get
        // past it to reach the healthy one.
        mailboxRow({
          id: 'mbx-broken',
          from_email: 'broken@example.com',
          last_sent_at: null,
        }),
        mailboxRow({ id: 'mbx-good', from_email: 'good@example.com' }),
      ],
      accounts: [
        accountRow({ id: 'mbx-broken', from_email: 'broken@example.com' }),
        accountRow({ id: 'mbx-good', from_email: 'good@example.com' }),
      ],
      secrets: [
        // Not ciphertext at all: decryptSecret throws on it, exactly as it
        // would for a secret encrypted under a rotated key.
        { account_id: 'mbx-broken', secret_encrypted: 'this-is-not-ciphertext' },
        { account_id: 'mbx-good', secret_encrypted: CIPHERTEXT },
      ],
      campaigns: [campaignRow()],
      claims: { 'mbx-broken': [claimedRow(1)], 'mbx-good': [claimedRow(2)] },
    });
    const mailer = makeMailer(okSend);

    const result = await runCycle(makeDeps(stub.db, mailer.createTransport));

    // Nothing was claimed for it, so its rows were never taken out of the
    // queue and nothing was settled against it.
    expect(stub.claims().map((c) => c.args.p_account)).toEqual(['mbx-good']);
    expect(stub.settlements().every((c) => c.args.p_account === 'mbx-good')).toBe(true);
    // ...and the pool carried on.
    expect(result.sent).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    // Reported once, naming the mailbox, and never quoting the secret.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('broken@example.com');
    expect(result.errors.join(' ')).not.toContain('app-specific-password');
  });
});
