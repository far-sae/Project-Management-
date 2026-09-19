// The send cycle: one pass over every organisation's mailbox pool.
//
// Everything with a side effect — the database, SMTP, DNS, the clock, the
// sleeps — arrives through `CycleDeps`, so `runCycle` can be driven end to end
// by tests/unit/emailEngine.test.ts with no network, no database and no mail
// server. That is also why this module imports no Node-only API of its own.
//
// The rules that shape the code below, and must not be quietly undone:
//
//   * A claimed row is settled through ONE call to record_send_result(). The
//     Vercel tick this replaces wrote the status and then the provider message
//     id separately, and a failure between the two left the row in 'sending'
//     until the recovery sweep found it. A 'sent' settlement that fails is
//     RETRIED — the same call, to the same fixed state — never split in two.
//   * Settlements are never batched into one transaction. record_send_result()
//     raises on an outcome it does not know, and a raise inside a batch would
//     roll back every settlement in it.
//   * The only outcomes it knows are 'sent', 'transient', 'permanent' and
//     'hard_bounce' — classifySmtpError()'s three returns, plus 'sent'.
//   * A failure that is the MAILBOX's — a rejected login, a connection that
//     never came up — is never charged to whichever recipient happened to be
//     first in the batch. That row is handed back like the rest of the batch
//     and the strike goes to record_mailbox_failure() instead, which is the
//     one place the three-strike pause is implemented.
//   * Which of those it is depends on POSITION, not only on the error code.
//     Nodemailer labels a socket that goes quiet mid-DATA exactly as it labels
//     a connect that never completed, so `isMailboxFault` is told how many
//     messages this transport has already had accepted. Before the first one,
//     the connection is the suspect; after it, the host is demonstrably
//     reachable and the same code is about the message in flight.
//   * A mailbox's secret is decrypted BEFORE its budget is claimed, so a
//     credential the worker cannot read leaves the queue untouched instead of
//     stranding rows behind a mailbox that was never going to send them.
//   * One tenant cannot take down the cycle. Each organisation and each
//     mailbox runs inside its own try/catch, because a thrown error — an
//     invalid timezone, a transport that will not construct — would otherwise
//     end the pass for every organisation iterated after it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

import { decryptSecret } from '@/lib/email/crypto';
import { blockedReason, selectMailboxes } from '@/lib/email/mailboxPool';
import { buildMessage, type BuiltMessage } from '@/lib/email/message';
import { describeSendWindow, isWithinSendWindow } from '@/lib/email/sendWindow';
import {
  classifySmtpError,
  friendlySmtpError,
  isMailboxFault,
  providerOf,
} from '@/lib/email/smtpErrors';
import type {
  AccountStatus,
  CampaignKind,
  EmailSettings,
  MailboxHealth,
  SendWindow,
} from '@/lib/email/types';
import { signUnsubscribeToken, unsubscribeUrl } from '@/lib/email/unsubscribe';

import { domainOfEmail } from './dns.js';
import { imapConfigFor, type ImapConfig } from './imap.js';
import type { SmtpConfig } from './mailer.js';

/* ------------------------------------------------------------------- types */

export interface CycleDeps {
  db: SupabaseClient;
  createTransport: (cfg: SmtpConfig) => Transporter;
  /**
   * The exact bytes a message is sent as. In production this is `buildRaw`
   * from worker/lib/mailer.ts; it is injected for the same reason everything
   * else here is, so the cycle can be driven with no nodemailer at all.
   */
  buildRaw: (mail: Mail.Options) => Promise<Buffer>;
  /**
   * Files copies of sent messages in the mailbox's own Sent folder. In
   * production this is `appendToSent` from worker/lib/imap.ts — injected
   * because it opens a socket, which the tests must never do.
   */
  appendToSent: (cfg: ImapConfig, messages: Buffer[]) => Promise<number>;
  domainAcceptsMail: (domain: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  env: { tokenKey: string; unsubscribeSecret: string; siteUrl: string };
  /** The per-organisation budget for this cycle, so one tenant cannot starve the rest. */
  maxPerCycle: number;
  /**
   * True once the process has been asked to stop. Checked between
   * organisations, between mailboxes and between messages: a batch of 50 at up
   * to 25s of jitter runs far longer than a container shutdown grace period,
   * so a cycle that only checked at its end would be SIGKILLed mid-batch with
   * rows still claimed.
   */
  shouldStop?: () => boolean;
}

export interface CycleResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Why nothing was claimed, when nothing was. Null whenever anything was. */
  blocked: string | null;
  /** Distinct failure reasons, each naming the mailbox that produced it. */
  errors: string[];
}

/** The four outcomes record_send_result() accepts. Anything else raises there. */
type Outcome = 'sent' | 'transient' | 'permanent' | 'hard_bounce';

interface MailboxStatusRow {
  id: string;
  organization_id: string;
  label: string;
  from_email: string;
  status: AccountStatus;
  is_active: boolean;
  paused_reason: string | null;
  consecutive_failures: number;
  last_sent_at: string | null;
  effective_limit: number;
  sent_today: number;
}

