// Tests for worker/lib/imap.ts — the only file in the project that speaks IMAP.
//
// This drives the REAL module. Only `imapflow` itself is replaced, by a fake
// client that enforces the one rule the library documents about `fetch()`:
//
//   > you can not run any other IMAP commands while iterating over the fetch
//   > response, or you will end up in a dead loop
//
// The fake makes that rule fail LOUDLY — any command issued while a fetch
// generator is open throws — because against a real server it does not fail at
// all. imapflow serialises commands through one request queue and the
// in-flight FETCH applies backpressure until the consumer advances, so the
// nested command waits for the loop and the loop waits for the command.
// Nothing moves, nothing throws, and thirty seconds later the socket times out
// and the scan is reported to the admin as an unreachable mail server. That is
// what this file exists to catch; every assertion below was invisible to the
// cycle's own test, which stubs this module out entirely.
//
// The fake also mimics the part of IMAP's `SINCE` that made the scan drop the
// newest mail: its argument is a DATE, so the server answers with everything
// from midnight of that day, which is up to twenty-four hours wider than the
// window asked for.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------ the fake server */

interface FakeMessage {
  uid: number;
  from: string;
  subject: string;
  /** The server's own record of when it arrived. */
  internalDate: Date;
  /** The `Date:` header — the sender's clock, and not to be trusted. */
  headerDate?: Date;
  source: string;
}

const state = vi.hoisted(() => ({
  messages: [] as Array<{
    uid: number;
    from: string;
    subject: string;
    internalDate: Date;
    headerDate?: Date;
    source: string;
  }>,
  /** Every command the module issued, in order. */
  calls: [] as string[],
  /** UIDs whose source was actually downloaded. */
  sourcesFetched: [] as number[],
  /** Any attempt to run a command inside an open fetch, named. */
  violations: [] as string[],
  /** True while a fetch generator is open. */
  fetching: false,
}));

vi.mock('imapflow', () => {
  /** Midnight of a date, which is all IMAP's SINCE can express. */
  const startOfDay = (d: Date): Date =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  class ImapFlow {
    constructor(_options: unknown) {
      /* the module's own options are asserted through behaviour, not shape */
    }

    private command(name: string): void {
      if (state.fetching) {
        // The library's documented contract. A real server would simply
        // stop answering; here it is an error, which is the only way a test
        // can tell the difference between "correct" and "deadlocked".
        state.violations.push(name);
        throw new Error(
          `imapflow contract violated: ${name} was issued while a fetch was still open`,
        );
      }
      state.calls.push(name);
    }

    on(_event: string, _handler: unknown): this {
      return this;
    }

    async connect(): Promise<void> {
      this.command('connect');
    }

    async logout(): Promise<void> {
      this.command('logout');
    }

    close(): void {
      state.calls.push('close');
    }

    async getMailboxLock(path: string): Promise<{ release: () => void }> {
      this.command(`lock:${path}`);
      return {
        release: (): void => {
          state.calls.push('release');
        },
      };
    }

    async list(): Promise<Array<{ path: string; specialUse?: string }>> {
      this.command('list');
      return [{ path: 'Sent', specialUse: '\\Sent' }];
    }

    async fetchOne(_range: unknown, _query: unknown, _options?: unknown): Promise<unknown> {
      this.command('fetchOne');
      return false;
    }

    async *fetch(
      range: { since?: Date } | number[] | string,
      query: { source?: boolean },
      _options?: unknown,
    ): AsyncGenerator<Record<string, unknown>, void, undefined> {
      this.command('fetch');
      state.fetching = true;
      try {
        let selected: FakeMessage[];
        if (Array.isArray(range)) {
          // A UID set — what the source pass asks for.
          selected = state.messages.filter((m) => range.includes(m.uid));
        } else if (typeof range === 'object' && range.since) {
          // IMAP SINCE: a DATE, so midnight of that day, not the instant.
          const floor = startOfDay(range.since).getTime();
          selected = state.messages.filter((m) => m.internalDate.getTime() >= floor);
        } else {
          selected = [...state.messages];
        }

        // Sequence order: oldest first, which is why a limit that stops early
        // keeps exactly the wrong end of the window.
        selected = [...selected].sort(
          (a, b) => a.internalDate.getTime() - b.internalDate.getTime(),
        );

        for (const message of selected) {
          if (query.source) state.sourcesFetched.push(message.uid);
          yield {
            uid: message.uid,
            internalDate: message.internalDate,
            envelope: {
              from: [{ address: message.from }],
              subject: message.subject,
              date: message.headerDate ?? message.internalDate,
            },
            ...(query.source ? { source: Buffer.from(message.source, 'utf8') } : {}),
          };
        }
      } finally {
        state.fetching = false;
      }
    }
  }

  return { ImapFlow };
});

// Imported AFTER the mock is declared; vitest hoists both above this line.
const { scanInbox } = await import('../../worker/lib/imap');

/* ------------------------------------------------------------------ fixtures */

const CFG = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'ada@example.com',
  password: 'app-specific-password',
};

const NOON = new Date('2026-09-19T12:00:00Z');
/** The window a five-minute loop actually asks for. */
const SINCE = new Date('2026-09-19T11:55:00Z');

let nextUid = 1;
function message(over: Partial<FakeMessage> = {}): FakeMessage {
  const uid = over.uid ?? nextUid++;
  return {
    uid,
    from: 'ada@acme.com',
    subject: 'Re: hello',
    internalDate: NOON,
    source: 'nothing structured in here',
    ...over,
  };
}

