import Papa from "papaparse";
import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { dedupeRecipients, filterSuppressed, normalizeEmail } from "@/lib/email/suppression";
import { MAX_JITTER_MS } from "@/lib/email/sendWindow";
import type {
  AccountStatus,
  CampaignKind,
  CampaignStatus,
  EmailAccount,
  EmailCampaign,
  EmailMessage,
  EmailSettings,
  EmailSuppression,
  ImapStatus,
  InboxEvent,
  MailboxHealth,
  MessageStatus,
  SuppressionReason,
} from "@/lib/email/types";
import type { DomainAuthReport } from "@/lib/email/domainAuth";

/** A recipient collected from CRM contacts, a pasted list, or a CSV upload. */
export interface Recipient {
  email: string;
  name?: string;
  contactId?: string;
  mergeData: Record<string, unknown>;
}

export interface CreateAccountInput {
  organizationId: string;
  workspaceId?: string | null;
  userId?: string | null;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  /** Plaintext SMTP password. Never stored as-is — posted over TLS to
   *  `POST /api/email/account-secret`, which encrypts it server-side. */
  password: string;
  dailyLimit?: number;
}

/** Partial update to a mailbox's pool settings — Accounts screen only sends the fields that changed. */
export interface PoolInput {
  dailyLimit?: number;
  warmupEnabled?: boolean;
  /** null clears the ramp's start date; undefined leaves it untouched. */
  warmupStartedOn?: Date | null;
  warmupStartVolume?: number;
  warmupIncrement?: number;
  isActive?: boolean;
}

export interface CreateCampaignInput {
  organizationId: string;
  workspaceId?: string | null;
  createdBy?: string | null;
  /**
   * The mailbox this campaign is pinned to, or `null` for "use the whole
   * pool" — the default since migration 156, which made
   * `email_campaigns.account_id` nullable. A pooled campaign is claimed by
   * whichever pool member is next in the least-recently-used rotation, which
   * is the only way rotation, warmup and the per-mailbox daily cap ever apply
   * to more than one mailbox.
   */
  accountId: string | null;
  kind: CampaignKind;
  name: string;
  subject: string;
  bodyHtml: string;
  scheduledAt?: Date | null;
}

/** Raw shape of an `email_accounts` row as returned by PostgREST. */
interface EmailAccountRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  user_id: string | null;
  label: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
  daily_limit: number;
  status: AccountStatus;
  last_error: string | null;
  last_verified_at: string | null;
  created_at: string;
  // IMAP settings and inbox-scan status (migration 157a) — every column is
  // optional at the schema level (a null imap_host is the ordinary,
  // unconfigured state), and sending needs none of them.
  imap_host: string | null;
  imap_port: number;
  imap_secure: boolean;
  imap_status: ImapStatus;
  imap_last_error: string | null;
  inbox_last_scan_at: string | null;
  sent_folder_enabled: boolean;
}

/** Raw shape of an `email_inbox_events` row (migration 157c). */
interface InboxEventRow {
  id: string;
  organization_id: string;
  account_id: string | null;
  kind: "reply" | "bounce";
  address: string;
  message_id: string | null;
  detail: string | null;
  created_at: string;
}

/** Raw shape of an `email_campaigns` row as returned by PostgREST. */
interface EmailCampaignRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  created_by: string | null;
  account_id: string | null;
  kind: CampaignKind;
  name: string;
  subject: string;
  body_html: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  suppressed_count: number;
  // Written directly by record_inbox_result() (migration 157d), on the
  // reply/bounce transition — never recomputed by finalize_email_campaigns()
  // the way the four counts above are.
  replied_count: number;
  bounced_count: number;
  created_at: string;
}

/** Raw shape of an `email_messages` row as returned by PostgREST. */
interface EmailMessageRow {
  id: string;
  campaign_id: string;
  organization_id: string;
  contact_id: string | null;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  // Set by record_inbox_result() (migration 157d), never by the send path.
  replied_at: string | null;
  bounced_at: string | null;
}

/** Raw shape of an `email_suppressions` row as returned by PostgREST. */
interface EmailSuppressionRow {
  id: string;
  organization_id: string;
  email: string;
  reason: SuppressionReason;
  created_at: string;
}