interface EmailSettingsRow {
  organization_id: string;
  send_window_enabled: boolean;
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  send_timezone: string;
  jitter_min_ms: number;
  jitter_max_ms: number;
}

interface AccountRow {
  id: string;
  from_name: string | null;
  from_email: string;
  reply_to: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
  // IMAP is optional, and everything here works without it: these three are
  // read only so a delivered message can be filed in this mailbox's own Sent
  // folder. `ImapAccountColumns` in worker/lib/imap.ts is the same set, and
  // `imapConfigFor` is the one place that turns them into a login.
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  // The mailbox's own override for fileSentCopies' append, independent of
  // imap_host being set at all and of the automatic Google skip below it.
  // `boolean | null | undefined` rather than a bare `boolean`: the column
  // defaults to true (migration 157), but a row read through a narrower
  // select — or a test fixture that predates this field — simply omits it,
  // and that must read as "on", never as "off by accident".
  sent_folder_enabled?: boolean | null;
}

interface CampaignRow {
  id: string;
  kind: CampaignKind;
  subject: string;
  body_html: string;
}

interface ClaimedRow {
  message_id: string;
  campaign_id: string;
  organization_id: string;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  attempts: number;
}

/** The columns of email_accounts the send needs; the pool data comes from the view. */
const ACCOUNT_COLUMNS =
  'id, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_secure, smtp_username, ' +
  'imap_host, imap_port, imap_secure, sent_folder_enabled';

/** PostgREST returns 1000 rows by default, so both reads are paged explicitly. */
const PAGE_SIZE = 1000;
/** A stop for a page that never shrinks; 50 pages is 50,000 mailboxes. */
const MAX_PAGES = 50;

/**
 * How long the whole Sent-folder append may take before the cycle walks away
 * from it.
 *
 * The worker is ONE sequential loop across every organisation, so anything
 * unbounded here is paid by every other customer's queue. imapflow's own
 * timers are per operation, not per session: a server that accepts a
 * connection and then stalls costs the greeting timeout plus a socket timeout
 * for the folder list, for each append and for the logout — minutes, for one
 * mailbox, filing copies of messages that were all delivered already.
 *
 * Generous against the real thing (ten small messages over one open session is
 * seconds) and an order of magnitude under what an unbounded stall can cost.
 */
const SENT_APPEND_TIMEOUT_MS = 30_000;

/** Attempts at a 'sent' settlement, and the pause before the 2nd and 3rd. */
const SETTLE_ATTEMPTS = 3;
const SETTLE_BACKOFF_MS = [200, 1_000];

/* ---------------------------------------------------------------- defaults */

// email_settings has no row until someone saves one, so a missing row means
// the column defaults from migration 156 — not "no window" and not a row the
// worker writes for itself. These five must stay in step with that table.
const DEFAULT_WINDOW: SendWindow = {
  enabled: true,
  startHour: 8,
  endHour: 18,
  days: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};
const DEFAULT_JITTER_MIN_MS = 8_000;
const DEFAULT_JITTER_MAX_MS = 25_000;

function toSettings(organizationId: string, row: EmailSettingsRow | undefined): EmailSettings {
  if (!row) {
    return {
      organizationId,
      window: { ...DEFAULT_WINDOW, days: [...DEFAULT_WINDOW.days] },
      jitterMinMs: DEFAULT_JITTER_MIN_MS,
      jitterMaxMs: DEFAULT_JITTER_MAX_MS,
    };
  }
  return {
    organizationId,
    window: {
      enabled: row.send_window_enabled,
      startHour: row.send_window_start,
      endHour: row.send_window_end,
      days: row.send_days ?? [...DEFAULT_WINDOW.days],
      timezone: row.send_timezone || DEFAULT_WINDOW.timezone,
    },
    jitterMinMs: row.jitter_min_ms,
    jitterMaxMs: row.jitter_max_ms,
  };
}

/**
 * `send_timezone` is plain text with no constraint, and `Intl.DateTimeFormat`
 * throws RangeError on a name it does not know — which, inside the window
 * check, would end the cycle for every organisation after this one. One
 * tenant's typo degrades that tenant to UTC instead.
 */
