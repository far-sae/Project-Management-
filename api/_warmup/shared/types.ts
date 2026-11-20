/**
 * Mailbox warm-up, as the Email page and its server talk about it.
 *
 * Warm-up is done by a paid service (MailReach): the mailbox exchanges real
 * emails with a network of other inboxes, which open them, reply and move
 * them out of spam, so that mail providers learn to trust the address. This
 * app connects the mailbox to that service and shows what it reports.
 */

/** Where a mailbox stands with the warm-up service. */
export type WarmupState =
  /** The mailbox is not in the warm-up service yet. */
  | "not_connected"
  /** Warming. */
  | "warming"
  /** In the service, but warm-up was paused. */
  | "paused"
  /** In the service, with warm-up switched off there. */
  | "off"
  /** The service can no longer sign in to the mailbox. */
  | "disconnected";

export type WarmupMailbox = {
  state: WarmupState;
  /** The service's reputation score for the mailbox, as it reports it, or null when it has none yet. */
  score: number | null;
  /** Whole days since the mailbox was added to the service. */
  days: number | null;
  /** Warm-up emails sent in the period, and how many of them landed in spam. */
  sent: number;
  spam: number;
  /** spam / sent as a percentage (one decimal), or null while nothing has been sent. */
  spamPercent: number | null;
  /** True once the mailbox has warmed long enough, with little enough landing in spam, to send campaigns from. */
  ready: boolean;
};

/** GET /api/email/warmup?do=status */
export type WarmupStatus = {
  /** True once an API key of the warm-up service has been saved for the organisation. */
  linked: boolean;
  /** What stops warm-up from working, as one sentence, or null. */
  problem: string | null;
  /** The days the sent / spam figures cover. */
  periodDays: number;
  /** By mailbox id (email_accounts.id). Empty while not linked. */
  mailboxes: Record<string, WarmupMailbox>;
};

/** A mailbox counts as warmed after this many days in the service… */
export const WARM_DAYS = 14;
/** …once at least this many warm-up emails went out in the period… */
export const WARM_MIN_SENT = 20;
/** …and no more than this share of them landed in spam. */
export const WARM_MAX_SPAM_PERCENT = 10;
/** The period the figures cover. */
export const PERIOD_DAYS = 14;

/** Why a mailbox is not ready to send campaigns yet, in a few words; null when it is. */
export function notReadyReason(m: WarmupMailbox): string | null {
  if (m.ready) return null;
  if (m.state === "not_connected") return "Warm-up has not been started for this mailbox.";
  if (m.state === "disconnected") return "The warm-up service can no longer sign in to this mailbox.";
  if (m.state === "paused") return "Warm-up is paused.";
  if (m.state === "off") return "Warm-up is switched off for this mailbox in MailReach.";
  if (m.days !== null && m.days < WARM_DAYS) {
    const left = WARM_DAYS - m.days;
    return `Warming for ${m.days} day${m.days === 1 ? "" : "s"}: ${left} more to go.`;
  }
  if (m.spamPercent !== null && m.spamPercent > WARM_MAX_SPAM_PERCENT) return `${m.spamPercent}% of its warm-up emails still land in spam.`;
  return "Not enough warm-up emails have been sent yet to judge.";
}
