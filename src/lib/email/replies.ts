/**
 * The Replies list: everyone who answered an email, newest first, with what
 * they answered and where to find them. Pure.
 *
 * The inbox scan keeps who replied, when, and to which sent email. It never
 * keeps a subject or a body, so there is no reply text to show here: that
 * stays in the mailbox it arrived in.
 */

export interface ReplyEvent {
  id: string;
  kind: 'reply' | 'bounce' | 'auto_reply';
  address: string;
  accountId: string | null;
  messageId: string | null;
  createdAt: Date;
}

export interface RepliedMessage {
  id: string;
  campaignId: string;
  contactId: string | null;
  toName: string | null;
}

export interface RepliedCampaign {
  id: string;
  name: string;
  subject: string;
  kind: 'single' | 'bulk' | 'sequence';
  workspaceId: string | null;
}

export interface ReplyRow {
  id: string;
  /** The person's name when the sent email had one, else their address. */
  who: string;
  address: string;
  /** True for an out-of-office or other automatic answer: nobody has read the email. */
  automatic: boolean;
  /** What they answered: the campaign's name, or "a sequence email". */
  answered: string;
  subject: string;
  /** The mailbox the reply is in, or null when that mailbox was removed since. */
  mailbox: string | null;
  /** The lead, when the email went to one. */
  contactId: string | null;
  at: Date;
}

/**
 * The replies of one workspace. A reply that matches no sent email, or an
 * email of another workspace, is left out: there is nothing to say about it
 * here. Bounces are not replies and are left out too.
 */
export function buildReplies(
  events: ReplyEvent[],
  messages: RepliedMessage[],
  campaigns: RepliedCampaign[],
  mailboxes: Array<{ id: string; label: string; fromEmail: string }>,
  workspaceId: string | null,
): ReplyRow[] {
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const mailboxById = new Map(mailboxes.map((m) => [m.id, m]));
  const rows: ReplyRow[] = [];
  for (const event of events) {
    if (event.kind === 'bounce') continue;
    const message = event.messageId ? messageById.get(event.messageId) : undefined;
    const campaign = message ? campaignById.get(message.campaignId) : undefined;
    if (!message || !campaign) continue;
    if (workspaceId !== null && campaign.workspaceId !== workspaceId) continue;
    const mailbox = event.accountId ? mailboxById.get(event.accountId) : undefined;
    rows.push({
      id: event.id,
      who: message.toName?.trim() || event.address,
      address: event.address,
      automatic: event.kind === 'auto_reply',
      answered: campaign.kind === 'sequence' ? 'a sequence email' : campaign.name,
      subject: campaign.subject,
      mailbox: mailbox ? `${mailbox.label} (${mailbox.fromEmail})` : null,
      contactId: message.contactId,
      at: event.createdAt,
    });
  }
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** How many real answers there are (automatic ones are not answers). */
export const realReplies = (rows: ReplyRow[]): number => rows.filter((r) => !r.automatic).length;