function withUsableTimezone(window: SendWindow, onInvalid: (message: string) => void): SendWindow {
  try {
    // The same construction isWithinSendWindow makes, so it fails here or not
    // at all.
    new Intl.DateTimeFormat('en-US', {
      timeZone: window.timezone,
      hour: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    return window;
  } catch {
    onInvalid(
      `send_timezone "${window.timezone}" is not a timezone this runtime knows; ` +
        'the send window was read in UTC instead. Fix it in email settings.',
    );
    return { ...window, timezone: DEFAULT_WINDOW.timezone };
  }
}

function toMailboxHealth(row: MailboxStatusRow): MailboxHealth {
  return {
    id: row.id,
    label: row.label,
    fromEmail: row.from_email,
    isActive: row.is_active,
    pausedReason: row.paused_reason,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at) : null,
    effectiveLimit: row.effective_limit,
    sentToday: row.sent_today,
  };
}

/** Perfectly regular timing is itself a spam signal, so every gap is drawn fresh. */
function jitterMs(settings: EmailSettings): number {
  const min = Math.max(0, settings.jitterMinMs);
  const max = Math.max(min, settings.jitterMaxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

const short = (err: unknown): string =>
  String((err as { message?: string } | null)?.message ?? err).slice(0, 500);

const stopped = (deps: CycleDeps): boolean => deps.shouldStop?.() === true;

/* ------------------------------------------------------------------- cycle */

export async function runCycle(deps: CycleDeps): Promise<CycleResult> {
  const result: CycleResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    blocked: null,
    errors: [],
  };

  // Deduplicated per mailbox: 500 recipients failing on one bad password is
  // one problem, not 500.
  const seen = new Set<string>();
  const note = (scope: string, message: string) => {
    const line = `${scope}: ${message}`;
    if (seen.has(line)) return;
    seen.add(line);
    result.errors.push(line);
  };

  const reasons: string[] = [];
  const noteBlocked = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  try {
    await drain(deps, result, note, noteBlocked);
  } finally {
    // Recompute every in-flight campaign's counters and close the ones with
    // nothing outstanding. This runs on every cycle, including one that
    // claimed nothing: a campaign whose last recipients were all suppressed
    // never gets another claim, so that is the only cycle that can close it.
    const { error } = await deps.db.rpc('finalize_email_campaigns');
    if (error) note('campaign rollup', error.message);
  }

  // `blocked` explains an empty cycle. Once anything has been claimed there is
  // nothing to explain, even if some other organisation was outside its window.
  result.blocked = result.claimed > 0 ? null : (reasons[0] ?? null);
  return result;
}

type Note = (scope: string, message: string) => void;

/**
 * Reads a whole table a page at a time. Without an explicit range PostgREST
 * stops at 1000 rows, and the tenants past that boundary would simply never be
 * served — silently, and worse as the product grows. The order makes the paging
 * stable; both columns are unique.
 */
async function readAll<T>(
  deps: CycleDeps,
  table: string,
  orderBy: string,
): Promise<{ rows: T[]; error: string | null; truncated: string | null }> {
  const rows: T[] = [];
  // Advanced by what actually came back, never by PAGE_SIZE: PostgREST's
  // `db-max-rows` is a server setting, and on a project configured below this
  // constant a fixed stride would step straight over the rows the server
  // withheld — the very gap paging is here to close.
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await deps.db
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    // A failed read is fatal for the cycle rather than partial: half a
    // settings table would silently hand some organisation the default window
    // and send outside the hours it actually configured.
    if (res.error) return { rows, error: res.error.message, truncated: null };

    const batch = (res.data ?? []) as T[];
    rows.push(...batch);
    // Keep going while anything at all comes back, and stop on the first empty
    // page, so the loop cannot end early against a smaller server cap.
    if (batch.length === 0) return { rows, error: null, truncated: null };
    offset += batch.length;
  }

  // Serve what was read rather than nothing: refusing to send past some row
  // count is a harder failure than the unpaged read this replaced, which at
  // least served the first page.
  return {
    rows,
    error: null,
    truncated:
      `stopped after ${MAX_PAGES} pages (${rows.length} rows) of ${table}; ` +
      'the rest were not read this cycle',
  };
}

async function drain(
  deps: CycleDeps,
  result: CycleResult,
  note: Note,
  noteBlocked: (reason: string) => void,
): Promise<void> {
  const settings = await readAll<EmailSettingsRow>(deps, 'email_settings', 'organization_id');
  if (settings.error) {
    note('email_settings', settings.error);
    return;
  }
  // Reported, not fatal. An organisation whose settings row fell past the
  // truncation is served with the column defaults, which is the same treatment
  // as an organisation that never saved one.
  if (settings.truncated) note('email_settings', settings.truncated);
  const settingsByOrg = new Map<string, EmailSettingsRow>();
  for (const row of settings.rows) settingsByOrg.set(row.organization_id, row);

  const status = await readAll<MailboxStatusRow>(deps, 'mailbox_status', 'id');
  if (status.error) {
    note('mailbox_status', status.error);
    return;
  }
  if (status.truncated) note('mailbox_status', status.truncated);
  if (status.rows.length === 0) {
    noteBlocked(blockedReason([]) ?? 'No mailboxes are configured.');
    return;
  }

  // The worker serves every tenant, and the window, the pacing and the budget
  // are all per organisation, so the pool is split before any of them apply.
  const byOrg = new Map<string, MailboxStatusRow[]>();
  for (const row of status.rows) {
    const list = byOrg.get(row.organization_id);
    if (list) list.push(row);
    else byOrg.set(row.organization_id, [row]);
  }

  for (const [organizationId, orgRows] of byOrg) {
    if (stopped(deps)) return;
    // One tenant's bad data is one tenant's problem. Without this, the first
    // throw ends the pass for every organisation after it, in map order — which
    // is to say, invisibly and unevenly.
    try {
      await runOrganisation(
        deps,
        result,
        note,
        noteBlocked,
        organizationId,
        orgRows,
        settingsByOrg.get(organizationId),
      );
    } catch (err) {
      note(`organisation ${organizationId}`, short(err));
    }
  }
}

async function runOrganisation(
  deps: CycleDeps,
  result: CycleResult,
  note: Note,
  noteBlocked: (reason: string) => void,
  organizationId: string,
  orgRows: MailboxStatusRow[],
  settingsRow: EmailSettingsRow | undefined,
): Promise<void> {
  const settings = toSettings(organizationId, settingsRow);
  settings.window = withUsableTimezone(settings.window, (message) =>
    note(`organisation ${organizationId}`, message),
  );

  // Checked before a single row is claimed: outside working hours nothing goes
  // out and the queue simply waits.
  if (!isWithinSendWindow(settings.window, deps.now())) {
    noteBlocked(describeSendWindow(settings.window));
    return;
  }

  const pool = orgRows.map(toMailboxHealth);
  const selection = selectMailboxes(pool, deps.maxPerCycle);
  if (selection.length === 0) {
    noteBlocked(blockedReason(pool) ?? 'No mailbox is currently able to send.');
    return;
  }

  for (const { mailbox, take } of selection) {
    if (stopped(deps)) return;
    // A failure here stops this mailbox and no other — that is the point of a
    // pool, and it is only true if a throw is caught somewhere.
    try {
      await runMailbox(deps, result, note, mailbox, take, settings);
    } catch (err) {
      note(mailbox.fromEmail, short(err));
    }
  }
}

/**
 * One mailbox's pass: open its credential, take its slice of the queue, send
 * it, and close the connection.
 */
async function runMailbox(
  deps: CycleDeps,
  result: CycleResult,
  note: Note,
  mailbox: MailboxHealth,
  take: number,
  settings: EmailSettings,
): Promise<void> {
  // The mailbox is named by its address in every error: a label is free text
  // and two mailboxes can share one, but the address is what the admin has to
  // go and fix.
  const who = mailbox.fromEmail;

  const accountRes = await deps.db
    .from('email_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', mailbox.id)
    .single();
  if (accountRes.error || !accountRes.data) {
    note(who, accountRes.error?.message ?? 'the sending account could not be read');
    return;
  }
  const account = accountRes.data as unknown as AccountRow;

  const secretRes = await deps.db
    .from('email_account_secrets')
    .select('secret_encrypted')
    .eq('account_id', mailbox.id)
    .single();
  if (secretRes.error || !secretRes.data) {
    note(who, secretRes.error?.message ?? 'this mailbox has no stored password');
    return;
  }

  let password: string;
  try {
    password = await decryptSecret(
      String((secretRes.data as { secret_encrypted: string }).secret_encrypted),
      deps.env.tokenKey,
    );
  } catch (err) {
    // Nothing has been claimed yet, so the rows this mailbox would have taken
    // stay queued for a mailbox that can actually send them. Never echo the
    // stored value: the reason it failed to decrypt is not worth leaking a
    // credential over.
    note(who, `the stored password could not be decrypted (${short(err)})`);
    return;
  }

  const transport = deps.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure,
    user: account.smtp_username,
    password,
  });

  // Null whenever this mailbox has no IMAP host, which is the ordinary case:
  // IMAP is optional and a mailbox without it must send exactly as before,
  // never attempting a connection. The same credential serves both protocols,
  // so the password just decrypted is the one the append logs in with.
  const imap = imapConfigFor(account, password);

  try {
    await sendBatch(deps, result, note, mailbox, take, settings, account, transport, imap, who);
  } finally {
    // Release the socket rather than holding a connection open until the next
    // cycle, which some providers count against the mailbox.
    try {
      transport.close();
    } catch {
      // A transport that never connected has nothing to close.
    }
  }
}