/** Raw shape of a `mailbox_status` view row (migration 156). */
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
  daily_limit: number;
  warmup_enabled: boolean;
  warmup_started_on: string | null;
  warmup_start_volume: number;
  warmup_increment: number;
  effective_limit: number;
  sent_today: number;
}

/** Raw shape of an `email_settings` row (migration 156). */
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

/** Raw shape of the `crm_contacts` columns `contactsForCampaign` selects. */
interface CrmContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  company_id: string | null;
}

/**
 * A `date` column in the shape PostgREST wants, read from the LOCAL calendar
 * fields. `toISOString()` would project the instant into UTC first, so a
 * local-midnight Date east of UTC would be written as the day before — the
 * mirror image of the bug `fromDateOnly` exists to fix, and it would make the
 * pair fail to round-trip.
 */
const toDateOnly = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Reads a `date` column back. PostgREST returns it as 'YYYY-MM-DD', and
 * `new Date('2026-09-18')` parses a bare date as UTC midnight — which every
 * reader then inspects with local getters (`getFullYear`, `getMonth`,
 * `getDate`). West of UTC those answer the *previous* day, so "Warmup day N"
 * on the mailbox card is off by one for every user in the Americas. Taking
 * the year, month and day out of the string gives local midnight on the day
 * the column actually names.
 */
const fromDateOnly = (value: string): Date | null => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!parts) return null;
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
};

export const mapAccountRow = (row: EmailAccountRow): EmailAccount => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  label: row.label,
  fromName: row.from_name,
  fromEmail: row.from_email,
  replyTo: row.reply_to,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  smtpSecure: row.smtp_secure,
  smtpUsername: row.smtp_username,
  dailyLimit: row.daily_limit,
  status: row.status,
  lastError: row.last_error,
  lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at) : null,
  createdAt: new Date(row.created_at),
  imapHost: row.imap_host,
  imapPort: row.imap_port,
  imapSecure: row.imap_secure,
  imapStatus: row.imap_status,
  imapLastError: row.imap_last_error,
  inboxLastScanAt: row.inbox_last_scan_at ? new Date(row.inbox_last_scan_at) : null,
  sentFolderEnabled: row.sent_folder_enabled,
});

export const mapInboxEventRow = (row: InboxEventRow): InboxEvent => ({
  id: row.id,
  organizationId: row.organization_id,
  // Passed through as-is, null and all — see the doc comment on
  // InboxEvent.accountId in src/lib/email/types.ts for why this is not
  // coalesced to an empty string.
  accountId: row.account_id,
  kind: row.kind,
  address: row.address,
  messageId: row.message_id,
  detail: row.detail,
  createdAt: new Date(row.created_at),
});

export const mapCampaignRow = (row: EmailCampaignRow): EmailCampaign => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  createdBy: row.created_by,
  accountId: row.account_id,
  kind: row.kind,
  name: row.name,
  subject: row.subject,
  bodyHtml: row.body_html,
  status: row.status,
  scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
  queuedCount: row.queued_count,
  sentCount: row.sent_count,
  failedCount: row.failed_count,
  suppressedCount: row.suppressed_count,
  repliedCount: row.replied_count,
  bouncedCount: row.bounced_count,
  createdAt: new Date(row.created_at),
});

export const mapMessageRow = (row: EmailMessageRow): EmailMessage => ({
  id: row.id,
  campaignId: row.campaign_id,
  organizationId: row.organization_id,
  contactId: row.contact_id,
  toEmail: row.to_email,
  toName: row.to_name,
  mergeData: row.merge_data ?? {},
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  sentAt: row.sent_at ? new Date(row.sent_at) : null,
  repliedAt: row.replied_at ? new Date(row.replied_at) : null,
  bouncedAt: row.bounced_at ? new Date(row.bounced_at) : null,
});

export const mapSuppressionRow = (row: EmailSuppressionRow): EmailSuppression => ({
  id: row.id,
  organizationId: row.organization_id,
  email: row.email,
  reason: row.reason,
  createdAt: new Date(row.created_at),
});

