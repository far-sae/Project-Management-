// Tests for worker/lib/inboxCycle.ts — the inbox cycle.
//
// Like the send cycle's test, every side effect reaches the cycle through its
// deps: the Supabase client, the one IMAP session and the clock are all stubs
// here, so this runs with no network, no mail server and no database. The
// assertions are on the calls that were RECORDED — which mailbox was scanned,
// from what window, and what was written back — rather than on what the stubs
// returned, because the returns are this file's own fixtures.
//
// The encryption is real: the fake `email_account_secrets` row holds genuine
// ciphertext from src/lib/email/crypto, so the decrypt path runs rather than
// being mocked away.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encryptSecret } from '@/lib/email/crypto';
import { FIRST_SCAN_LOOKBACK_MS, SCAN_OVERLAP_MS } from '@/lib/email/inbox';
import type { InboxEnvelope } from '@/lib/email/types';

import type { MailboxScan } from '../../worker/lib/imap';
import { runInboxCycle, type InboxDeps } from '../../worker/lib/inboxCycle';

/* ------------------------------------------------------------------ fixtures */

// A real 32-byte base64url key, so encryptSecret/decryptSecret both work.
const KEY = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc';

const NOW = new Date('2026-09-19T12:00:00Z');
const REPLY_AT = new Date('2026-09-19T11:55:00Z');

type Row = Record<string, unknown>;

let CIPHERTEXT = '';
beforeAll(async () => {
  CIPHERTEXT = await encryptSecret('app-specific-password', KEY);
});

function mailboxRow(over: Row = {}): Row {
  return {
    id: 'mbx-1',
    organization_id: 'org-1',
    from_email: 'ada@example.com',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_secure: true,
    smtp_username: 'ada@example.com',
    inbox_last_scan_at: null,
    ...over,
  };
}

function secretRow(accountId = 'mbx-1'): Row {
  return { account_id: accountId, secret_encrypted: CIPHERTEXT };
}

/** A row of email_messages as the "who did this organisation write to" read sees it. */
function sentRow(to: string, over: Row = {}): Row {
  return {
    id: `msg-${to}`,
    to_email: to,
    organization_id: 'org-1',
    sent_account_id: 'mbx-1',
    sent_at: '2026-09-18T09:00:00Z',
    status: 'sent',
    ...over,
  };
}

function envelope(over: Partial<InboxEnvelope> = {}): InboxEnvelope {
  return { from: 'ada@acme.com', subject: 'Re: hello', at: REPLY_AT, ...over };
}

/** A rejected IMAP login, as imapflow reports one. */
function authError(): Error {
  return Object.assign(new Error('Authentication failed'), { authenticationFailed: true });
}

/* ------------------------------------------------------------- the stub db */