async function sendBatch(
  deps: CycleDeps,
  result: CycleResult,
  note: Note,
  mailbox: MailboxHealth,
  take: number,
  settings: EmailSettings,
  account: AccountRow,
  transport: Transporter,
  imap: ImapConfig | null,
  who: string,
): Promise<void> {
  /**
   * The one call that settles a message, and the only place that writes a
   * result. It carries the outcome, the error and the provider id together, in
   * one transaction — splitting it in two is what stranded rows in 'sending'
   * before.
   *
   * A 'sent' settlement is retried, because by then the message is already on
   * its way to the recipient: a row left 'sending' with a null
   * provider_message_id is exactly what the claim's ten-minute sweep decides
   * was never delivered, and it requeues it, mailing the same person twice.
   * The call is one idempotent UPDATE to a fixed state, so making it again is
   * still one settlement, not a second write. The other outcomes are not
   * retried on purpose: nothing was delivered, so the sweep requeueing them is
   * the correct recovery rather than a duplicate.
   *
   * Returns whether the result actually reached the database.
   */
  const settle = async (
    messageId: string,
    outcome: Outcome,
    error: string | null,
    providerMessageId: string | null = null,
    /** True only for a row this worker never handed to SMTP. */
    restoreAttempt = false,
  ): Promise<boolean> => {
    const attempts = outcome === 'sent' ? SETTLE_ATTEMPTS : 1;
    let lastError = '';

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await deps.sleep(SETTLE_BACKOFF_MS[attempt - 1] ?? SETTLE_BACKOFF_MS[SETTLE_BACKOFF_MS.length - 1]);
      }
      // postgrest-js answers with `{ error }` rather than rejecting, but only
      // until someone sets throwOnError() or the fetch itself fails. This
      // function must never throw: the only caller that could catch it is the
      // send's own catch block, which would read a settlement failure as a
      // send failure.
      try {
        const { error: rpcError } = await deps.db.rpc('record_send_result', {
          p_message: messageId,
          p_account: mailbox.id,
          p_outcome: outcome,
          p_error: error,
          p_provider_message_id: providerMessageId,
          p_restore_attempt: restoreAttempt,
        });
        if (!rpcError) return true;
        lastError = rpcError.message;
      } catch (err) {
        lastError = short(err);
      }
    }

    if (outcome === 'sent') {
      note(
        who,
        `DELIVERED BUT NOT RECORDED: ${messageId} was accepted by the mail server, but its ` +
          `result could not be written after ${attempts} attempts (${lastError}). The recovery ` +
          'sweep may send it again — check this row by hand.',
      );
    } else {
      note(who, `the result for ${messageId} could not be recorded: ${lastError}`);
    }
    return false;
  };

  /**
   * Counts a failure against the MAILBOX without failing a recipient for it.
   * record_send_result()'s 'permanent' branch does both at once, which is
   * right for a sender the server refuses and wrong for a rejected login or a
   * connection that never opened: nothing was ever offered for the row in
   * flight to be refused. Both paths reach the same SQL, so the three-strike
   * pause keeps one definition.
   *
   * Never throws, for the same reason `settle` never does: the only caller is
   * inside the send's own error handling, and a rejection here would be read
   * as a second send failure.
   */
  const strikeMailbox = async (reason: string): Promise<void> => {
    try {
      const { error } = await deps.db.rpc('record_mailbox_failure', {
        p_account: mailbox.id,
        p_error: reason.slice(0, 500),
      });
      if (error) note(who, `this mailbox's failure could not be recorded: ${error.message}`);
    } catch (err) {
      note(who, `this mailbox's failure could not be recorded: ${short(err)}`);
    }
  };

  const claimRes = await deps.db.rpc('claim_email_batch', {
    p_account: mailbox.id,
    p_limit: take,
  });
  if (claimRes.error) {
    note(who, claimRes.error.message);
    return;
  }
  const rows = (claimRes.data ?? []) as ClaimedRow[];
  if (rows.length === 0) return;
  result.claimed += rows.length;

  /**
   * Messages this transport has had accepted so far in this batch. It is the
   * evidence that the host is reachable and the credentials work, which is
   * what tells a broken mailbox apart from one slow recipient gateway — see
   * isMailboxFault(). Counted from SMTP's acceptance, not from a settlement
   * that landed: the connection is proven by the send, whatever the database
   * then did with the result.
   */
  let deliveredOnTransport = 0;

  /**
   * The raw bytes of every message this batch actually delivered, filed in
   * the mailbox's Sent folder once the batch is done, then dropped.
   *
   * The bound is a COUNT, not a size: at most PER_MAILBOX_SLICE (10) rows are
   * claimed in one pass, so this holds at most ten message sources — but each
   * is a whole composed message, and the body is admin-authored HTML that can
   * carry inline `data:` images. The real ceiling is therefore ten times
   * whatever the largest body in the batch composes to, base64 included, and
   * a campaign with a 5 MB inline image is 50 MB resident here. If that
   * becomes a real shape of message, append in chunks rather than at the end.
   */
  const copies: Buffer[] = [];

  /**
   * Hands rows this worker never attempted straight back to the queue. They
   * carry the attempt the claim stamped on them, and three of those makes a row
   * unclaimable forever — so `p_restore_attempt` gives it back. Without that, a
   * mailbox with a rotated password retires nine innocent recipients per cycle.
   */
  const returnUnattempted = async (from: number, reason: string): Promise<void> => {
    for (const rest of rows.slice(from)) {
      await settle(rest.message_id, 'transient', reason.slice(0, 500), null, true);
      result.skipped += 1;
    }
  };

  // The bodies, once for the batch rather than once per recipient.
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id))];
  const campaignRes = await deps.db
    .from('email_campaigns')
    .select('id, kind, subject, body_html')
    .in('id', campaignIds);
  if (campaignRes.error) {
    // Without the bodies nothing in this batch can be built. Hand every row
    // straight back rather than leaving the whole batch stranded in 'sending'.
    note(who, campaignRes.error.message);
    await returnUnattempted(0, campaignRes.error.message);
    return;
  }
  const byCampaign = new Map(
    ((campaignRes.data ?? []) as unknown as CampaignRow[]).map((c) => [c.id, c]),
  );

  for (let i = 0; i < rows.length; i++) {
    if (stopped(deps)) {
      // Shutting down. Give the rest of the batch back now rather than leaving
      // it to the ten-minute sweep, so a redeploy costs the queue nothing.
      await returnUnattempted(i, 'The worker was asked to stop before this message was attempted.');
      // `break`, not `return` — belt and braces, and say so plainly:
      // fileSentCopies bails on the stop flag however this loop exited, so
      // nothing currently depends on reaching it. It stays because the batch
      // having ONE exit is what keeps the decision about the copies in the
      // one function that explains it, instead of split across two.
      break;
    }

    const row = rows[i];
    const campaign = byCampaign.get(row.campaign_id);
    if (!campaign) {
      // The campaign is gone; no retry will ever find it.
      await settle(row.message_id, 'permanent', 'The campaign no longer exists.');
      result.failed += 1;
      continue;
    }

    // A domain that cannot receive mail can only bounce, and bounce rate is
    // what gets a sender throttled. Cheaper to check than to send.
    const domain = domainOfEmail(row.to_email);
    let accepts = true;
    try {
      accepts = await deps.domainAcceptsMail(domain);
    } catch (err) {
      // A resolver that is itself broken must not be read as "every domain is
      // dead" — that would suppress the whole list.
      note(who, `the domain check for ${domain} failed, so it was sent anyway (${short(err)})`);
      accepts = true;
    }
    if (!accepts) {
      await settle(
        row.message_id,
        'hard_bounce',
        `${domain} publishes no MX or A record, so it cannot receive mail.`,
      );
      result.skipped += 1;
      // Nothing reached the wire, so there is nothing to pace.
      continue;
    }

    /**
     * The RFC 5322 Message-ID this message will carry, named here rather than
     * left to nodemailer. Sending pre-built bytes means nodemailer never sees
     * the Message-ID inside them, so it would mint a second one for
     * `info.messageId` and this row's provider_message_id would name a
     * message that exists nowhere. Derived from the queue row, so the id in
     * the recipient's copy, in the mailbox's Sent copy and in the database are
     * one value.
     */
    const messageId = `<${row.message_id}@${domainOfEmail(account.from_email) || 'localhost'}>`;

    let built: BuiltMessage;
    /**
     * The exact bytes this message is sent as, built ONCE. The same buffer
     * goes to SMTP and, after the batch, to the Sent folder, so the copy in
     * the mailbox is the message the recipient received rather than a second
     * one built from the same inputs — see buildRaw in worker/lib/mailer.ts.
     */
    let raw: Buffer;
    try {
      let unsubscribe: string | undefined;
      if (campaign.kind === 'bulk') {
        // Bulk mail must carry one-click unsubscribe (RFC 8058); single sends
        // are transactional and must not.
        const token = await signUnsubscribeToken(row.message_id, deps.env.unsubscribeSecret);
        unsubscribe = unsubscribeUrl(deps.env.siteUrl, row.message_id, token);
      }
      built = buildMessage({
        kind: campaign.kind,
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        mergeData: row.merge_data ?? {},
        unsubscribeUrl: unsubscribe,
      });
      // Composed here and not inside the send's own try/catch: a message that
      // will not compose is not an SMTP failure, and classifySmtpError would
      // read it as a transient one while isMailboxFault charged it to the
      // mailbox — a strike for a connection that was never opened.
      raw = await deps.buildRaw({
        // Objects, not `"name" <addr>` strings: a CSV-sourced name holding a
        // quote would otherwise inject a second recipient that no suppression
        // check ever saw.
        from: { name: String(account.from_name ?? ''), address: String(account.from_email) },
        replyTo: account.reply_to ?? undefined,
        to: { name: String(row.to_name ?? ''), address: String(row.to_email) },
        subject: built.subject,
        html: built.html,
        text: built.text,
        headers: built.headers,
        messageId,
      });
    } catch (err) {
      // Nothing has been handed to SMTP, so the row goes back on the queue.
      // The attempt is NOT restored here: a merge field that throws, or a
      // message that will not compose, does it every time, and a row that
      // never spends an attempt is a row that is retried forever. Three tries
      // and it retires, like any other bad row.
      const message = short(err);
      note(who, message);
      await settle(row.message_id, 'transient', message);
      result.failed += 1;
      continue;
    }

    let abort: string | null = null;
    // Set the moment sendMail resolves, and read after the catch. The
    // settlement CANNOT live inside this try: anything thrown below the send —
    // a settlement that rejects rather than returning `{ error }` — would be
    // handed to classifySmtpError(), which reads an ordinary Error as
    // 'transient' and would put an already-delivered message back on the queue
    // with claimed_at cleared, to be re-claimed and re-sent seconds later.
    // Once delivery has happened, nothing may reinterpret it as a failure.
    let delivered: { providerMessageId: string | null } | null = null;
    try {
      const info = await transport.sendMail({
        // The bytes composed above, sent verbatim. Nodemailer builds nothing
        // from them, which is what makes the Sent copy below identical to
        // what the recipient received.
        raw,
        // With `raw` there are no headers for nodemailer to read addresses
        // out of, so the envelope has to be named here or the send is a MAIL
        // FROM with no RCPT TO. The sender is the bounce address, exactly
        // what the `from` option produced before.
        //
        // Objects again, and for the same reason: nodemailer runs a bare
        // envelope string through its address parser, which SPLITS ON COMMAS,
        // so a to_email carrying one would become two RCPT TO commands and
        // mail somebody no suppression check ever saw. An `{ address }`
        // object is taken whole.
        envelope: {
          from: { address: String(account.from_email) },
          to: { address: String(row.to_email) },
        },
        // Not a header — the bytes already carry this one. It is repeated
        // here only so `info.messageId` reports the id that is actually in
        // the message rather than a fresh one nodemailer invented.
        messageId,
      });
      delivered = { providerMessageId: info?.messageId ?? null };
      deliveredOnTransport += 1;
    } catch (err) {
      const message = friendlySmtpError(err, account.smtp_host);
      note(who, message);

      if (isMailboxFault(err, deliveredOnTransport)) {
        // The login was refused, or the connection never came up and nothing
        // has yet gone out on it. Nothing about THIS recipient was rejected —
        // nothing was offered for them at all — so the row is settled exactly
        // like the rest of the batch: back on the queue with the attempt the
        // claim stamped on it given back. Without that, three cycles against
        // one rotated password permanently fail three innocent recipients, one
        // per cycle, with somebody else's credential error as their reason.
        await settle(row.message_id, 'transient', message.slice(0, 500), null, true);
        result.skipped += 1;
        // The strike still has to land, or the mailbox is never paused. A
        // connection failure in particular classifies as 'transient', which
        // leaves mailbox health untouched: a wrong port or blocked egress
        // would otherwise make every queued row wait the full connection
        // timeout and spend an attempt, forever. Only reachable before this
        // transport has delivered anything, so it is the connection being
        // blamed and not a recipient who happened to be slow.
        await strikeMailbox(message);
        // And the rest of this mailbox's batch stops here, exactly as it does
        // for a refused sender: every remaining row would fail identically.
        abort = message;
      } else {
        // Exactly one of 'permanent' | 'hard_bounce' | 'transient'. This is
        // also where a connection-class code lands once something has already
        // gone out on this transport: ordinary per-message accounting, so the
        // attempt is SPENT and the claim's three-try budget still retires the
        // row. Restoring it there would make one slow gateway immortal, and
        // would lift the ceiling off the duplicate window in worker/README.md.
        const outcome = classifySmtpError(err);
        await settle(row.message_id, outcome, message.slice(0, 500));
        result.failed += 1;
        // 'permanent' here is a genuine rejection of this message — a sender
        // address the server will not accept, a 5xx it will repeat. Every
        // remaining recipient in this batch would collect the identical
        // rejection, so they go back on the queue instead and this mailbox
        // stops. A hard bounce, and a transient failure of one recipient,
        // stop nothing.
        if (outcome === 'permanent') abort = message;
      }
    }

    if (delivered) {
      // Outside the catch, on purpose. The provider id goes down with the
      // status in one call, so a row can never be 'sent' without it or carry it
      // while 'sending'; and it is counted only once that call has actually
      // landed, because a summary claiming a delivery the database never heard
      // about is worse than no summary.
      const recorded = await settle(row.message_id, 'sent', null, delivered.providerMessageId);
      if (recorded) result.sent += 1;
      // Kept for the Sent folder, filed once for the whole batch below.
      // Whether the settlement landed is beside the point here: the message
      // reached the recipient, and the mailbox's own record is supposed to
      // show what was sent from it.
      copies.push(raw);
    }

    if (abort) {
      await returnUnattempted(i + 1, `Not attempted: ${abort}`);
      break;
    }

    // Between messages, not after the last one: an idle pause at the end of a
    // batch buys no deliverability. And never while stopping — the stop is
    // checked HERE as well as at the top of the loop, because a signal that
    // arrives during a send would otherwise cost the send, then a full jitter
    // pause of up to 25 seconds, before anything noticed. That is most of a
    // container's shutdown grace on its own.
    if (i < rows.length - 1 && !stopped(deps)) await deps.sleep(jitterMs(settings));
  }

  await fileSentCopies(deps, note, imap, account.smtp_host, account.sent_folder_enabled, copies, who);
}

