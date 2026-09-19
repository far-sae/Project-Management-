// Pure helper for template statistics. No Supabase, no network, no React.
//
// Every number here is a sum over columns that already exist on
// email_campaigns, maintained by record_send_result(), record_inbox_result()
// and record_email_open(). There is deliberately no new counting path: a
// second place that counts sends is a second place for the two to disagree.

import type { EmailCampaign } from './types';

export interface TemplateStats {
  /** Campaigns created from this template. */
  campaigns: number;
  sent: number;
  failed: number;
  /** Messages opened by something that looked like a person. */
  opened: number;
  /**
   * Messages whose first open looked automatic.
   *
   * Kept apart from `opened` rather than folded in, exactly as phase 4
   * established: Apple Mail pre-fetches every image in every message, so a
   * merged figure would report a template as read by people who never saw it.
   */
  openedAutomatically: number;
  replied: number;
  bounced: number;
}

export const EMPTY_TEMPLATE_STATS: TemplateStats = {
  campaigns: 0,
  sent: 0,
  failed: 0,
  opened: 0,
  openedAutomatically: 0,
  replied: 0,
  bounced: 0,
};

/**
 * Totals per template id, from the campaigns that carry one.
 *
 * A campaign with no `templateId` is skipped rather than grouped under a
 * placeholder key: it was written from scratch, and counting it anywhere would
 * make some template look better than it is.
 */
export function templateStats(campaigns: EmailCampaign[]): Record<string, TemplateStats> {
  const totals: Record<string, TemplateStats> = {};

  for (const campaign of campaigns) {
    const id = campaign.templateId;
    if (!id) continue;

    const current = totals[id] ?? { ...EMPTY_TEMPLATE_STATS };
    totals[id] = {
      campaigns: current.campaigns + 1,
      sent: current.sent + campaign.sentCount,
      failed: current.failed + campaign.failedCount,
      opened: current.opened + campaign.openedCount,
      openedAutomatically: current.openedAutomatically + campaign.openedPrefetchCount,
      replied: current.replied + campaign.repliedCount,
      bounced: current.bounced + campaign.bouncedCount,
    };
  }

  return totals;
}

/**
 * Replies as a share of messages sent, or null when nothing has been sent.
 *
 * Null rather than zero, because the two mean different things and a template
 * nobody has used yet showing "0%" reads as a template that does not work.
 *
 * There is no equivalent for opens, deliberately. An open rate computed from a
 * number the product itself describes as an estimate with a large false
 * positive rate is a figure with a decimal point and no meaning, and it is the
 * one people quote.
 */
export function replyRate(stats: TemplateStats): number | null {
  if (stats.sent === 0) return null;
  return stats.replied / stats.sent;
}
