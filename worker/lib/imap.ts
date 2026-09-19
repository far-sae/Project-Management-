// IMAP client. Worker-only — this is the only file in the project that
// speaks IMAP: connecting, fetching, appending, disconnecting.
//
// Every decision about what an envelope or a message body *means* — is this
// a reply, does this look like a bounce, which address a bounce is reporting
// as failed, how far back a scan should look — is a pure, unit-tested
// function in src/lib/email/inbox.ts. Keep it that way: no matching logic
// here, no suppression decisions. This module's job ends at "connected,
// fetched, disconnected."
//
// Ported from the reference project's src/server/imap.ts.

import { ImapFlow, type FetchMessageObject } from 'imapflow';

import { looksLikeBounce } from '@/lib/email/inbox';
import type { InboxEnvelope } from '@/lib/email/types';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

/** The default migration 157 gives imap_port, for a row read before it applied. */
const DEFAULT_IMAP_PORT = 993;

/**
 * The mailbox columns an IMAP login is built from.
 *
 * There is no imap_username on purpose: the same credential serves both
 * protocols (migration 157a), so the SMTP username and the stored secret are
 * what the IMAP login uses too.
 */
export interface ImapAccountColumns {
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  smtp_username: string;
}

/**
 * Whether a mailbox has IMAP configured at all.
 *
 * A BLANK host is no host. The column is free text with no constraint, so a
 * row saved with a cleared field holds '' rather than null, and a config built
 * from it would connect to nothing and report the failure as a broken mailbox
 * — for a customer who simply never turned IMAP on.
 */
export function hasImapHost(row: Pick<ImapAccountColumns, 'imap_host'>): boolean {
  return (row.imap_host ?? '').trim() !== '';
}

/**
 * The IMAP login for a mailbox row, or null when it has none.
 *
 * One definition for both cycles: worker/lib/inboxCycle.ts reads the mailbox
 * with it and worker/lib/engine.ts files its sent copies with it. The rule
 * that a mailbox without a host is skipped ENTIRELY — no connection, no
 * failure reported — is load-bearing in both, and two copies of it would
 * eventually disagree about a blank string or a missing port.
 *
 * The trim is deliberate, and it is a deliberate CHANGE for the inbox cycle,
 * which did not trim before these two were unified. Trimming is the safer of
 * the two behaviours: a host pasted with a trailing space resolves nowhere,
 * and the failure then reads to an admin as an unreachable mail server rather
 * than as the invisible typo it actually is.
 */
export function imapConfigFor(row: ImapAccountColumns, password: string): ImapConfig | null {
  if (!hasImapHost(row)) return null;
  return {
    host: String(row.imap_host).trim(),
    port: row.imap_port ?? DEFAULT_IMAP_PORT,
    secure: row.imap_secure ?? true,
    user: row.smtp_username,
    password,
  };
}

/**
 * Builds a client with an `error` listener already attached.
 *
 * ImapFlow is an EventEmitter, and Node terminates the process on an 'error'
 * event that nobody is listening for. Those arrive asynchronously — a socket
 * timeout, a dropped TLS connection — so the try/catch around `connect()`
 * never sees them. Without this listener a stalled IMAP connection kills the
 * worker.
 *
 * The listener only records: the awaited calls still reject, and the callers
 * turn that into a normal error.
 */
function createImapClient(cfg: ImapConfig): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
  });

  client.on('error', (err: unknown) => {
    console.error(`imap connection error (${cfg.host}):`, err instanceof Error ? err.message : err);
  });

  return client;
}

/**
 * Ends a connection no matter what state it's in. `logout()` can throw when
 * the socket is already gone — the server closed it, the `error` listener
 * above already tore it down — and a connection that never gets released
 * outlives this cycle. Providers cap concurrent IMAP connections per
 * mailbox, so a leak here starves every scan after it.
 */
async function closeImapClient(client: ImapFlow): Promise<void> {
  await client.logout().catch(() => client.close());
}

/**
 * When a message actually arrived, and the only clock this module trusts.
 *
 * `internalDate` is the SERVER's own record of when the message landed in the
 * mailbox. `envelope.date` is the `Date:` header, which is the SENDER's clock
 * and is whatever their mail client felt like writing — routinely wrong by
 * hours on a misconfigured machine, and trivially forged by anyone.
 *
 * Every time decision here uses internalDate, because the header date fails in
 * both directions and both are damaging: a message stamped last week would be
 * filtered out of the window it genuinely belongs in and then lost for good
 * once the cursor stepped past it, and a message stamped 1970 or 2031 would
 * write that value into `replied_at` and stay there.
 *
 * The header is a fallback only for a server that answered with no
 * internalDate at all, and even then it is CLAMPED into the window that was
 * actually scanned — so the worst a bogus `Date:` can do is put the message at
 * one end of a window it had already been fetched into.
 */
