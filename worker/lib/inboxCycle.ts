// The inbox cycle: one pass over every mailbox that has an IMAP host.
//
// It is the mirror of engine.ts. Where the send cycle writes outwards, this
// one reads back the two facts a send can never report on its own — the
// recipient replied, or the message bounced some time after SMTP accepted it —
// and hands each of them to record_inbox_result() (migration 157).
//
// Everything with a side effect — the database, the two IMAP reads, the clock
// — arrives through `InboxDeps`, so `runInboxCycle` runs end to end in
// tests/unit/emailInboxCycle.test.ts with no network, no database and no mail
// server. No decision about what an envelope MEANS lives here either: that is
// src/lib/email/inbox.ts, the same way worker/lib/imap.ts holds the connection
// and none of the meaning.
//
// The rules that shape the code below, and must not be quietly undone:
//
//   * An IMAP failure must never affect sending. Nothing in this file writes
//     `status`, `is_active` or `consecutive_failures`, and nothing calls
//     record_mailbox_failure(). Those three are what claim_email_batch() reads
//     to decide whether a mailbox may send, and reading a mailbox and sending
//     from it are separate permissions at every provider: Google and Zoho both
//     issue app passwords with IMAP left disabled. A mailbox nobody can read
//     may still deliver perfectly well, and pausing the pool over an unreadable
//     inbox would be a self-inflicted outage. The inbox's own outcome goes to
//     touch_inbox_scan() and nowhere else.
//   * A mailbox with no imap_host is skipped WITHOUT recording a scan.
//     'unconfigured' is never reported for a mailbox that has a host, because
//     touch_inbox_scan() holds the cursor only on 'error' — every other status
//     advances inbox_last_scan_at, so reporting 'unconfigured' for a configured
//     mailbox would step the window straight over mail nobody could read.
//   * record_inbox_result() returning null means "recorded, but matched
//     nothing". It is not a failure and is never retried: the event row is
//     written either way, and the unmatched bounce is precisely the row that
//     records a suppression we deliberately did not make.
//   * A bounce suppresses only on a match, and that gate is IN THE SQL — the
//     insert selects the matched message's own to_email, so with no match there
//     is nothing to insert. This file's job is to pass the extracted address.
//     Do not add a second gate here and do not work around the one there.
//   * Nothing logged or recorded from here may carry a message body, a subject
//     line, a password or a recipient list. Addresses appear one at a time, in
//     a count or in a single-line error.
//   * One mailbox cannot end the cycle. Each runs in its own try/catch, and a
//     failed scan is recorded and stepped past — the next mailbox is somebody
//     else's tenant.

import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptSecret } from '@/lib/email/crypto';
import { classifyImapError, friendlyImapError } from '@/lib/email/imapErrors';
import {
  extractBouncedAddress,
  looksLikeBounce,
  matchReplies,
  normalizeAddress,
  scanWindow,
} from '@/lib/email/inbox';
import type { InboxEnvelope } from '@/lib/email/types';

import type { ImapConfig } from './imap.js';

/* ------------------------------------------------------------------- types */

export interface InboxDeps {
  db: SupabaseClient;
  /**
   * The two IMAP reads, injected so the cycle can be driven without a server.
   * In production these are `fetchRecentEnvelopes` and `fetchBounceSources`
   * from worker/lib/imap.ts.
   */
  connect: {
    envelopes: (cfg: ImapConfig, since: Date) => Promise<InboxEnvelope[]>;
    bounces: (cfg: ImapConfig, since: Date) => Promise<Array<{ envelope: InboxEnvelope; source: string }>>;
  };
  now: () => Date;
  env: { tokenKey: string };
  /**
   * True once the process has been asked to stop. Checked BETWEEN mailboxes
   * only, never inside one: a scan that recorded its replies and then stopped
   * before reading its bounces must not report 'active', because that advances
   * the cursor past bounces it never fetched. One mailbox is the unit of work.
   */
  shouldStop?: () => boolean;
}

export interface InboxResult {
  /** Mailboxes scanned to completion this pass. */
  scanned: number;
  /** Reply events recorded — matched or not; the SQL decides which. */
  replies: number;
  /** Bounce events recorded — likewise. */
  bounces: number;
  /** Distinct failure reasons, each naming the mailbox that produced it. */
  errors: string[];
}

interface MailboxRow {
  id: string;
  organization_id: string;
  from_email: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  smtp_username: string;
  inbox_last_scan_at: string | null;
}

