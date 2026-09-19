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
//     touch_inbox_scan() holds the cursor only on 'error' and 'incomplete' —
//     every other status advances inbox_last_scan_at, so reporting
//     'unconfigured' for a configured mailbox would step the window straight
//     over mail nobody could read.
//   * Those two cursor-holding statuses mean different things and must stay
//     apart: 'error' is a mailbox that could not be READ (the login, the
//     host), 'incomplete' is one that was read but whose findings could not
//     all be RECORDED. An admin acts on the first and needs to do nothing
//     about the second.
//   * record_inbox_result() returning null means "recorded, but matched
//     nothing". It is not a failure and is never retried: the event row is
//     written either way, and the unmatched bounce is precisely the row that
//     records a suppression we deliberately did not make.
//   * A reply is matched against everything the ORGANISATION sent recently,
//     never against one mailbox's own sends. record_inbox_result() matches
//     organisation-wide, and a narrower read here would drop real replies
//     before the database ever saw them — a pooled campaign sends from
//     whichever mailbox was free, so the reply routinely lands somewhere else.
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
  matchReplies,
  normalizeAddress,
  scanWindow,
} from '@/lib/email/inbox';

import { hasImapHost, imapConfigFor, type ImapConfig, type MailboxScan } from './imap.js';

/* ------------------------------------------------------------------- types */

export interface InboxDeps {
  db: SupabaseClient;
  /**
   * The mailbox read, injected so the cycle can be driven without a server.
   * In production this is `scanInbox` from worker/lib/imap.ts.
   *
   * ONE entry point, called ONCE per mailbox, because one scan is one IMAP
   * session. The pair this replaced — envelopes, then bounce sources — logged
   * in twice for any mailbox that had a bounce in it, and the login rate is
   * the thing providers throttle. The deadlock that pairing hid is described
   * on `scanInbox` itself.
   */
  scan: (cfg: ImapConfig, since: Date) => Promise<MailboxScan>;
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

/**
 * The match set, and whether it is the whole of it. `ok: false` means a page
 * failed, NOT that the organisation has written to nobody — a distinction the
 * cursor depends on.
 */
interface SentAddresses {
  addresses: string[];
  ok: boolean;
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

/**
 * How far back the "who did this organisation write to" read looks.
 *
 * Bounded on purpose. The alternative — every address the organisation has ever
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

  /**
   * The addresses an organisation has written to recently, read at most once
   * per organisation per cycle however many of its mailboxes are scanned.
   *
   * Lazy rather than read up front: an organisation whose inboxes were all
   * empty this pass never needs the list at all, and that is the common case
   * on a five-minute loop.
   *
   * ONLY A SUCCESSFUL READ IS CACHED. A failed one returns `ok: false` and is
   * not remembered, so the next mailbox in the same organisation tries again
   * rather than being served an empty set. Caching the failure would turn one
   * transient database error into "nobody replied" for every mailbox that
   * tenant has, for that whole window — and, before this, into an advanced
   * cursor for each of them too, which is how the replies would have been lost
   * for good rather than merely late.
   */
  const sentByOrg = new Map<string, string[]>();
  const sentAddresses = async (organizationId: string, now: Date): Promise<SentAddresses> => {
    const cached = sentByOrg.get(organizationId);
    if (cached) return { addresses: cached, ok: true };
    const read = await readSentAddresses(deps, note, organizationId, now);
    if (read.ok) sentByOrg.set(organizationId, read.addresses);
    return read;
  };

