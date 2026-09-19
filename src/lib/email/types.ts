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
  accountId: string;
  kind: 'reply' | 'bounce';
  address: string;
  messageId: string | null;
  detail: string | null;
  createdAt: Date;
}