export const mapMailboxStatusRow = (row: MailboxStatusRow): MailboxHealth => ({
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
  // The raw ramp inputs, straight off the same mailbox_status row — used by
  // MailboxCard to render the warmup line without redoing the view's own
  // arithmetic.
  dailyLimit: row.daily_limit,
  warmupEnabled: row.warmup_enabled,
  warmupStartedOn: row.warmup_started_on ? fromDateOnly(row.warmup_started_on) : null,
  warmupStartVolume: row.warmup_start_volume,
  warmupIncrement: row.warmup_increment,
});

export const mapEmailSettingsRow = (row: EmailSettingsRow): EmailSettings => ({
  organizationId: row.organization_id,
  window: {
    enabled: row.send_window_enabled,
    startHour: row.send_window_start,
    endHour: row.send_window_end,
    days: row.send_days,
    timezone: row.send_timezone,
  },
  jitterMinMs: row.jitter_min_ms,
  jitterMaxMs: row.jitter_max_ms,
});

/**
 * Documented defaults for an organization with no `email_settings` row.
 * Migration 156 seeds no row for any organization, so the settings screen
 * would otherwise have nothing to render on first visit. Mirrors that
 * migration's own column defaults: window enabled, 08:00-18:00, Monday to
 * Friday, UTC, jitter 8000-25000ms.
 */
const defaultEmailSettings = (orgId: string, timezone: string = "UTC"): EmailSettings => ({
  organizationId: orgId,
  window: {
    enabled: true,
    startHour: 8,
    endHour: 18,
    days: [1, 2, 3, 4, 5],
    timezone,
  },
  jitterMinMs: 8000,
  jitterMaxMs: 25000,
});

// ── Accounts ──────────────────────────────────────────────────────────

export const listAccounts = async (orgId: string): Promise<EmailAccount[]> => {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email accounts:", error);
    throw error;
  }

  return ((data ?? []) as EmailAccountRow[]).map(mapAccountRow);
};

export const createAccount = async (input: CreateAccountInput): Promise<EmailAccount> => {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    user_id: input.userId ?? null,
    label: input.label,
    from_name: input.fromName,
    from_email: input.fromEmail,
    reply_to: input.replyTo ?? null,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    smtp_secure: input.smtpSecure,
    smtp_username: input.smtpUsername,
    ...(input.dailyLimit !== undefined ? { daily_limit: input.dailyLimit } : {}),
  };

  const { data, error } = await supabase
    .from("email_accounts")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create email account:", error);
    throw error;
  }

  const account = mapAccountRow(data as EmailAccountRow);
  await saveAccountSecret(account.id, input.password);
  return account;
};

/**
 * Posts the SMTP password over TLS to `POST /api/email/account-secret`,
 * which encrypts it there with the server-only `INTEGRATION_TOKEN_KEY` and
 * writes the ciphertext with the service-role client. Encryption is
 * deliberately NOT done here: a browser-side key would have to be a `VITE_*`
 * variable, and Vite inlines those into the public JS bundle, handing the
 * key to every stored SMTP password and OAuth token to anyone who can read
 * the deployed JavaScript. `email_account_secrets` denies all access to
 * `authenticated` (migration 152), so the write has to go through that
 * service-role route either way.
 */
export const saveAccountSecret = async (accountId: string, password: string): Promise<void> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/email/account-secret", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountId, password }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? `Failed to save account secret: ${res.status}`;
    logger.error("Failed to save account secret:", message);
    throw new Error(message);
  }
};

export const deleteAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase.from("email_accounts").delete().eq("id", accountId);

  if (error) {
    logger.error("Failed to delete email account:", error);
    throw error;
  }
};

/**
 * IMAP is optional (migration 157a): `imapHost: null` is the ordinary,
 * unconfigured state, not an error, and leaves the mailbox sending exactly
 * as it did before — this only ever touches the four columns listed here,
 * never `status`/`is_active`/`consecutive_failures`, which are the send
 * path's alone.
 *
 * `sentFolderEnabled` rides along on the same call because it is set from
 * the same form section and is just as inert with no host configured: with
 * `imapHost` null there is no Sent folder to file into, whatever this says.
 */
