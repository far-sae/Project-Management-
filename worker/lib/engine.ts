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
//   * A mailbox's secret is decrypted BEFORE its budget is claimed, so a
//     credential the worker cannot read leaves the queue untouched instead of
//     stranding rows behind a mailbox that was never going to send them.
//   * One tenant cannot take down the cycle. Each organisation and each
//     mailbox runs inside its own try/catch, because a thrown error — an
//     invalid timezone, a transport that will not construct — would otherwise
//     end the pass for every organisation iterated after it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transporter } from 'nodemailer';

import { decryptSecret } from '@/lib/email/crypto';
import { blockedReason, selectMailboxes } from '@/lib/email/mailboxPool';
import { buildMessage, type BuiltMessage } from '@/lib/email/message';
import { describeSendWindow, isWithinSendWindow } from '@/lib/email/sendWindow';
import { classifySmtpError, friendlySmtpError } from '@/lib/email/smtpErrors';
import type {
  AccountStatus,
  CampaignKind,
  EmailSettings,
  MailboxHealth,
  SendWindow,
} from '@/lib/email/types';
import { signUnsubscribeToken, unsubscribeUrl } from '@/lib/email/unsubscribe';

import { domainOfEmail } from './dns.js';
import type { SmtpConfig } from './mailer.js';

/* ------------------------------------------------------------------- types */

export interface CycleDeps {
  db: SupabaseClient;
  createTransport: (cfg: SmtpConfig) => Transporter;
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
  'id, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_secure, smtp_username';

/** PostgREST returns 1000 rows by default, so both reads are paged explicitly. */
const PAGE_SIZE = 1000;
/** A stop for a page that never shrinks; 50 pages is 50,000 mailboxes. */
const MAX_PAGES = 50;

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
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const res = await deps.db
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) return { rows, error: res.error.message };
    const batch = (res.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null };
  }
  return { rows, error: `more than ${MAX_PAGES * PAGE_SIZE} rows in ${table}; the rest were skipped` };
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
  const settingsByOrg = new Map<string, EmailSettingsRow>();
  for (const row of settings.rows) settingsByOrg.set(row.organization_id, row);

  const status = await readAll<MailboxStatusRow>(deps, 'mailbox_status', 'id');
  if (status.error) {
    note('mailbox_status', status.error);
    return;
  }
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

  try {
    await sendBatch(deps, result, note, mailbox, take, settings, account, transport, who);
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
      return;
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

    let built: BuiltMessage;
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
    } catch (err) {
      // Nothing has been handed to SMTP, so the row goes back on the queue.
      // The attempt is NOT restored here: a merge field that throws throws
      // every time, and a row that never spends an attempt is a row that is
      // retried forever. Three tries and it retires, like any other bad row.
      const message = short(err);
      note(who, message);
      await settle(row.message_id, 'transient', message);
      result.failed += 1;
      continue;
    }

    let abort: string | null = null;
    try {
      const info = await transport.sendMail({
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
      });
      // Delivered. The provider id goes down with the status in the same call,
      // so a row can never be 'sent' without it or carry it while 'sending'.
      // Counted only once that call has actually landed: a summary claiming a
      // delivery the database never heard about is worse than no summary.
      const recorded = await settle(row.message_id, 'sent', null, info?.messageId ?? null);
      if (recorded) result.sent += 1;
    } catch (err) {
      const message = friendlySmtpError(err, account.smtp_host);
      // Exactly one of 'permanent' | 'hard_bounce' | 'transient'.
      const outcome = classifySmtpError(err);
      note(who, message);
      await settle(row.message_id, outcome, message.slice(0, 500));
      result.failed += 1;
      // 'permanent' is the mailbox being refused — a rejected login, a sender
      // the server will not accept. Every remaining recipient in this batch
      // would collect the identical rejection and be marked failed for a
      // problem that is not theirs, so they go back on the queue instead and
      // this mailbox stops here. A hard bounce is about one recipient and
      // stops nothing.
      if (outcome === 'permanent') abort = message;
    }

    if (abort) {
      await returnUnattempted(i + 1, `Not attempted: ${abort}`);
      break;
    }

    // Between messages, not after the last one: an idle pause at the end of a
    // batch buys no deliverability and delays a shutdown by up to the full
    // interval.
    if (i < rows.length - 1) await deps.sleep(jitterMs(settings));
  }
}