/**
 * The columns a scan needs. There is no imap_username column on purpose: the
 * same credential serves both protocols (migration 157a), so the SMTP username
 * and the stored secret are what the IMAP login uses too.
 */
const MAILBOX_COLUMNS =
  'id, organization_id, from_email, imap_host, imap_port, imap_secure, smtp_username, inbox_last_scan_at';

/** PostgREST returns 1000 rows by default, so every read here is paged explicitly. */
const PAGE_SIZE = 1000;
/** A stop for a page that never shrinks; 50 pages is 50,000 rows. */
const MAX_PAGES = 50;

/** The defaults migration 157 gives the columns, for a row read before they applied. */
const DEFAULT_IMAP_PORT = 993;

/**
 * How far back the "who did this mailbox write to" read looks.
 *
 * Bounded on purpose. The alternative — every address this mailbox has ever
 * sent to — is the one thing here that grows without limit: a customer's
 * message history only ever gets longer, so an unbounded read would get slower
 * every day and would eventually dominate a cycle that is supposed to be
 * cheap, for rows that can no longer produce a reply anyway. Thirty days is
 * comfortably longer than the day the scan window itself can ever cover
 * (FIRST_SCAN_LOOKBACK_MS), so nothing inside a scan's reach is missed by it.
 */
const SENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const short = (err: unknown): string =>
  String((err as { message?: string } | null)?.message ?? err)
    .replace(/\s+/g, ' ')
    .slice(0, 500);

const stopped = (deps: InboxDeps): boolean => deps.shouldStop?.() === true;

type Note = (scope: string, message: string) => void;

/* ------------------------------------------------------------------- cycle */

export async function runInboxCycle(deps: InboxDeps): Promise<InboxResult> {
  const result: InboxResult = { scanned: 0, replies: 0, bounces: 0, errors: [] };

  // Deduplicated per mailbox, as in the send cycle: one bad password is one
  // problem however many times it is hit.
  const seen = new Set<string>();
  const note: Note = (scope, message) => {
    const line = `${scope}: ${message}`;
    if (seen.has(line)) return;
    seen.add(line);
    result.errors.push(line);
  };

  const mailboxes = await readMailboxes(deps);
  if (mailboxes.error) {
    note('email_accounts', mailboxes.error);
    return result;
  }
  // Reported, not fatal: the mailboxes that were read are still scanned, and
  // the rest keep their cursors and are picked up next pass.
  if (mailboxes.truncated) note('email_accounts', mailboxes.truncated);

  for (const row of mailboxes.rows) {
    // Checked before the mailbox, so a stop never lands mid-scan.
    if (stopped(deps)) return result;

    // IMAP is optional and stays optional. No host means this mailbox is not
    // scanned at all — no connection, and no scan recorded: touch_inbox_scan()
    // advances the cursor for every status but 'error', and a mailbox somebody
    // configures an hour from now would then start with a day of its inbox
    // already behind the window.
    if (!row.imap_host || row.imap_host.trim() === '') continue;

    // One tenant's unreadable mailbox is one tenant's problem. Without this,
    // the first throw ends the pass for every mailbox ordered after it.
    try {
      await scanMailbox(deps, result, note, row);
    } catch (err) {
      await recordFailure(deps, note, row, err);
    }
  }

  return result;
}

/**
 * Reads the mailboxes worth scanning, a page at a time. Without an explicit
 * range PostgREST stops at 1000 rows and the tenants past that boundary would
 * simply never be scanned — silently, and worse as the product grows. `id` is
 * unique, so the paging is stable.
 *
 * The `imap_host is not null` filter is applied by the server so a deployment
 * with thousands of SMTP-only mailboxes does not page through all of them to
 * find the handful with an inbox; the loop above re-checks the value anyway,
 * because skipping an unconfigured mailbox is a correctness rule, not an
 * optimisation.
 */