export interface UpdateAccountImapInput {
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  sentFolderEnabled: boolean;
}

export const updateAccountImap = async (
  accountId: string,
  input: UpdateAccountImapInput,
): Promise<void> => {
  const row = {
    imap_host: input.imapHost,
    imap_port: input.imapPort,
    imap_secure: input.imapSecure,
    sent_folder_enabled: input.sentFolderEnabled,
  };

  const { error } = await supabase.from("email_accounts").update(row).eq("id", accountId);

  if (error) {
    logger.error("Failed to update mailbox IMAP settings:", error);
    throw error;
  }
};

// ── Pool, warmup and health ──────────────────────────────────────────

export const listMailboxStatus = async (orgId: string): Promise<MailboxHealth[]> => {
  const { data, error } = await supabase
    .from("mailbox_status")
    .select("*")
    .eq("organization_id", orgId)
    .order("label", { ascending: true });

  if (error) {
    logger.error("Failed to list mailbox status:", error);
    throw error;
  }

  return ((data ?? []) as MailboxStatusRow[]).map(mapMailboxStatusRow);
};

export const updateAccountPool = async (accountId: string, input: PoolInput): Promise<void> => {
  const row: Record<string, unknown> = {
    ...(input.dailyLimit !== undefined ? { daily_limit: input.dailyLimit } : {}),
    ...(input.warmupEnabled !== undefined ? { warmup_enabled: input.warmupEnabled } : {}),
    ...(input.warmupStartedOn !== undefined
      ? { warmup_started_on: input.warmupStartedOn ? toDateOnly(input.warmupStartedOn) : null }
      : {}),
    ...(input.warmupStartVolume !== undefined
      ? { warmup_start_volume: input.warmupStartVolume }
      : {}),
    ...(input.warmupIncrement !== undefined ? { warmup_increment: input.warmupIncrement } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
  };

  const { error } = await supabase.from("email_accounts").update(row).eq("id", accountId);

  if (error) {
    logger.error("Failed to update mailbox pool settings:", error);
    throw error;
  }
};

/**
 * Un-pauses a mailbox by hand: clears the reason shown on the Accounts
 * screen and the failure streak that record_send_result() (migration 156)
 * would otherwise keep counting from, and puts it back in the pool. Does not
 * touch `status`, which reflects whether the credentials last verified —
 * resuming a mailbox is not the same claim as re-verifying it.
 */
export const resumeAccount = async (accountId: string): Promise<void> => {
  const { error } = await supabase
    .from("email_accounts")
    .update({ paused_reason: null, consecutive_failures: 0, is_active: true })
    .eq("id", accountId);

  if (error) {
    logger.error("Failed to resume email account:", error);
    throw error;
  }
};

/**
 * `defaultTimezone` is only used when the organization has never saved a row
 * here — the Settings screen passes the organization's own timezone so a
 * first-ever visit pre-selects that instead of a hardcoded UTC. Once a row
 * exists, its saved `send_timezone` is returned as-is, including a
 * deliberately-chosen "UTC".
 */
export const getEmailSettings = async (
  orgId: string,
  defaultTimezone?: string,
): Promise<EmailSettings> => {
  const { data, error } = await supabase
    .from("email_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    logger.error("Failed to load email settings:", error);
    throw error;
  }

  return data
    ? mapEmailSettingsRow(data as EmailSettingsRow)
    : defaultEmailSettings(orgId, defaultTimezone);
};

/**
 * Validates the window and jitter ordering client-side before writing, so an
 * admin sees "start hour must be before the end hour" instead of migration
 * 156's `email_settings_window_order_check` / `_jitter_order_check`
 * constraint violations, which PostgREST reports as an opaque 23514.
 */
export const saveEmailSettings = async (orgId: string, settings: EmailSettings): Promise<void> => {
  if (settings.window.startHour >= settings.window.endHour) {
    throw new Error("Send window start hour must be before the end hour.");
  }
  if (settings.jitterMinMs > settings.jitterMaxMs) {
    throw new Error("Jitter minimum must not be greater than the jitter maximum.");
  }
  if (settings.jitterMaxMs > MAX_JITTER_MS) {
    throw new Error(
      `The pause between messages cannot be longer than ${MAX_JITTER_MS / 1000} seconds.`,
    );
  }
  // An empty day list saves cleanly and then matches no day of the week, so
  // the organization silently stops sending with nothing on screen saying why.
  if (settings.window.days.length === 0) {
    throw new Error("Pick at least one day to send on.");
  }

  const row = {
    organization_id: orgId,
    send_window_enabled: settings.window.enabled,
    send_window_start: settings.window.startHour,
    send_window_end: settings.window.endHour,
    send_days: settings.window.days,
    send_timezone: settings.window.timezone,
    jitter_min_ms: settings.jitterMinMs,
    jitter_max_ms: settings.jitterMaxMs,
  };

  const { error } = await supabase
    .from("email_settings")
    .upsert(row, { onConflict: "organization_id" });

  if (error) {
    logger.error("Failed to save email settings:", error);
    throw error;
  }
};

/**
 * Posts to `POST /api/email/domain-auth` with the caller's own session
 * token — the same pattern `saveAccountSecret` uses for its own route — since
 * the DNS lookups run server-side; a browser cannot open a raw resolver
 * connection.
 */
export const checkDomainAuth = async (domain: string): Promise<DomainAuthReport> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch("/api/email/domain-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ domain }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? `Failed to check domain authentication: ${res.status}`;
    logger.error("Failed to check domain authentication:", message);
    throw new Error(message);
  }

  return (await res.json()) as DomainAuthReport;
};