function messageDate(msg: FetchMessageObject, since: Date, ceiling: Date): Date {
  const internal = msg.internalDate;
  const fromServer =
    internal instanceof Date ? internal : typeof internal === 'string' ? new Date(internal) : null;
  if (fromServer && !Number.isNaN(fromServer.getTime())) return fromServer;

  const header = msg.envelope?.date;
  const fromHeader = header instanceof Date ? header : header ? new Date(header) : null;
  if (!fromHeader || Number.isNaN(fromHeader.getTime())) return ceiling;
  return new Date(Math.min(Math.max(fromHeader.getTime(), since.getTime()), ceiling.getTime()));
}

function toEnvelope(msg: FetchMessageObject, since: Date, ceiling: Date): InboxEnvelope {
  return {
    from: msg.envelope?.from?.[0]?.address ?? '',
    subject: msg.envelope?.subject ?? '',
    at: messageDate(msg, since, ceiling),
  };
}

/** Envelopes read in one scan before the walk gives up and says so. */
const ENVELOPE_LIMIT = 500;
/** Bounce candidates whose source is downloaded in one scan. */
const BOUNCE_LIMIT = 200;

/** Everything one session over one mailbox produced. */
export interface MailboxScan {
  /** Every envelope in the window, in the order the server gave them. */
  envelopes: InboxEnvelope[];
  /** Envelope and raw source for each candidate `looksLikeBounce` accepted. */
  bounces: Array<{ envelope: InboxEnvelope; source: string }>;
  /**
   * False when a cap stopped the scan before the window had been read out.
   * The caller must hold its cursor on this: part of the window was never
   * looked at, and advancing past it loses whatever was in there.
   */
  complete: boolean;
  /** One safe-to-log line naming the cap that was hit, or null. */
  truncated: string | null;
}

/**
 * One session over one mailbox: connect, walk the window's envelopes, fetch
 * the sources of the bounce-shaped ones, disconnect.
 *
 * ONE function and ONE login, which is two rules at once.
 *
 * The first is imapflow's, and it is not a style preference: you may not run
 * an IMAP command inside `for await (... of client.fetch(...))`. Commands
 * serialise through a single request queue, and the in-flight FETCH applies
 * backpressure until the consumer advances — so a command issued from inside
 * the loop waits for the loop, which is waiting for the command. Nothing moves
 * until the socket times out, thirty seconds later, and the scan then fails as
 * an unreachable server. That is why the source fetch below runs AFTER the
 * envelope walk has finished, over the UIDs the walk collected, rather than
 * one `fetchOne` per candidate inside it.
 *
 * The second is the spec's: connect once, scan, disconnect. Splitting this
 * into an envelope pass and a bounce pass cost a second login for every
 * mailbox that had a bounce in it, and the IMAP login rate is exactly what
 * providers throttle.
 *
 * The window is filtered HERE as well as asked for. `{ since }` compiles to
 * IMAP's `SINCE`, whose argument is a DATE — on any server without the
 * `WITHIN` capability that means midnight of that day, so the server hands
 * back everything from up to twenty-four hours before the window actually
 * starts. Without the client-side `internalDate >= since` filter below, those
 * extra hours fill the cap first (being older, they come first in sequence
 * order) and the messages the scan exists to read — the last five minutes —
 * are the ones dropped, silently, with the cursor advancing over them. See
 * `messageDate` for why internalDate and never the envelope's own date.
 */
