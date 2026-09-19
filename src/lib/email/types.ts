export type CampaignKind = 'single' | 'bulk';
/**
 * 'error' is the mailbox we could not read — a refused login, a host that
 * never answered. 'incomplete' is the mailbox we read perfectly well and whose
 * replies and bounces we then could not finish recording; nothing is wrong
 * with the credentials and the next scan re-reads the same window. Both hold
 * the scan cursor (migration 157e); only 'error' is the admin's problem.
 */
export type ImapStatus = 'unconfigured' | 'active' | 'error' | 'incomplete';
export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'suppressed';
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';
export type AccountStatus = 'unverified' | 'active' | 'error';
export type SuppressionReason = 'unsubscribed' | 'bounced' | 'complaint' | 'manual';

export interface EmailAccount {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  dailyLimit: number;
  status: AccountStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  /**
   * IMAP is optional (migration 157a) — `imapHost` is null on every mailbox
   * that has never had one set, which is every row that predates that
   * migration, and the mailbox sends exactly as before either way.
   */
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapStatus: ImapStatus;
  /** The reason the last scan failed, in `classifyImapError()`'s words. Null on a mailbox that has never failed a scan, and cleared by `touch_inbox_scan()` the moment one succeeds. Separate from `lastError`, which is about sending, never inbox scanning. */
  imapLastError: string | null;
  inboxLastScanAt: Date | null;
  /**
   * Whether a delivered send is also filed as a copy in this mailbox's own
   * Sent folder over IMAP. Defaults to on; independent of `imapHost` being
   * set at all — with no host configured there is nothing to file into, so
   * the switch is simply inert. Google hosts are skipped automatically
   * regardless of this switch (worker/lib/engine.ts), because Gmail already
   * files its own copy; this is the override for a Google Workspace mailbox
   * sent through a non-Google-named relay host, which the automatic
   * detection cannot see.
   */
  sentFolderEnabled: boolean;
}

export interface EmailCampaign {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  /** null = "the whole pool"; a value pins the campaign to one mailbox. */
  accountId: string | null;
  kind: CampaignKind;
  name: string;
  subject: string;
  bodyHtml: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  /**
   * Alongside the four counts above, but unlike them, never recomputed by
   * `finalize_email_campaigns()` (migration 155) — that function only
   * touches a campaign still `sending`/`scheduled`, and a reply or bounce
   * typically arrives well after a campaign has already closed to `sent`.
   * `record_inbox_result()` (migration 157d) increments these itself,
   * directly, once per message, on the same null-to-set transition that
   * writes `EmailMessage.repliedAt`/`bouncedAt`.
   */
  repliedCount: number;
  bouncedCount: number;
  createdAt: Date;
}

export interface EmailMessage {
  id: string;
  campaignId: string;
  organizationId: string;
  contactId: string | null;
  toEmail: string;
  toName: string | null;
  mergeData: Record<string, unknown>;
  status: MessageStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  /**
   * Set once, the first time `record_inbox_result()` (migration 157d) matches
   * a reply or a bounce to this message — the write there is gated on the
   * column still being null, so this never moves after it is first written,
   * and that same transition is what increments the campaign's
   * `repliedCount`/`bouncedCount` (never on a repeat). A bounce also adds
   * `toEmail` to `email_suppressions`; this column does not say so by
   * itself, which is why every screen that shows `bouncedAt` says it in
   * words next to it.
   */
  repliedAt: Date | null;
  bouncedAt: Date | null;
}

export interface EmailSuppression {
  id: string;
  organizationId: string;
  email: string;
  reason: SuppressionReason;
  createdAt: Date;
}

export interface SendWindow {
  enabled: boolean;
  startHour: number; // 0-23, inclusive
  endHour: number; // 0-23, exclusive
  days: number[]; // 1 = Monday … 7 = Sunday
  timezone: string; // IANA, e.g. 'Europe/London'
}

export interface MailboxHealth {
  id: string;
  label: string;
  fromEmail: string;
  isActive: boolean;
  pausedReason: string | null;
  status: AccountStatus;
  consecutiveFailures: number;
  lastSentAt: Date | null;
  effectiveLimit: number;
  sentToday: number;
  /**
   * The raw ramp inputs behind `effectiveLimit`, so a screen can render
   * "Warmup day N" versus "Full volume" without recomputing migration 156's
   * ramp arithmetic. Optional because the worker's own `toMailboxHealth()`
   * (worker/lib/engine.ts) only needs `effectiveLimit`/`sentToday` for
   * sending and does not set these; `mapMailboxStatusRow` (which the
   * screens use) populates all five from the same `mailbox_status` view row.
   */
  dailyLimit?: number;
  warmupEnabled?: boolean;
  warmupStartedOn?: Date | null;
  warmupStartVolume?: number;
  warmupIncrement?: number;
}

export interface EmailSettings {
  organizationId: string;
  window: SendWindow;
  jitterMinMs: number;
  jitterMaxMs: number;
}

/** A single INBOX message, as read over IMAP. Envelope only — no body. */
export interface InboxEnvelope {
  from: string;
  subject: string;
  at: Date;
}

/** A reply or bounce discovered during an inbox scan, ready to persist. */
export interface InboxEvent {
  id: string;
  organizationId: string;
  /**
   * The mailbox whose scan produced this event, or null once that mailbox
   * has been deleted — `email_inbox_events.account_id` is `on delete set
   * null` (migration 157c) specifically so the event record outlives the
   * mailbox rather than being erased along with it. Nullable here for the
   * same reason: the type should say so rather than paper over it.
   */
  accountId: string | null;
  kind: 'reply' | 'bounce';
  address: string;
  messageId: string | null;
  detail: string | null;
  createdAt: Date;
}