const DSN_SOURCE =
  'Content-Type: multipart/report; report-type=delivery-status\r\n' +
  '\r\nFinal-Recipient: rfc822; bob@acme.com\r\nAction: failed\r\n';

beforeEach(() => {
  state.messages = [];
  state.calls = [];
  state.sourcesFetched = [];
  state.violations = [];
  state.fetching = false;
  nextUid = 1;
});

/* --------------------------------------------------------------------- tests */

describe('scanInbox', () => {
  it('issues no command inside the envelope walk, even with bounces in the window', async () => {
    // The original shape of this scan awaited fetchOne() inside the fetch
    // loop, which against a real server never returns. Both messages here are
    // bounce-shaped, so the old code would have nested a command on the first
    // one and never reached the second.
    state.messages = [
      message({ from: 'mailer-daemon@example.com', subject: 'Undeliverable', source: DSN_SOURCE }),
      message({ from: 'postmaster@example.com', subject: 'Delivery Status', source: DSN_SOURCE }),
    ];

    const scan = await scanInbox(CFG, SINCE);

    expect(state.violations).toEqual([]);
    expect(state.calls).not.toContain('fetchOne');
    expect(scan.bounces).toHaveLength(2);
    expect(scan.complete).toBe(true);
  });

  it('downloads a source only for an envelope the heuristic accepted', async () => {
    const bounce = message({
      from: 'mailer-daemon@example.com',
      subject: 'Undeliverable: hello',
      source: DSN_SOURCE,
    });
    const ordinary = message({ from: 'ada@acme.com', subject: 'Re: hello' });
    state.messages = [bounce, ordinary];

    const scan = await scanInbox(CFG, SINCE);

    // Both envelopes are read; only the notifier's body is pulled into this
    // process. That is the promise this phase makes about the customer's own
    // correspondence, and it is enforced here rather than downstream.
    expect(scan.envelopes).toHaveLength(2);
    expect(state.sourcesFetched).toEqual([bounce.uid]);
    expect(scan.bounces.map((b) => b.envelope.from)).toEqual(['mailer-daemon@example.com']);
    expect(scan.bounces[0].source).toContain('Final-Recipient');
  });

  it('drops what the server volunteered from before the window', async () => {
    // SINCE is 11:55; the server answers from midnight because its argument is
    // a date. Without the client-side filter the 02:00 message is inside the
    // scan — and, worse, ahead of the real window in sequence order.
    const early = message({ internalDate: new Date('2026-09-19T02:00:00Z') });
    const inside = message({ internalDate: new Date('2026-09-19T11:58:00Z') });
    state.messages = [early, inside];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes).toHaveLength(1);
    expect(scan.envelopes[0].at.toISOString()).toBe('2026-09-19T11:58:00.000Z');
  });

  it('times a message by the server clock, not by the sender’s Date header', async () => {
    // A reply whose client wrote 1970 would otherwise be filtered straight out
    // of the window it genuinely belongs in, and a forged future date would be
    // written into replied_at and stay there.
    state.messages = [
      message({
        internalDate: new Date('2026-09-19T11:58:00Z'),
        headerDate: new Date('1970-01-01T00:00:00Z'),
      }),
    ];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes).toHaveLength(1);
    expect(scan.envelopes[0].at.toISOString()).toBe('2026-09-19T11:58:00.000Z');
  });

  it('says so, rather than truncating in silence, when the cap is reached', async () => {
    state.messages = [message(), message(), message()];

    const scan = await scanInbox(CFG, SINCE, { envelopes: 2 });

    expect(scan.envelopes).toHaveLength(2);
    // complete: false is the signal the cycle turns into a held cursor. The
    // dropped messages are the NEWEST in the window — sequence order is oldest
    // first — so advancing past them loses exactly the mail the scan exists
    // for.
    expect(scan.complete).toBe(false);
    expect(scan.truncated).toMatch(/not read/i);
  });

  it('says so when more bounce notifications arrived than it will download', async () => {
    const dsn = (uid: number): FakeMessage =>
      message({
        uid,
        from: 'mailer-daemon@example.com',
        subject: 'Undeliverable',
        source: DSN_SOURCE,
      });
    state.messages = [dsn(1), dsn(2), dsn(3)];

    const scan = await scanInbox(CFG, SINCE, { bounces: 2 });

    expect(scan.bounces).toHaveLength(2);
    expect(scan.complete).toBe(false);
    expect(scan.truncated).toMatch(/bounce notifications/i);
  });

  it('logs in once and logs out once, whatever the window held', async () => {
    state.messages = [
      message({ from: 'mailer-daemon@example.com', subject: 'Undeliverable', source: DSN_SOURCE }),
      message({ from: 'ada@acme.com', subject: 'Re: hello' }),
    ];

    await scanInbox(CFG, SINCE);

    expect(state.calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(state.calls.filter((c) => c === 'logout')).toHaveLength(1);
    // And the mailbox lock is released before the logout, not left open.
    expect(state.calls.indexOf('release')).toBeLessThan(state.calls.indexOf('logout'));
  });

  it('logs out even when nothing matched, and opens no second session', async () => {
    state.messages = [];

    const scan = await scanInbox(CFG, SINCE);

    expect(scan.envelopes).toEqual([]);
    expect(scan.bounces).toEqual([]);
    expect(state.calls.filter((c) => c === 'connect')).toHaveLength(1);
    expect(state.calls.filter((c) => c === 'logout')).toHaveLength(1);
    // One fetch, not two: with no candidate there is no source pass at all.
    expect(state.calls.filter((c) => c === 'fetch')).toHaveLength(1);
  });
});