async function readMailboxes(
  deps: InboxDeps,
): Promise<{ rows: MailboxRow[]; error: string | null; truncated: string | null }> {
  const rows: MailboxRow[] = [];
  // Advanced by what actually came back, never by PAGE_SIZE: PostgREST's
  // `db-max-rows` is a server setting, and on a project configured below this
  // constant a fixed stride would step straight over the rows the server
  // withheld — the very gap paging is here to close.
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await deps.db
      .from('email_accounts')
      .select(MAILBOX_COLUMNS)
      .not('imap_host', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (res.error) return { rows, error: res.error.message, truncated: null };

    const batch = (res.data ?? []) as unknown as MailboxRow[];
    rows.push(...batch);
    // Keep going while anything at all comes back, and stop on the first empty
    // page, so the loop cannot end early against a smaller server cap.
    if (batch.length === 0) return { rows, error: null, truncated: null };
    offset += batch.length;
  }

  return {
    rows,
    error: null,
    truncated:
      `stopped after ${MAX_PAGES} pages (${rows.length} rows) of email_accounts; ` +
      'the rest were not scanned this cycle',
  };
}

/**
 * One mailbox's scan: open its credential, work out the window, read the
 * envelopes, record what they mean, and record the scan itself.
 *
 * Throws on anything that goes wrong with the connection; the caller turns
 * that into a recorded 'error' and moves on.
 */
async function scanMailbox(
  deps: InboxDeps,
  result: InboxResult,
  note: Note,
  row: MailboxRow,
): Promise<void> {
  // The mailbox is named by its address in every error: a label is free text
  // and two mailboxes can share one, but the address is what an admin has to
  // go and fix.
  const who = row.from_email;

  const secretRes = await deps.db
    .from('email_account_secrets')
    .select('secret_encrypted')
    .eq('account_id', row.id)
    .single();
  if (secretRes.error || !secretRes.data) {
    // Recorded as a failed scan, not as 'unconfigured': there IS a host, so
    // there is mail behind this window that nobody read, and the cursor has to
    // stay where it is until the credential can be opened again.
    throw new Error(secretRes.error?.message ?? 'this mailbox has no stored password');
  }

  let password: string;
  try {
    password = await decryptSecret(
      String((secretRes.data as { secret_encrypted: string }).secret_encrypted),
      deps.env.tokenKey,
    );
  } catch (err) {
    // Never echo the stored value: the reason it would not decrypt is not
    // worth leaking a credential over.
    throw new Error(`the stored password could not be decrypted (${short(err)})`);
  }

  const cfg: ImapConfig = {
    host: String(row.imap_host),
    port: row.imap_port ?? DEFAULT_IMAP_PORT,
    secure: row.imap_secure ?? true,
    user: row.smtp_username,
    password,
  };

  const now = deps.now();
  const since = scanWindow(row.inbox_last_scan_at ? new Date(row.inbox_last_scan_at) : null, now);

  const envelopes = await deps.connect.envelopes(cfg, since);

  // ── replies ──────────────────────────────────────────────────────
  // Only worth a database read when something actually arrived.
  if (envelopes.length > 0) {
    const sentTo = await readSentAddresses(deps, note, row, now, who);
    for (const reply of matchReplies(envelopes, sentTo)) {
      const recorded = await record(deps, note, row, 'reply', reply.address, reply.at, who);
      if (recorded) result.replies += 1;
    }
  }

  // ── bounces ──────────────────────────────────────────────────────
  // The bounce read opens its own connection and downloads message SOURCES, so
  // it is only made when this window actually holds something bounce-shaped.
  // `looksLikeBounce` decides that from the envelope alone, which is the whole
  // reason bodies are not pulled for ordinary mail: most of what lands in the
  // window is the customer's own correspondence.
  if (envelopes.some(looksLikeBounce)) {
    for (const candidate of await deps.connect.bounces(cfg, since)) {
      const address = extractBouncedAddress(candidate.source);
      // Nothing recognisable in the notification. There is no address to
      // record an event against, so this one is simply not ours to act on.
      if (!address) continue;
      // The address goes to the SQL exactly as extracted (normalised only for
      // shape). Whether it suppresses anything is decided THERE, by the match
      // — see the rules at the top of this file.
      const recorded = await record(
        deps,
        note,
        row,
        'bounce',
        normalizeAddress(address) || address,
        candidate.envelope.at,
        who,
      );
      if (recorded) result.bounces += 1;
    }
  }

  // Last, and only once everything above has been read: this advances the
  // cursor, so anything not yet fetched when it runs is behind the window for
  // good.
  await touch(deps, note, row, 'active', null, who);
  result.scanned += 1;
}

/**
 * The distinct addresses this mailbox sent to recently, which is what an
 * incoming sender is matched against.
 *
 * Bounded by SENT_LOOKBACK_MS — see the constant for why an unbounded read is
 * not an option. Filtered by (sent_account_id, sent_at), which is exactly the
 * index migration 156 created for mailbox_status.sent_today and which
 * migration 157 notes serves this read too.
 *
 * A failed read is reported and answered with what was collected rather than
 * aborting the scan: a missed reply is recoverable on the next pass, and the
 * bounce half of this mailbox's scan is unaffected by it.
 */