// ── Campaigns ─────────────────────────────────────────────────────────

/**
 * The campaigns a person composed, newest first.
 *
 * `kind = 'sequence'` is excluded at the query, not on screen: those are the
 * hidden campaigns that carry one sequence step's wording (migration 158e),
 * one per step per sequence, and listing them would bury the campaigns
 * somebody actually wrote under rows they never created and cannot act on.
 * They are reached through the Sequences tab, which is where they mean
 * something.
 */
export const listCampaigns = async (
  orgId: string,
  workspaceId: string | null,
): Promise<EmailCampaign[]> => {
  let query = supabase
    .from("email_campaigns")
    .select("*")
    .eq("organization_id", orgId)
    .neq("kind", "sequence");
  if (workspaceId !== null) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email campaigns:", error);
    throw error;
  }

  return ((data ?? []) as EmailCampaignRow[]).map(mapCampaignRow);
};

export const createCampaign = async (input: CreateCampaignInput): Promise<EmailCampaign> => {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    created_by: input.createdBy ?? null,
    account_id: input.accountId,
    kind: input.kind,
    name: input.name,
    subject: input.subject,
    body_html: input.bodyHtml,
    scheduled_at: input.scheduledAt ? input.scheduledAt.toISOString() : null,
    // rate_per_hour is deliberately not written. Migration 156 removed the
    // claim's hourly arithmetic and the worker has no hourly logic, so any
    // value stored there would be a number the product collects and never
    // honours. The column stays for the old rows that carry one; pacing comes
    // from the send window, the jitter and each mailbox's daily limit.
  };

  const { data, error } = await supabase
    .from("email_campaigns")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create email campaign:", error);
    throw error;
  }

  return mapCampaignRow(data as EmailCampaignRow);
};

/**
 * Flips a campaign's status — e.g. out of the table's default `'draft'` and
 * into `'sending'` or `'scheduled'` once its outbox rows exist. Nothing else
 * does this: `createCampaign` never sets a status on insert, and
 * `claim_email_batch` (the worker's claim query) only picks up messages
 * whose campaign is already `'sending'` or `'scheduled'`, so a campaign left
 * at `'draft'` would sit forever.
 */
export const setCampaignStatus = async (campaignId: string, status: CampaignStatus): Promise<void> => {
  const { error } = await supabase
    .from("email_campaigns")
    .update({ status })
    .eq("id", campaignId);

  if (error) {
    logger.error("Failed to update campaign status:", error);
    throw error;
  }
};

const QUEUE_CHUNK_SIZE = 500;