/**
 * Files this batch's delivered messages in the mailbox's own Sent folder.
 *
 * SMTP hands a message to the server for delivery and puts a copy nowhere —
 * a mail client files its own — so without this the customer's mailbox holds
 * no record of anything the app sent from it, which looks broken and leaves
 * support nothing to look at.
 *
 * The rules that shape this function, and none of them is negotiable:
 *
 *   * A failure to file NEVER fails a send. Every buffer here belongs to a
 *     message that has already been delivered and already been settled; the
 *     copy is a convenience for whoever opens the mailbox. So this is noted
 *     and nothing more: it is called after the batch, it throws nothing, and
 *     it touches no result count and no mailbox health. A mailbox whose IMAP
 *     credential is refused — which providers routinely do while SMTP works
 *     perfectly — must keep sending.
 *   * It never fails a send, and it must not DELAY one either. The worker is
 *     one sequential loop across every tenant, so this races a deadline: past
 *     it the cycle walks away and the next organisation's queue moves. See
 *     SENT_APPEND_TIMEOUT_MS.
 *   * Nothing it reports may carry a body, a subject or a recipient. The
 *     buffers are whole message sources, so the notes below are counts, and
 *     `short` caps whatever the IMAP error itself says.
 */
async function fileSentCopies(
  deps: CycleDeps,
  note: Note,
  imap: ImapConfig | null,
  smtpHost: string,
  sentFolderEnabled: boolean | null | undefined,
  copies: Buffer[],
  who: string,
): Promise<void> {
  // No IMAP configured is not a failure and is not reported: IMAP is optional
  // and a mailbox without it sends exactly as it always did.
  if (!imap || copies.length === 0) return;

  // The mailbox's own switch (migration 157), checked before the automatic
  // Google skip below rather than instead of it: this is the one an admin
  // can actually change, and it is meant to cover the case that skip cannot
  // — a Google Workspace mailbox sent through a custom relay hostname, which
  // providerOf(smtpHost) has no way to recognise as Google. Only an explicit
  // `false` turns it off: the column defaults to true, and undefined (a
  // narrower select, or a row read before this field existed) must read the
  // same as true, never as silently disabled.
  if (sentFolderEnabled === false) return;

  // Google files an SMTP send into its own Sent folder server-side, so
  // appending there gives the customer TWO copies of every message they send
  // — which reads as a bug in this product and which they cannot undo from
  // their end. That is worse than the problem the append solves, so Google
  // mailboxes are left alone. The accepted cost: a Google account configured
  // NOT to save SMTP sends gets no copy at all. That is the rarer setting,
  // and a missing copy is at least visible rather than silently doubled.
  if (providerOf(smtpHost) === 'google') return;

  // Never on the way out. The paragraphs above this in the send loop are
  // about not spending a container's shutdown grace, and an IMAP session is
  // exactly the kind of thing that spends it. NOTHING is lost by skipping:
  // every message in `copies` is already delivered and already settled, so
  // the only casualty is the copy — and the next cycle's sends will still be
  // filed. Do not restore this out of completeness.
  if (stopped(deps)) return;

  try {
    // One connection for the batch. A session per message would cost more
    // than the sends did and would multiply the logins that get a mailbox
    // rate-limited.
    const saved = await withDeadline(deps.appendToSent(imap, copies), SENT_APPEND_TIMEOUT_MS);

    if (saved === TIMED_OUT) {
      note(
        who,
        `filing ${copies.length} delivered messages in this mailbox's Sent folder took longer ` +
          `than ${Math.round(SENT_APPEND_TIMEOUT_MS / 1000)}s, so the cycle moved on without ` +
          'waiting for it. They were sent.',
      );
      return;
    }

    if (saved < copies.length) {
      note(
        who,
        `${copies.length - saved} of ${copies.length} delivered messages could not be filed in ` +
          "this mailbox's Sent folder. They were sent; only the copies are missing.",
      );
    }
  } catch (err) {
    note(
      who,
      `this mailbox's Sent folder could not be written, so ${copies.length} delivered ` +
        `messages were not filed in it (${short(err)}). They were sent.`,
    );
  }
}

/** What `withDeadline` answers with when the work did not finish in time. */
const TIMED_OUT = Symbol('timed out');

/**
 * Runs `work`, giving up on WAITING for it after `ms`.
 *
 * It cannot cancel anything — an IMAP session that has stopped answering goes
 * on until imapflow's own socket timers tear it down — so what this buys is
 * that the cycle stops waiting, not that the work stops. That is the part
 * that matters: every other tenant is queued behind this one loop.
 *
 * `Promise.race` attaches a handler to `work`, so a rejection that arrives
 * after the deadline is still handled and never surfaces as an unhandled
 * rejection. `setTimeout` is a platform global, not a Node API, and the timer
 * is always cleared so a fast path leaves nothing pending.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