async function readSentAddresses(
  deps: InboxDeps,
  note: Note,
  row: MailboxRow,
  now: Date,
  who: string,
): Promise<string[]> {
  const floor = new Date(now.getTime() - SENT_LOOKBACK_MS).toISOString();
  const addresses = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await deps.db
      .from('email_messages')
      .select('id, to_email')
      .eq('sent_account_id', row.id)
      .gte('sent_at', floor)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (res.error) {
      note(who, `the recently sent addresses could not be read: ${res.error.message}`);
      break;
    }

    const batch = (res.data ?? []) as unknown as Array<{ to_email: string | null }>;
    for (const sent of batch) if (sent.to_email) addresses.add(sent.to_email);
    if (batch.length === 0) break;
    offset += batch.length;
  }

  return [...addresses];
}

/**
 * One recognised reply or bounce, settled through the single call that writes
 * the message, the suppression and the event together.
 *
 * Returns whether the call reached the database — NOT whether it matched
 * anything. A null return from the function is the ordinary "recorded, but
 * matched nothing" answer: a reply from someone this organization never mailed,
 * or a bounce for an address it never sent to. The event row is written either
 * way, and the unmatched bounce is the row that answers "we saw this and
 * deliberately suppressed nothing". Retrying it, or treating it as an error,
 * would both be wrong.
 */
async function record(
  deps: InboxDeps,
  note: Note,
  row: MailboxRow,
  kind: 'reply' | 'bounce',
  address: string,
  at: Date,
  who: string,
): Promise<boolean> {
  try {
    const { error } = await deps.db.rpc('record_inbox_result', {
      p_account: row.id,
      p_kind: kind,
      p_address: address,
      p_at: at.toISOString(),
      // Never a subject and never a body: the detail says which mailbox saw it
      // and nothing about what it said.
      p_detail: `seen in ${who}`,
    });
    if (!error) return true;
    note(who, `a ${kind} could not be recorded: ${error.message}`);
  } catch (err) {
    // postgrest-js answers with `{ error }` rather than rejecting, but only
    // until someone sets throwOnError() or the fetch itself fails. A rejection
    // here must not escape into the mailbox's catch, where a database problem
    // would be misread as an IMAP failure and recorded against the inbox.
    note(who, `a ${kind} could not be recorded: ${short(err)}`);
  }
  return false;
}

/**
 * The scan's own outcome. This is the ONLY thing this file writes about a
 * mailbox, and touch_inbox_scan() deliberately writes none of the three
 * columns the send path reads — see the rules at the top.
 */
async function touch(
  deps: InboxDeps,
  note: Note,
  row: MailboxRow,
  status: 'active' | 'error',
  error: string | null,
  who: string,
): Promise<void> {
  try {
    const { error: rpcError } = await deps.db.rpc('touch_inbox_scan', {
      p_account: row.id,
      p_status: status,
      p_error: error,
    });
    if (rpcError) note(who, `the scan result could not be recorded: ${rpcError.message}`);
  } catch (err) {
    note(who, `the scan result could not be recorded: ${short(err)}`);
  }
}

/**
 * A failed scan: one readable sentence for the admin, and 'error' — the status
 * that holds inbox_last_scan_at still, so the first scan after the repair
 * covers the outage instead of stepping over it.
 *
 * Nothing here charges the failure to the send path.
 */
async function recordFailure(
  deps: InboxDeps,
  note: Note,
  row: MailboxRow,
  err: unknown,
): Promise<void> {
  const who = row.from_email;
  // The classification is what tells an admin apart from an outage: only 'auth'
  // is a setting somebody has to change, and it would otherwise read like a
  // network blip that might clear on its own. It never changes the status
  // written — 'error' is the only failure state the column has, and that is
  // deliberate, because a mailbox whose inbox cannot be read keeps sending.
  const outcome = classifyImapError(err);
  const friendly = friendlyImapError(err, row.imap_host ?? undefined)
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  const detail =
    outcome === 'auth'
      ? `${friendly} Scans keep failing until the credential is fixed; sending is unaffected.`
      : friendly;

  note(who, detail);
  await touch(deps, note, row, 'error', detail, who);
}