/**
 * Splits `recipients` against the org's suppression list and inserts one
 * `email_messages` row per sendable recipient, in chunks of 500. Suppressed
 * recipients are filtered out by `filterSuppressed` *before* any insert is
 * built, so the insert payload never contains one — there is no code path
 * where a suppressed address reaches `.insert(...)`.
 *
 * `sendAfter`, when given, is written onto every inserted row's `send_after`
 * so a scheduled campaign's messages aren't claimable by the worker until
 * that time (`claim_email_batch` gates on `send_after <= now()`). Omit it —
 * or pass `null` — to keep the column's default of `now()`, i.e. claimable
 * immediately.
 */
export const queueRecipients = async (
  campaignId: string,
  orgId: string,
  recipients: Recipient[],
  sendAfter?: Date | null,
): Promise<{ queued: number; suppressed: number }> => {
  const { data: suppressionRows, error: suppressionError } = await supabase
    .from("email_suppressions")
    .select("email")
    .eq("organization_id", orgId);

  if (suppressionError) {
    logger.error("Failed to load suppressions for queueRecipients:", suppressionError);
    throw suppressionError;
  }

  const suppressedEmails = ((suppressionRows ?? []) as { email: string }[]).map((r) => r.email);
  const { sendable, suppressed } = filterSuppressed(recipients, suppressedEmails);

  for (let i = 0; i < sendable.length; i += QUEUE_CHUNK_SIZE) {
    const chunk = sendable.slice(i, i + QUEUE_CHUNK_SIZE).map((r) => ({
      campaign_id: campaignId,
      organization_id: orgId,
      contact_id: r.contactId ?? null,
      to_email: r.email,
      to_name: r.name ?? null,
      merge_data: r.mergeData ?? {},
      ...(sendAfter ? { send_after: sendAfter.toISOString() } : {}),
    }));

    const { error } = await supabase.from("email_messages").insert(chunk);
    if (error) {
      logger.error("Failed to queue email_messages batch:", error);
      throw error;
    }
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from("email_campaigns")
    .select("queued_count, suppressed_count")
    .eq("id", campaignId)
    .single();

  if (campaignError) {
    logger.error("Failed to load campaign for count update:", campaignError);
    throw campaignError;
  }

  const queuedCount = (campaignRow?.queued_count ?? 0) + sendable.length;
  const suppressedCount = (campaignRow?.suppressed_count ?? 0) + suppressed.length;

  const { error: updateError } = await supabase
    .from("email_campaigns")
    .update({ queued_count: queuedCount, suppressed_count: suppressedCount })
    .eq("id", campaignId);

  if (updateError) {
    logger.error("Failed to update campaign counts:", updateError);
    throw updateError;
  }

  return { queued: sendable.length, suppressed: suppressed.length };
};

export const listMessages = async (campaignId: string): Promise<EmailMessage[]> => {
  const { data, error } = await supabase
    .from("email_messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Failed to list email messages:", error);
    throw error;
  }

  return ((data ?? []) as EmailMessageRow[]).map(mapMessageRow);
};

// ── Suppressions ──────────────────────────────────────────────────────

export const listSuppressions = async (orgId: string): Promise<EmailSuppression[]> => {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email suppressions:", error);
    throw error;
  }

  return ((data ?? []) as EmailSuppressionRow[]).map(mapSuppressionRow);
};

export const addSuppression = async (orgId: string, email: string): Promise<void> => {
  const { error } = await supabase.from("email_suppressions").upsert(
    { organization_id: orgId, email: normalizeEmail(email), reason: "manual" },
    { onConflict: "organization_id,email" },
  );

  if (error) {
    logger.error("Failed to add email suppression:", error);
    throw error;
  }
};

export const removeSuppression = async (id: string): Promise<void> => {
  const { error } = await supabase.from("email_suppressions").delete().eq("id", id);

  if (error) {
    logger.error("Failed to remove email suppression:", error);
    throw error;
  }
};

// ── Inbox ─────────────────────────────────────────────────────────────