interface Fixtures {
  mailboxes?: Row[];
  secrets?: Row[];
  messages?: Row[];
  /** What record_inbox_result answers with; null data means "matched nothing". */
  matched?: string | null;
  /** How many leading record_inbox_result calls answer with an error instead. */
  recordErrors?: number;
  /** How many leading reads of email_messages answer with an error instead. */
  sentReadErrors?: number;
  /** True when the read of email_account_secrets answers with an error. */
  secretReadError?: boolean;
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A Supabase-shaped stub supporting only the chain the cycle actually uses.
 * Every write verb records itself, so a test can assert that the cycle wrote
 * nothing to `email_accounts` directly — the sending columns in particular.
 */
function makeDb(fx: Fixtures) {
  const tables: Record<string, Row[]> = {
    email_accounts: fx.mailboxes ?? [],
    email_account_secrets: fx.secrets ?? [],
    email_messages: fx.messages ?? [],
  };

  const rpcCalls: RpcCall[] = [];
  // One entry per from(), carrying the offset its .range() asked for, so a
  // test can tell a paged read's SECOND page from a second read.
  const reads: Array<{ table: string; start: number | null }> = [];
  const writes: Array<{ table: string; op: string }> = [];

  let sentReads = 0;
  const from = (table: string) => {
    const read: { table: string; start: number | null } = { table, start: null };
    reads.push(read);
    if (table === 'email_messages') sentReads += 1;
    // Which page of which read failed matters here, so the failure is decided
    // when from() is called rather than when the builder is awaited.
    const failed = table === 'email_messages' && sentReads <= (fx.sentReadErrors ?? 0);
    const filters: Array<(r: Row) => boolean> = [];
    let range: [number, number] | null = null;
    const rows = () => {
      const matched = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return range ? matched.slice(range[0], range[1] + 1) : matched;
    };
    const write = (op: string) => {
      writes.push({ table, op });
      return builder;
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      range: (start: number, end: number) => {
        range = [start, end];
        read.start = start;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      gte: (col: string, val: unknown) => {
        filters.push((r) => String(r[col] ?? '') >= String(val));
        return builder;
      },
      not: (col: string, op: string, val: unknown) => {
        filters.push((r) => !(op === 'is' && val === null) || r[col] !== null);
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
      maybeSingle: async () =>
        table === 'email_account_secrets' && fx.secretReadError
          ? { data: null, error: { message: 'could not read email_account_secrets' } }
          : { data: rows()[0] ?? null, error: null },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(
          failed
            ? { data: null, error: { message: 'could not read email_messages' } }
            : { data: rows(), error: null },
        ).then(ok, bad),
    };
    return builder;
  };

  let recordCalls = 0;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'record_inbox_result') {
      recordCalls += 1;
      if (recordCalls <= (fx.recordErrors ?? 0)) {
        return { data: null, error: { message: 'could not record the result' } };
      }
      // null is the ordinary "recorded, but matched nothing" answer.
      return { data: fx.matched === undefined ? 'msg-1' : fx.matched, error: null };
    }
    return { data: null, error: null };
  };

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    rpcCalls,
    reads,
    writes,
    names: () => rpcCalls.map((c) => c.name),
    results: () => rpcCalls.filter((c) => c.name === 'record_inbox_result'),
    touches: () => rpcCalls.filter((c) => c.name === 'touch_inbox_scan'),
  };
}

/* ----------------------------------------------------------------- harness */

interface Stubs {
  envelopes?: InboxEnvelope[] | (() => Promise<InboxEnvelope[]>);
  bounces?: Array<{ envelope: InboxEnvelope; source: string }>;
  /** False when the stubbed session hit a cap and did not read the window out. */
  complete?: boolean;
  /** The newest message a truncated stubbed session read; see MailboxScan. */
  resumeAt?: Date | null;
  shouldStop?: () => boolean;
}

/**
 * One stubbed IMAP session per mailbox, matching `scanInbox`'s contract: the
 * envelopes and the sources of the bounce-shaped ones come back TOGETHER, from
 * one call. The cycle no longer decides whether to go back for bodies, so
 * there is nothing here for it to call twice.
 */
function makeDeps(fx: Fixtures, stubs: Stubs = {}) {
  const harness = makeDb(fx);

  const scan = vi.fn(async (_cfg: unknown, _since: Date): Promise<MailboxScan> => {
    const value = stubs.envelopes ?? [];
    const envelopes = typeof value === 'function' ? await value() : value;
    const complete = stubs.complete ?? true;
    return {
      envelopes,
      bounces: stubs.bounces ?? [],
      complete,
      truncated: complete ? null : 'stopped after 500 messages; the rest of this window was not read',
      resumeAt: complete ? null : (stubs.resumeAt ?? null),
    };
  });

  const deps: InboxDeps = {
    db: harness.db,
    scan,
    now: () => NOW,
    env: { tokenKey: KEY },
    shouldStop: stubs.shouldStop,
  };

  return { ...harness, deps, scan };
}

/* ------------------------------------------------------------------- tests */

