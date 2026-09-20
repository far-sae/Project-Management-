/**
 * 'sequence' is the hidden campaign behind one step of a sequence (migration
 * 158e). It carries that step's wording, because `email_messages` has no
 * subject or body column of its own, and it is filtered out of the Campaigns
 * list -- one row per step per sequence would be the list's usefulness gone.
 */
export type CampaignKind = 'single' | 'bulk' | 'sequence';
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

/**
 * 'auto_reply' is recorded and does nothing else: it sets no `repliedAt`, so
 * it does not inflate the reply rate, and it does not stop a sequence, because
 * the person has not read the message. An out-of-office that stopped a
 * sequence would silence the follow-up for exactly the person who never saw
 * the first one.
 */
export type InboxEventKind = 'reply' | 'bounce' | 'auto_reply';

/** A sequence sends nothing until it is 'active'. See migration 158a. */
export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived';

/**
 * 'completed' walked every step. 'stopped' ended early and says why in
 * `stopReason`. Both are one-way: the recorded reason is the FIRST thing that
 * ended the enrollment, which is the one a complaint is ever about.
 */
export type EnrollmentStatus = 'active' | 'stopped' | 'completed';

/**
 * Why an enrollment ended. The scope of each differs and that is deliberate
 * (migration 159a/a2): 'replied', 'bounced' and 'unsubscribed' are things the
 * RECIPIENT did and stop every sequence at that address; 'failed' is something
 * our end did -- a send that would not go -- and stops only the enrollment it
 * happened to.
 */
export type StopReason = 'replied' | 'bounced' | 'unsubscribed' | 'failed' | 'manual';

export interface EmailSequence {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  name: string;
  status: SequenceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailSequenceStep {
  id: string;
  sequenceId: string;
  /** 0 is the first message, sent on enrollment; its delay is ignored. */
  stepIndex: number;
  /** Hours after the previous step was actually SENT, never after enrollment. */
  delayHours: number;
  /** Empty inherits `Re: ` + step 0's subject. See `followUpSubject`. */
  subject: string;
  bodyHtml: string;
  /**
   * The hidden campaign carrying this step's wording. Null means the step is
   * not sendable yet: `claim_sequence_enrollments()` leaves such an enrollment
   * due rather than advancing past it, so it sends the moment this is filled.
   */
  campaignId: string | null;
  createdAt: Date;
}

export interface EmailEnrollment {
  id: string;
  sequenceId: string;
  organizationId: string;
  contactId: string | null;
  toEmail: string;
  toName: string | null;
  mergeData: Record<string, unknown>;
  /**
   * Pinned on the first send and never before. A conversation that continues
   * from a different address is not a conversation: it breaks the recipient's
   * own threading. Null until then, meaning the whole pool is available.
   */
  accountId: string | null;
  /** The step this enrollment will send NEXT. */
  currentStep: number;
  /** Null means nothing is scheduled: the previous step is queued but unsent, or it is over. */
  nextDueAt: Date | null;
  lastMessageId: string | null;
  status: EnrollmentStatus;
  stopReason: StopReason | null;
  stoppedAt: Date | null;
  createdAt: Date;
}

export interface EmailAccount {
  id: string;
  /**
   * The signature appended to every message THIS mailbox sends.
   *
   * On the mailbox rather than on the campaign or the user, because a campaign
   * sends from a pool and the sending mailbox is not chosen until send time.
   * A signature stored anywhere else would sign mail from one address with
   * another one's name. Empty means no signature. See migration 163.
   */
  signatureHtml: string;
  /**
   * The share of recent mail that may bounce before this mailbox pauses
   * itself, as a percentage. Migration 164a; defaults to 5.
   *
   * Per mailbox because tolerance genuinely differs — a list somebody typed
   * at a conference bounces more than one that opted in, and one threshold
   * for both is either useless or punitive.
   */
  bouncePausePercent: number;
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
  /**
   * Messages of this campaign that were opened — a count of MESSAGES, not of
   * image fetches, so somebody who opens one message fifty times counts once.
   *
   * It is an estimate and every screen that shows it says so. Apple Mail
   * pre-fetches every image in every message and has since 2021, so a share of
   * this number is nobody reading anything; `openWasPrefetch` on the message is
   * what separates the two.
   */
  openedCount: number;
  /**
   * Messages whose first open looked automatic — a known proxy, or a fetch
   * inside the detection window after the send.
   *
   * Kept apart from `openedCount` rather than merged into it or discarded.
   * Merging would report a campaign to sixty iPhone users as sixty opens with
   * nobody having opened anything; discarding would hide that the number above
   * is a floor. Every screen that shows one shows the other.
   */
  openedPrefetchCount: number;
  /**
   * The template this campaign's wording was copied from, or null when it was
   * written from scratch.
   *
   * A record of provenance, not a live link: the campaign carries its own
   * subject and body, so editing the template afterwards cannot rewrite mail
   * that has already gone out. ON DELETE SET NULL, so deleting a template does
   * not take the record of what was sent with it.
   */
  templateId: string | null;
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
  /** First open, which never moves once set. Null if never opened. */
  openedAt: Date | null;
  /** Most recent open, which does move. */
  lastOpenedAt: Date | null;
  /** Every fetch of the pixel, including the same person's client re-rendering. */
  openCount: number;
  /**
   * True when the FIRST open looked automatic. Decided once and never
   * revisited, so a person who opens a message after Apple pre-fetched it
   * leaves this true — which undercounts rather than overcounts, and the
   * screens say the number is a floor.
   */
  openWasPrefetch: boolean;
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
  /**
   * Whether a tracking pixel is put in this organization's bulk mail.
   *
   * False unless somebody turned it on, and that is a decision rather than
   * caution: recording when a customer's customer opened an email is
   * surveillance however ordinary it has become. See migration 161a.
   */
  trackOpens: boolean;
}

/** A single INBOX message, as read over IMAP. Envelope only — no body. */
export interface InboxEnvelope {
  from: string;
  subject: string;
  at: Date;
  /**
   * The few headers the scan asks for alongside the envelope, lower-cased.
   * Headers, never a body: an ordinary message's body is still never pulled
   * into this process. Empty when the server sent none, which is not an error.
   */
  headers: Record<string, string>;
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
  kind: InboxEventKind;
  address: string;
  messageId: string | null;
  detail: string | null;
  createdAt: Date;
}

/** A named segment, and the angle it is approached with. See migration 162a. */
export interface EmailGroup {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  /**
   * How this segment is written to — "lead with the white-label workflow".
   * Available as `{{angle}}` in a template, so one template can serve several
   * groups.
   */
  angle: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Reusable wording. A campaign copies from one; it never points at one. */
export interface EmailTemplate {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdBy: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Somebody to write to: a `crm_contacts` row, read for outreach.
 *
 * Not a new table — those rows already exist, `email_messages.contact_id`
 * already references them, and the CRM hub's removal in migration 143 left
 * them with no screen rather than deleting them.
 */
export interface EmailProspect {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  /** The merge field that makes a cold email land. Migration 162d. */
  painPoint: string | null;
  groupId: string | null;
  /**
   * Whether this address is on the organization's suppression list, and why.
   *
   * Read from `email_suppressions` rather than stored on the contact. That
   * table is what claim_email_batch() enforces, what the unsubscribe endpoint
   * writes and what a hard bounce adds to; a second flag here would be a
   * second source of truth for the one question the law cares about, and the
   * two would disagree within a week.
   */
  suppressedReason: SuppressionReason | null;
  lastContactedAt: Date | null;
  createdAt: Date;
}