/**
 * What the inbox scans found, newest first — every reply and every bounce,
 * matched or not (migration 157c). An unmatched bounce (`messageId: null`)
 * is not a bug: it means a bounce notification arrived for an address this
 * organization never actually mailed, and nothing was suppressed for it.
 *
 * Scaffolding: nothing in the app calls this yet. `MailboxCard` reads a
 * mailbox's own `imapStatus`/`imapLastError`, and `CampaignsTab` reads
 * `EmailMessage.repliedAt`/`bouncedAt` and `EmailCampaign.repliedCount`/
 * `bouncedCount` directly, so neither screen needed the raw per-event list.
 * This exists because the brief specified it as part of the service layer's
 * interface, and it is the natural read for a future support/audit view —
 * e.g. "why is this address suppressed?" or "we saw a bounce that matched
 * nothing" — kept in place deliberately rather than unused-and-forgotten.
 */
export const listInboxEvents = async (orgId: string, limit = 50): Promise<InboxEvent[]> => {
  const { data, error } = await supabase
    .from("email_inbox_events")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("Failed to list inbox events:", error);
    throw error;
  }

  return ((data ?? []) as InboxEventRow[]).map(mapInboxEventRow);
};

// ── Recipients ────────────────────────────────────────────────────────

export const contactsForCampaign = async (
  orgId: string,
  workspaceId: string | null,
): Promise<Recipient[]> => {
  let query = supabase
    .from("crm_contacts")
    .select("id, first_name, last_name, email, company_id")
    .eq("organization_id", orgId)
    .not("email", "is", null);
  if (workspaceId !== null) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to load CRM contacts for campaign:", error);
    throw error;
  }

  return ((data ?? []) as CrmContactRow[]).map((row) => {
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    return {
      email: row.email as string,
      name: fullName || undefined,
      contactId: row.id,
      mergeData: {
        first_name: row.first_name,
        last_name: row.last_name ?? "",
        full_name: fullName,
        email: row.email,
      },
    };
  });
};

const PASTED_SEPARATOR_RE = /[\n,;]+/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_EMAIL_RE = /^(.*)<([^<>]+)>$/;

export const parsePastedRecipients = (
  text: string,
): { recipients: Recipient[]; errors: string[] } => {
  const entries = text
    .split(PASTED_SEPARATOR_RE)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const errors: string[] = [];
  const parsed: Recipient[] = [];

  for (const entry of entries) {
    let email = entry;
    let name: string | undefined;

    const match = entry.match(NAME_EMAIL_RE);
    if (match) {
      name = match[1].trim() || undefined;
      email = match[2].trim();
    }

    if (!EMAIL_RE.test(email)) {
      errors.push(`Not a valid email address: ${entry}`);
      continue;
    }

    parsed.push({ email, name, mergeData: {} });
  }

  return { recipients: dedupeRecipients(parsed), errors };
};

/** Normalizes a header for matching the email column: strips whitespace,
 *  underscores and hyphens entirely so "Email Address", "email_address" and
 *  "EmailAddress" all match. */
const normalizeHeaderForMatch = (header: string): string =>
  header.trim().toLowerCase().replace(/[\s_-]+/g, "");

/** Normalizes a header into a snake_case merge-data key, keeping word
 *  boundaries (unlike the stricter match-only normalization above). */
const normalizeHeaderToSnakeCase = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

export const parseRecipientsCsv = (
  text: string,
): { recipients: Recipient[]; errors: string[] } => {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = result.meta?.fields ?? [];
  const emailHeader = headers.find((header) => {
    const key = normalizeHeaderForMatch(header);
    return key === "email" || key === "emailaddress";
  });

  if (!emailHeader) {
    return { recipients: [], errors: ['No "email" column found in the CSV'] };
  }

  const mergeHeaders = headers.filter((header) => header !== emailHeader);

  const recipients: Recipient[] = [];
  for (const row of result.data ?? []) {
    const email = String(row[emailHeader] ?? "").trim();
    if (!email) continue;

    const mergeData: Record<string, unknown> = {};
    for (const header of mergeHeaders) {
      mergeData[normalizeHeaderToSnakeCase(header)] = row[header];
    }

    recipients.push({ email, mergeData });
  }

  return { recipients, errors: [] };
};