describe('runInboxCycle', () => {
  it('skips a mailbox with no IMAP host entirely', async () => {
    // Two shapes of "no host": a null, which the server-side filter excludes,
    // and a blank string, which it does NOT — that one is only skipped by the
    // cycle's own check, so this asserts the check rather than the filter.
    const h = makeDeps({
      mailboxes: [
        mailboxRow({ imap_host: null }),
        mailboxRow({ id: 'mbx-2', from_email: 'grace@example.com', imap_host: '   ' }),
      ],
      secrets: [secretRow(), secretRow('mbx-2')],
    });

    const result = await runInboxCycle(h.deps);

    // Nothing connected, and — the point of rule 3 — no scan recorded either:
    // Not even touch_inbox_scan('unconfigured'): a scan that was never made
    // should leave no trace of having been made, on a mailbox somebody may
    // configure five minutes from now.
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.rpcCalls).toHaveLength(0);
    expect(result.scanned).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('records a reply from an address this mailbox wrote to', async () => {
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com')],
      },
      { envelopes: [envelope({ from: '"Ada" <Ada@Acme.com>' })] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(1);
    expect(h.results()[0].args).toMatchObject({
      p_account: 'mbx-1',
      p_kind: 'reply',
      p_address: 'ada@acme.com',
      p_at: REPLY_AT.toISOString(),
    });
    expect(result.replies).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('records a reply once, not again on every overlapping window', async () => {
    // The scan window overlaps the last one by three minutes against a
    // five-minute loop, so the same reply is seen at least twice by
    // construction. record_inbox_result writes an email_inbox_events row for
    // every match it is handed, so this used to leave at least one duplicate
    // per reply in the table support reads.
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com', { replied_at: '2026-09-19T11:55:00Z' })],
      },
      { envelopes: [envelope()] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(0);
    expect(result.replies).toBe(0);
    // And the scan completed: there was nothing left to do, not something left
    // undone.
    expect(h.touches()[0].args).toMatchObject({ p_status: 'active' });
  });

  it('still records a reply when the last message to that address has none', async () => {
    // The other half of the same check: a second campaign to somebody who
    // replied to the first one is a new reply, not a duplicate.
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [
          sentRow('ada@acme.com', { id: 'msg-new', sent_at: '2026-09-19T08:00:00Z' }),
          sentRow('ada@acme.com', {
            id: 'msg-old',
            sent_at: '2026-08-01T09:00:00Z',
            replied_at: '2026-08-01T10:00:00Z',
          }),
        ],
      },
      { envelopes: [envelope()] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(1);
    expect(result.replies).toBe(1);
  });

  it('reports a database failure opening the credential as incomplete', async () => {
    // The secret read and the decrypt used to sit outside the try that maps to
    // 'incomplete', so a rejected query there was classified by
    // classifyImapError as a mailbox failure: a red CREDENTIAL error on the
    // Accounts card, carrying a raw database message, for a mailbox whose host
    // and app password were both fine.
    const h = makeDeps({ mailboxes: [mailboxRow()], secrets: [secretRow()], secretReadError: true });

    const result = await runInboxCycle(h.deps);

    const args = h.touches()[0].args as { p_status: string; p_error: string };
    expect(args.p_status).toBe('incomplete');
    expect(args.p_status).not.toBe('error');
    expect(args.p_error).toMatch(/could not be opened/i);
    expect(args.p_error).toMatch(/sending is unaffected/i);
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.names()).not.toContain('record_mailbox_failure');
    expect(result.scanned).toBe(0);
  });

  it('reports a mailbox with no stored password as an error the admin must fix', async () => {
    // A row that is absent is not a row that failed to read. This one can
    // never succeed — no retry conjures a password nobody saved — so telling
    // the admin 'nothing is wrong, the next scan picks it up' would be false,
    // and they would believe it while replies went unread indefinitely.
    const h = makeDeps({ mailboxes: [mailboxRow()], secrets: [] });

    const result = await runInboxCycle(h.deps);

    const args = h.touches()[0].args as { p_status: string; p_error: string };
    expect(args.p_status).toBe('error');
    expect(args.p_error).toMatch(/no password is stored/i);
    expect(args.p_error).toMatch(/re-enter the password/i);
    // Still never charged to the send path: an unreadable inbox sends fine.
    expect(args.p_error).toMatch(/sending is unaffected/i);
    // Nothing was connected to, and nothing was charged to the send path.
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.names()).not.toContain('record_mailbox_failure');
    expect(h.writes).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('records a reply that lands in one mailbox for what a sibling sent', async () => {
    // The pooled case, and the one that used to fail silently: the campaign
    // went out through mailbox B, the reply arrived in mailbox A. The SQL
    // matches organisation-wide, so the worker must not be narrower than it.
    const h = makeDeps(
      {
        mailboxes: [
          mailboxRow(),
          mailboxRow({ id: 'mbx-2', from_email: 'grace@example.com' }),
        ],
        secrets: [secretRow(), secretRow('mbx-2')],
        messages: [sentRow('ada@acme.com', { sent_account_id: 'mbx-2' })],
      },
      {
        // Mailbox A holds the reply; mailbox B has traffic of its own, so both
        // mailboxes need the match set and only one read may serve them.
        envelopes: (() => {
          let call = 0;
          return async () => {
            call += 1;
            return call === 1 ? [envelope()] : [envelope({ from: 'someone@elsewhere.test' })];
          };
        })(),
      },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(1);
    expect(h.results()[0].args).toMatchObject({
      p_account: 'mbx-1',
      p_kind: 'reply',
      p_address: 'ada@acme.com',
    });
    expect(result.replies).toBe(1);

    // And read once for the organisation, not once per mailbox: widening the
    // scope has to cost fewer reads than the per-mailbox version, not more.
    // Counted by first pages, since one read pages until it comes up empty.
    const sentReads = h.reads.filter((r) => r.table === 'email_messages' && r.start === 0);
    expect(sentReads).toHaveLength(1);
  });

  it('ignores a sender this mailbox never wrote to', async () => {
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com')],
      },
      { envelopes: [envelope({ from: 'stranger@nowhere.test' })] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(0);
    expect(result.replies).toBe(0);
    // The scan itself still succeeded.
    expect(h.touches()[0].args).toMatchObject({ p_status: 'active' });
  });

  it('records a bounce with the address extracted from the notification', async () => {
    const dsn = envelope({ from: 'mailer-daemon@example.com', subject: 'Undeliverable' });
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('bob@acme.com')],
        // The SQL matched nothing. That is a normal outcome, not a failure:
        // the event is recorded and nothing is suppressed.
        matched: null,
      },
      {
        envelopes: [dsn],
        bounces: [{ envelope: dsn, source: 'Final-Recipient: rfc822; Bob@Acme.com\r\n' }],
      },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(1);
    expect(h.results()[0].args).toMatchObject({
      p_account: 'mbx-1',
      p_kind: 'bounce',
      p_address: 'bob@acme.com',
      p_at: REPLY_AT.toISOString(),
    });
    expect(result.bounces).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('reads a subject-only bounce candidate and suppresses nothing on it', async () => {
    // A person forwarded a bounce and asked whether the address was right; the
    // contact answered. Her subject now reads "Re: Undeliverable:", her
    // signature reads "ada@acme.com | Suite 500", and the database holds a
    // message the organisation sent her. Before the evidence gate this scan
    // suppressed her organisation-wide, permanently, in the same pass that
    // recorded her reply.
    const human = envelope({ from: 'ada@acme.com', subject: 'Re: Undeliverable: your invoice' });
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com')],
      },
      {
        envelopes: [human],
        // Downloaded — the subject earned that much — and then left alone.
        bounces: [
          {
            envelope: human,
            source: 'Yes, that address is right.\n--\nAda Lovelace | ada@acme.com | Suite 500\n',
          },
        ],
      },
    );

    const result = await runInboxCycle(h.deps);

    // The reply is recorded. The bounce is not, so nothing reaches the SQL
    // that would suppress her.
    expect(h.results().map((c) => c.args.p_kind)).toEqual(['reply']);
    expect(result.bounces).toBe(0);
    expect(result.replies).toBe(1);
    // And the scan still completed: refusing to act on it is the normal
    // outcome, not a failure to finish.
    expect(h.touches()[0].args).toMatchObject({ p_status: 'active' });
  });

  it('records which evidence let a bounce suppress', async () => {
    // The question a disputed suppression always comes down to, answerable
    // months later from the event row alone.
    const dsn = envelope({ from: 'relay@acme.com', subject: 'hello' });
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()] },
      {
        envelopes: [envelope({ from: 'mailer-daemon@example.com', subject: 'Undeliverable' })],
        bounces: [
          {
            envelope: dsn,
            source:
              'Content-Type: multipart/report; report-type=delivery-status\r\n' +
              '\r\nFinal-Recipient: rfc822; bob@acme.com\r\n',
          },
        ],
      },
    );

    await runInboxCycle(h.deps);

    expect(h.results()[0].args.p_detail).toMatch(/evidence: delivery-status-report/);
  });

  it('opens ONE session per mailbox, whatever the window held', async () => {
    // The spec's "connect once, scan, disconnect". The pair of reads this
    // replaced logged in twice for any mailbox that had a bounce in it, and an
    // IMAP login rate is itself a throttling trigger. Which envelopes get
    // their bodies downloaded is settled inside that one session, and is
    // pinned in tests/unit/emailImap.test.ts.
    const dsn = envelope({ from: 'mailer-daemon@example.com', subject: 'Undeliverable' });
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com')],
      },
      {
        envelopes: [envelope(), dsn],
        bounces: [{ envelope: dsn, source: 'Final-Recipient: rfc822; bob@acme.com\r\n' }],
      },
    );

    await runInboxCycle(h.deps);

    expect(h.scan).toHaveBeenCalledTimes(1);
  });

  it('resumes from where a capped scan stopped, rather than reading the same window for ever', async () => {
    // Holding the cursor here was the obvious answer and the wrong one. The
    // window is DERIVED from the cursor, so an unmoved cursor recomputes the
    // same window, whose first 500 messages are the same 500, and the walk
    // stops in the same place — permanently, for any mailbox busy enough to
    // reach the cap at all. So the cursor moves to the newest message actually
    // read, and the messages between there and the end of the window are the
    // cap's stated cost.
    const resumeAt = new Date('2026-09-19T11:58:00Z');
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()] },
      { envelopes: [], complete: false, resumeAt },
    );

    const result = await runInboxCycle(h.deps);

    const args = h.touches()[0].args as {
      p_status: string;
      p_error: string;
      p_scanned_at: string;
    };
    // 'active', because nothing failed — and 'active' is the only status
    // touch_inbox_scan() lets move the cursor.
    expect(args.p_status).toBe('active');
    expect(args.p_scanned_at).toBe(resumeAt.toISOString());
    // Not the scan's own start time: that would step over everything the cap
    // missed, which is the loss holding the cursor was trying to avoid.
    expect(args.p_scanned_at).not.toBe(NOW.toISOString());
    // And the mailbox does not get to look healthy while dropping mail.
    expect(args.p_error).toMatch(/more mail than one scan reads/i);
    expect(args.p_error).toMatch(/sending is unaffected/i);
    expect(result.scanned).toBe(1);
    expect(result.errors.join(' ')).toMatch(/did not finish the window/i);
  });

  it('holds the cursor when a capped scan read nothing it could resume from', async () => {
    // No resume point means no progress to write: a whole cap's worth of
    // messages sharing one timestamp, or a cap of zero. Advancing on a guess
    // would skip mail, and unlike the steady-volume case this one does clear
    // on its own.
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()] },
      { envelopes: [], complete: false, resumeAt: null },
    );

    const result = await runInboxCycle(h.deps);

    const args = h.touches()[0].args as { p_status: string };
    expect(args.p_status).toBe('incomplete');
    expect(result.scanned).toBe(0);
  });

  it('records an authentication failure without touching the sending columns', async () => {
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()] },
      {
        envelopes: () => {
          throw authError();
        },
      },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.touches()).toHaveLength(1);
    const args = h.touches()[0].args as { p_status: string; p_error: string };
    expect(args.p_status).toBe('error');
    // And never 'incomplete': that one says the mailbox read fine. A rejected
    // login is the admin's to fix, so the two must not collapse into one.
    expect(args.p_status).not.toBe('incomplete');
    expect(args.p_error).toMatch(/rejected the IMAP login/i);
    // The sentence that makes an auth failure readable as a settings problem
    // rather than an outage, and that promises sending is untouched. It is the
    // only thing distinguishing this class, so it is asserted, not assumed.
    expect(args.p_error).toMatch(/keep failing until the credential is fixed/i);
    expect(args.p_error).toMatch(/sending is unaffected/i);

    // Rule 1: sending is untouched. No strike, no direct write to the mailbox
    // row, nothing that claim_email_batch() would read.
    expect(h.names()).not.toContain('record_mailbox_failure');
    expect(h.writes).toEqual([]);
    expect(result.scanned).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('holds the cursor when what it found could not be recorded', async () => {
    const h = makeDeps(
      {
        mailboxes: [mailboxRow()],
        secrets: [secretRow()],
        messages: [sentRow('ada@acme.com')],
        recordErrors: 1,
      },
      { envelopes: [envelope()] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.results()).toHaveLength(1);
    // Not 'active': that advances inbox_last_scan_at, and with a three-minute
    // overlap against a five-minute loop this reply would be behind the next
    // window immediately. 'incomplete' holds the cursor — and is NOT 'error',
    // which would tell an admin to go and fix a credential that worked fine.
    const args = h.touches()[0].args as { p_status: string; p_error: string };
    expect(args.p_status).toBe('incomplete');
    expect(args.p_error).toMatch(/could not all be recorded/i);
    expect(args.p_error).toMatch(/sending is unaffected/i);
    expect(result.replies).toBe(0);
    expect(result.scanned).toBe(0);
    expect(result.errors).toHaveLength(1);

    // Still nothing charged to the send path.
    expect(h.names()).not.toContain('record_mailbox_failure');
    expect(h.writes).toEqual([]);
  });

  it('never caches a failed address read, and holds the cursor of what it could not serve', async () => {
    const h = makeDeps(
      {
        mailboxes: [
          mailboxRow(),
          mailboxRow({ id: 'mbx-2', from_email: 'grace@example.com' }),
        ],
        secrets: [secretRow(), secretRow('mbx-2')],
        messages: [sentRow('ada@acme.com')],
        // The first read of email_messages fails; the retry succeeds.
        sentReadErrors: 1,
      },
      { envelopes: [envelope()] },
    );

    const result = await runInboxCycle(h.deps);

    // Retried rather than served an empty set from the cache: an empty match
    // set is not the same answer as "the match set could not be read".
    const sentReads = h.reads.filter((r) => r.table === 'email_messages' && r.start === 0);
    expect(sentReads).toHaveLength(2);

    // Mailbox A could not be served, so its window is held for the next pass;
    // mailbox B got the retried read and completed.
    expect(h.touches().map((c) => c.args.p_status)).toEqual(['incomplete', 'active']);
    expect(h.results()).toHaveLength(1);
    expect(h.results()[0].args).toMatchObject({ p_account: 'mbx-2', p_kind: 'reply' });
    expect(result.replies).toBe(1);
    expect(result.scanned).toBe(1);
  });

  it('records a successful scan as active', async () => {
    const h = makeDeps(
      { mailboxes: [mailboxRow()], secrets: [secretRow()] },
      { envelopes: [] },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.touches()).toHaveLength(1);
    expect(h.touches()[0].args).toMatchObject({
      p_account: 'mbx-1',
      p_status: 'active',
      p_error: null,
    });
    expect(result.scanned).toBe(1);
  });

  it('uses the first-scan floor, then the overlap window', async () => {
    const first = makeDeps({ mailboxes: [mailboxRow()], secrets: [secretRow()] });
    await runInboxCycle(first.deps);
    expect(first.scan.mock.calls[0][1]).toEqual(
      new Date(NOW.getTime() - FIRST_SCAN_LOOKBACK_MS),
    );

    const last = new Date('2026-09-19T11:50:00Z');
    const again = makeDeps({
      mailboxes: [mailboxRow({ inbox_last_scan_at: last.toISOString() })],
      secrets: [secretRow()],
    });
    await runInboxCycle(again.deps);
    expect(again.scan.mock.calls[0][1]).toEqual(new Date(last.getTime() - SCAN_OVERLAP_MS));
  });

  it('carries on to the next mailbox after one fails', async () => {
    const h = makeDeps(
      {
        mailboxes: [
          mailboxRow(),
          mailboxRow({ id: 'mbx-2', from_email: 'grace@example.com' }),
        ],
        secrets: [secretRow(), secretRow('mbx-2')],
      },
      {
        envelopes: (() => {
          let call = 0;
          return async () => {
            call += 1;
            if (call === 1) throw authError();
            return [];
          };
        })(),
      },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.scan).toHaveBeenCalledTimes(2);
    expect(h.touches().map((c) => c.args.p_status)).toEqual(['error', 'active']);
    expect(result.scanned).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('stops cleanly between mailboxes when asked to', async () => {
    let scans = 0;
    const h = makeDeps(
      {
        mailboxes: [
          mailboxRow(),
          mailboxRow({ id: 'mbx-2', from_email: 'grace@example.com' }),
        ],
        secrets: [secretRow(), secretRow('mbx-2')],
      },
      {
        envelopes: async () => {
          scans += 1;
          return [];
        },
        shouldStop: () => scans >= 1,
      },
    );

    const result = await runInboxCycle(h.deps);

    expect(h.scan).toHaveBeenCalledTimes(1);
    expect(h.touches()).toHaveLength(1);
    expect(result.scanned).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