  for (const row of mailboxes.rows) {
    // Checked before the mailbox, so a stop never lands mid-scan.
    if (stopped(deps)) return result;

    // IMAP is optional and stays optional. No host means this mailbox is not
    // scanned at all — no connection, and no scan recorded: touch_inbox_scan()
    // advances the cursor for every status but 'error', and a mailbox somebody
    // configures an hour from now would then start with a day of its inbox
    // already behind the window.
    // A blank host is no host; `hasImapHost` is the one place that decides.
    if (!hasImapHost(row)) continue;

    // One tenant's unreadable mailbox is one tenant's problem. Without this,
    // the first throw ends the pass for every mailbox ordered after it.
    try {
      await scanMailbox(deps, result, note, row, sentAddresses);
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
    // Offset paging, as in engine.ts: a mailbox added or deleted between pages
    // shifts the window and can skip or repeat one. Recoverable on the next
    // pass — a skipped mailbox keeps its cursor — and the established pattern.
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
 *
 * A scan that read the mailbox but could not finish its work — a
 * record_inbox_result that would not write, a match set that could not be
 * built — does NOT report 'active'. See `incomplete` below.
 */
async function scanMailbox(
  deps: InboxDeps,
  result: InboxResult,
  note: Note,
  row: MailboxRow,
  sentAddresses: (organizationId: string, now: Date) => Promise<SentAddresses>,
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

  const cfg = imapConfigFor(row, password);
  if (!cfg) {
    // Unreachable from the caller above, which skips a mailbox with no host.
    // Thrown rather than defaulted, so a future caller that forgets that
    // filter is a recorded scan failure and not a connection to nowhere.
    throw new Error('this mailbox has no IMAP host');
  }

  // `now` is the scan's own START time, and it is what gets written back as
  // the cursor at the end — not the clock at write time, and not the
  // database's now(). A scan that takes longer than SCAN_OVERLAP_MS (three
  // minutes: a slow mailbox, a stalled fetch, a long recording pass) would
  // otherwise stamp a cursor that is already past mail which arrived WHILE it
  // ran, and the next window would start after it. The overlap exists to
  // absorb seconds, not minutes.
  const now = deps.now();
  const since = scanWindow(row.inbox_last_scan_at ? new Date(row.inbox_last_scan_at) : null, now);

  // One session for the whole mailbox: envelopes and the sources of whatever
  // looked like a bounce, collected inside a single login. See `scanInbox`.
  const scan = await deps.scan(cfg, since);
  const envelopes = scan.envelopes;

  /**
   * True once this scan has failed at any part of its work: a result that
   * would not write, or a match set that could not be built.
   *
   * It decides the status at the end, and it exists because 'active' advances
   * inbox_last_scan_at. The overlap is three minutes against a five-minute
   * loop, so a reply this scan found but failed to record would be behind the
   * next window immediately and gone for good. A scan that did not manage to
   * record what it found did not complete, whatever the mailbox did.
   *
   * Re-reading the same window costs almost nothing: record_inbox_result()
   * coalesces replied_at and bounced_at and inserts the suppression `on
   * conflict do nothing`, so recording the same reply or bounce twice is the
   * same single outcome.
   */
  let incomplete = false;

  // A cap reached inside the session means part of this window was never
  // looked at. Said out loud AND treated as incomplete, which is the opposite
  // of how the address-page cap in readSentAddresses is handled, and the two
  // differ for a reason: that cap is deterministic — the next pass reads the
  // same rows and stops in the same place, so holding the cursor would stall
  // the mailbox permanently. This one is not. A mailbox that took a flood in
  // one window is usually quieter in the next, and the same window re-read
  // then finishes. Advancing over it would lose every message past the cap.
  if (!scan.complete) {
    incomplete = true;
    note(who, `the inbox scan did not finish the window: ${scan.truncated ?? 'a limit was reached'}`);
  }

  // ── replies ──────────────────────────────────────────────────────
  // Only worth a database read when something actually arrived — and the read
  // is the ORGANISATION's, not this mailbox's, so a reply that lands here for
  // a message pooled out through a sibling mailbox is still a reply. See
  // readSentAddresses for why anything narrower is wrong.
  if (envelopes.length > 0) {
    const sentTo = await sentAddresses(row.organization_id, now);
    // A match set that could not be read is not an empty one. Matching what
    // did arrive is still worth doing — recording is idempotent — but this
    // scan cannot claim to have looked at everything, so the cursor is held
    // and the same window is read again next pass.
    if (!sentTo.ok) incomplete = true;
    for (const reply of matchReplies(envelopes, sentTo.addresses)) {
      const recorded = await record(deps, note, row, 'reply', reply.address, reply.at, who);
      if (recorded) result.replies += 1;
      else incomplete = true;
    }
  }

  // ── bounces ──────────────────────────────────────────────────────
  // Already downloaded, in the same session, and only for the envelopes
  // `looksLikeBounce` accepted — which is the whole reason bodies are not
  // pulled for ordinary mail: most of what lands in the window is the
  // customer's own correspondence.
  for (const candidate of scan.bounces) {
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
    else incomplete = true;
  }

  // Last, and only once everything above has been read AND written: 'active'
  // advances the cursor, so anything still outstanding when it runs is behind
  // the window for good.
  if (incomplete) {
    // The mailbox itself was readable — this is not an IMAP fault and the
    // reasons are already in `errors` — but the window has not been fully
    // dealt with, so it is held for the next pass.
    //
    // 'incomplete', never 'error': both hold the cursor (migration 157e), and
    // they are separate statuses because an admin reads them. 'error' means go
    // and check the host and the app password; saying it here would send
    // someone to re-enter a password that was never wrong, over what is
    // usually a database blip.
    const detail =
      'The mailbox was read, but what the scan found could not all be recorded. ' +
      'The same window will be read again; sending is unaffected.';
    await touch(deps, note, row, 'incomplete', detail, who, now);
    return;
  }

  await touch(deps, note, row, 'active', null, who, now);
  result.scanned += 1;
}

/**
 * The distinct addresses this ORGANISATION sent to recently, which is what an
 * incoming sender is matched against.
 *
 * Scoped to the organisation, deliberately, and not to the mailbox being
 * scanned. record_inbox_result() matches an address against everything the
 * organisation sent (migration 157d, and it says why: a pooled campaign sends
 * from whichever mailbox was free, and a reply goes wherever From or Reply-To
 * pointed). A per-mailbox read here would make the worker strictly narrower
 * than the gate behind it, and silently: a reply arriving in mailbox A to a
 * message pooled out through mailbox B would be dropped before the database
 * ever saw it. Pooled sending is the whole point of the mailbox pool, so that
 * is not an edge case — and anyone we mailed writing to any of our connected
 * mailboxes is a reply by any reasonable reading.
 *
 * Read once per organisation per cycle and shared by its mailboxes, so
 * widening the scope makes FEWER reads than the per-mailbox version, not more.
 *
 * Bounded by SENT_LOOKBACK_MS — see the constant for why an unbounded read is
 * not an option.
 *
 * On the index: this predicate is exactly what
 * idx_email_messages_org_sent_at — (organization_id, sent_at desc), migration
 * 157b — exists for, and the comment there explains why the other two
 * candidates cannot serve it. Both of the columns filtered on are in it, and
 * the ORDER matches it too: `sent_at desc` first, `id` only as the tiebreak
 * that makes the paging stable. Ordering by `id` alone, as an earlier revision
 * did, would have made the planner sort the whole matched set on every page —
 * the filter would narrow inside the index and the ordering would throw the
 * benefit away. If this read ever needs to be cheaper still, the next step is
 * a `select distinct` view, NOT a narrower scope — that would re-open the gap
 * above.
 *
 * Returns `ok: false` when a page failed, with whatever was collected. The
 * caller must not treat that as "nobody was written to": it holds the
 * mailbox's cursor so the same window is read again, and the cycle does not
 * cache it, so the next mailbox in this organisation retries the read.
 */
async function readSentAddresses(
  deps: InboxDeps,
  note: Note,
  organizationId: string,
  now: Date,
): Promise<SentAddresses> {
  const floor = new Date(now.getTime() - SENT_LOOKBACK_MS).toISOString();
  const addresses = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    // Offset paging, as in engine.ts: a row inserted or deleted between pages
    // shifts the window and can skip or repeat one. Recoverable — the next
    // pass reads the same thirty days — and the established pattern here.
    const res = await deps.db
      .from('email_messages')
      .select('id, to_email')
      .eq('organization_id', organizationId)
      .gte('sent_at', floor)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (res.error) {
      note(
        `organisation ${organizationId}`,
        `the recently sent addresses could not be read: ${res.error.message}`,
      );
      return { addresses: [...addresses], ok: false };
    }

    const batch = (res.data ?? []) as unknown as Array<{ to_email: string | null }>;
    for (const sent of batch) if (sent.to_email) addresses.add(sent.to_email);
    if (batch.length === 0) break;
    offset += batch.length;

    // Said out loud rather than truncating in silence: past this point the
    // match set is incomplete, so a genuine reply can go unrecognised and
    // nothing else in the system would ever say why.
    //
    // Reported but NOT `ok: false`, which is the one place those two come
    // apart. A failed page is transient and worth retrying, so it holds the
    // cursor. Hitting the page cap is deterministic: the next pass reads the
    // same first 50,000 addresses and stops in the same place, so holding the
    // cursor for it would stall that mailbox permanently instead of fixing
    // anything. The fix for this one is a `select distinct` read, not a retry.
    if (page === MAX_PAGES - 1) {
      note(
        `organisation ${organizationId}`,
        `stopped after ${MAX_PAGES} pages of recently sent addresses; replies to anything ` +
          'past that were not matched this cycle',
      );
    }
  }

  return { addresses: [...addresses], ok: true };
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
  /**
   * Never 'unconfigured': a mailbox with no host reaches no scan at all, and
   * that status advances the cursor. 'error' is a mailbox that could not be
   * read; 'incomplete' is one that was read but not fully recorded. Both hold
   * the cursor, and they stay apart because the Accounts screen shows them.
   */
  status: 'active' | 'error' | 'incomplete',
  error: string | null,
  who: string,
  /**
   * The moment this scan STARTED, which is what the cursor becomes on a status
   * that advances it. Null only where there is nothing to advance to — a
   * failure recorded before a window was ever worked out — and the function
   * then falls back to its own now(), which is what it used to do for
   * everything. See migration 157e for why the start time and not the finish:
   * mail that arrives while a slow scan is running is behind the cursor the
   * moment that scan writes the clock instead of its window.
   */
  scannedAt: Date | null = null,
): Promise<void> {
  try {
    const { error: rpcError } = await deps.db.rpc('touch_inbox_scan', {
      p_account: row.id,
      p_status: status,
      p_error: error,
      p_scanned_at: scannedAt ? scannedAt.toISOString() : null,
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