export async function scanInbox(
  cfg: ImapConfig,
  since: Date,
  limits: { envelopes?: number; bounces?: number } = {},
): Promise<MailboxScan> {
  const envelopeLimit = limits.envelopes ?? ENVELOPE_LIMIT;
  const bounceLimit = limits.bounces ?? BOUNCE_LIMIT;

  // Fixed once, before anything is read: the upper end of the window a
  // fallback date may be clamped into. Taken from the clock once rather than
  // per message, so two messages in one scan cannot be ordered by when they
  // happened to be parsed.
  const ceiling = new Date();

  const envelopes: InboxEnvelope[] = [];
  const candidates = new Map<number, InboxEnvelope>();
  const bounces: Array<{ envelope: InboxEnvelope; source: string }> = [];
  let truncated: string | null = null;

  const client = createImapClient(cfg);

  // connect() sits inside this try, not before it. TCP connect and the
  // greeting can succeed and the session negotiation that follows —
  // capability, STARTTLS, authenticate, namespace — can still reject, and a
  // rejected login is exactly where that happens: a wrong password, a
  // revoked app password, IMAP not enabled on the mailbox. imapflow does not
  // close the socket for that rejection path itself, so if connect() were
  // outside the try, closeImapClient() below would never run for it and the
  // connection would leak. Providers cap concurrent connections per mailbox
  // and this worker runs the scan every few minutes, so a single
  // misconfigured mailbox would otherwise accumulate dead connections until
  // the provider starts refusing new ones — which then looks like an
  // unrelated failure.
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // ── pass one: envelopes, and NO other command ────────────────
      // Bodies are not downloaded for ordinary mail: most of what lands in
      // the window is the customer's own correspondence, and pulling it into
      // this process to decide it was not a bounce would be both slow and a
      // breach of the one promise this phase makes about their mailbox.
      for await (const msg of client.fetch(
        { since },
        { uid: true, envelope: true, internalDate: true },
      )) {
        if (envelopes.length >= envelopeLimit) {
          truncated = `stopped after ${envelopeLimit} messages; the rest of this window was not read`;
          break;
        }

        const envelope = toEnvelope(msg, since, ceiling);
        // The SINCE widening, undone. A message the server volunteered from
        // before the window is not this scan's to look at: the scan that
        // owned it has already been and gone, and re-matching it here would
        // re-record a reply the cursor moved past hours ago.
        if (envelope.at.getTime() < since.getTime()) continue;

        envelopes.push(envelope);

        if (!looksLikeBounce(envelope)) continue;
        if (candidates.size >= bounceLimit) {
          truncated =
            `stopped after ${bounceLimit} bounce notifications; ` +
            'the rest of this window was not read';
          break;
        }
        // Collected, not fetched. The fetch is below, once this loop is done.
        candidates.set(msg.uid, envelope);
      }

      // ── pass two: the sources of those candidates, and only those ─
      // Safe here and only here: the generator above has finished, so the
      // request queue is free. One FETCH over the whole UID set rather than
      // one per message — the deadlock is gone either way, but a round trip
      // per bounce is still a round trip per bounce.
      if (candidates.size > 0) {
        for await (const msg of client.fetch(
          [...candidates.keys()],
          { uid: true, source: true },
          { uid: true },
        )) {
          const envelope = candidates.get(msg.uid);
          if (!envelope || !msg.source) continue;
          bounces.push({ envelope, source: msg.source.toString('utf8') });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await closeImapClient(client);
  }

  return { envelopes, bounces, complete: truncated === null, truncated };
}

/**
 * Files copies of sent messages into the mailbox's Sent folder.
 *
 * SMTP only hands a message to the server for delivery — it never puts a
 * copy anywhere. Mail clients do this themselves, which is why messages sent
 * by an app appear nowhere in webmail unless it appends them explicitly.
 *
 * One connection for the whole batch: opening an IMAP session per message
 * would cost more than the send itself, and would multiply the login count
 * that gets a mailbox rate-limited or locked out.
 */
export async function appendToSent(cfg: ImapConfig, messages: Buffer[]): Promise<number> {
  if (messages.length === 0) return 0;

  const client = createImapClient(cfg);
  let saved = 0;

  try {
    await client.connect();
    // Providers disagree on the name — IONOS uses "Sent", Gmail
    // "[Gmail]/Sent Mail". The \Sent special-use flag is the reliable way to
    // find it regardless of provider; the literal name is only a fallback
    // for a server that never sends the flag at all.
    let folder = 'Sent';
    try {
      for (const box of await client.list()) {
        if (box.specialUse === '\\Sent') {
          folder = box.path;
          break;
        }
      }
    } catch {
      /* fall back to the default name */
    }

    for (const raw of messages) {
      try {
        await client.append(folder, raw, ['\\Seen']);
        saved += 1;
      } catch (err) {
        console.error('could not append to', folder, err);
        break; // A folder-level failure will repeat for every remaining message.
      }
    }
  } finally {
    await closeImapClient(client);
  }

  return saved;
}
