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

function toEnvelope(msg: FetchMessageObject): InboxEnvelope {
  const date = msg.envelope?.date;
  return {
    from: msg.envelope?.from?.[0]?.address ?? '',
    subject: msg.envelope?.subject ?? '',
    at: date instanceof Date ? date : date ? new Date(date) : new Date(),
  };
}

/**
 * Envelope senders and subjects of INBOX messages received since `since`,
 * newest scan window first. Envelopes only — bodies are never downloaded,
 * which keeps the scan fast and keeps the customer's mail out of our
 * process. Everything downstream (matching a reply to a sent address) works
 * from these envelopes alone; see matchReplies in src/lib/email/inbox.ts.
 */
export async function fetchRecentEnvelopes(
  cfg: ImapConfig,
  since: Date,
  limit = 500,
): Promise<InboxEnvelope[]> {
  const client = createImapClient(cfg);
  const out: InboxEnvelope[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const msg of client.fetch({ since }, { envelope: true })) {
        out.push(toEnvelope(msg));
        if (out.length >= limit) break;
      }
    } finally {
      lock.release();
    }
  } finally {
    await closeImapClient(client);
  }

  return out;
}

/**
 * Envelope and raw source of INBOX messages received since `since` that
 * look like bounces, up to `limit` such messages.
 *
 * `looksLikeBounce` decides that from the envelope alone (sender, subject),
 * so a message's body is downloaded only once its envelope has already been
 * accepted. Downloading every body to make that call would pull the
 * customer's private mail into this process for no reason — most INBOX
 * traffic in the scan window is ordinary replies, not bounces — and would
 * slow the scan down for every one of them. Pulling the failed address back
 * out of `source` is `extractBouncedAddress`'s job, not this module's.
 */
export async function fetchBounceSources(
  cfg: ImapConfig,
  since: Date,
  limit = 200,
): Promise<Array<{ envelope: InboxEnvelope; source: string }>> {
  const client = createImapClient(cfg);
  const out: Array<{ envelope: InboxEnvelope; source: string }> = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const msg of client.fetch({ since }, { envelope: true })) {
        if (out.length >= limit) break;

        const envelope = toEnvelope(msg);
        if (!looksLikeBounce(envelope)) continue;

        const full = await client.fetchOne(msg.uid, { source: true }, { uid: true });
        if (!full || !full.source) continue;
        out.push({ envelope, source: full.source.toString('utf8') });
      }
    } finally {
      lock.release();
    }
  } finally {
    await closeImapClient(client);
  }

  return out;
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

  await client.connect();
  try {
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
