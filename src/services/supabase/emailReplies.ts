import { supabase } from './config';
import { buildReplies, type RepliedCampaign, type RepliedMessage, type ReplyEvent, type ReplyRow } from '@/lib/email/replies';
import { renderSentEmail, type SentEmailView } from '@/lib/email/sentEmail';
import type { CampaignKind } from '@/lib/email/types';

/** Replies looked at for the list: the newest ones. */
export const REPLIES_LIMIT = 200;

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The replies of a workspace, newest first.
 *
 * Three plain reads (the events, the emails they answer, those emails'
 * campaigns) and one of the mailboxes, put together in the browser. The words
 * of a reply are not read here: they are asked for when one is opened
 * (`loadReplyText`).
 */
export async function listReplies(orgId: string, workspaceId: string | null): Promise<ReplyRow[]> {
  const found = await supabase
    .from('email_inbox_events')
    .select('id, kind, address, account_id, message_id, created_at')
    .eq('organization_id', orgId)
    .in('kind', ['reply', 'auto_reply'])
    .order('created_at', { ascending: false })
    .limit(REPLIES_LIMIT);
  if (found.error) throw found.error;
  const events: ReplyEvent[] = ((found.data ?? []) as Row[]).map((r) => ({
    id: text(r.id),
    kind: r.kind as ReplyEvent['kind'],
    address: text(r.address),
    accountId: (r.account_id as string | null) ?? null,
    messageId: (r.message_id as string | null) ?? null,
    createdAt: new Date(text(r.created_at)),
  }));

  const messageIds = [...new Set(events.map((e) => e.messageId).filter((id): id is string => !!id))];
  if (messageIds.length === 0) return [];
  const sent = await supabase.from('email_messages').select('id, campaign_id, contact_id, to_name').in('id', messageIds);
  if (sent.error) throw sent.error;
  const messages: RepliedMessage[] = ((sent.data ?? []) as Row[]).map((r) => ({
    id: text(r.id),
    campaignId: text(r.campaign_id),
    contactId: (r.contact_id as string | null) ?? null,
    toName: (r.to_name as string | null) ?? null,
  }));

  const campaignIds = [...new Set(messages.map((m) => m.campaignId))];
  const [of, boxes] = await Promise.all([
    campaignIds.length > 0
      ? supabase.from('email_campaigns').select('id, name, subject, kind, workspace_id').in('id', campaignIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('email_accounts').select('id, label, from_email').eq('organization_id', orgId),
  ]);
  if (of.error) throw of.error;
  // The mailbox name is a nicety: a list without it is better than no list.
  const mailboxes = boxes.error ? [] : ((boxes.data ?? []) as Row[]).map((r) => ({ id: text(r.id), label: text(r.label), fromEmail: text(r.from_email) }));
  const campaigns: RepliedCampaign[] = ((of.data ?? []) as Row[]).map((r) => ({
    id: text(r.id),
    name: text(r.name),
    subject: text(r.subject),
    kind: r.kind as RepliedCampaign['kind'],
    workspaceId: (r.workspace_id as string | null) ?? null,
  }));

  return buildReplies(events, messages, campaigns, mailboxes, workspaceId);
}

/** The words of one reply, as the inbox scan kept them (migration 217). */
export interface ReplyText {
  subject: string;
  body: string;
}

/**
 * The words of one reply, or null when none were kept: a reply from before
 * the texts were kept, one whose message had no text, or a database that has
 * not got the table yet. None of those is a fault to show: the window says
 * where the reply can be read instead.
 */
export async function loadReplyText(eventId: string): Promise<ReplyText | null> {
  const found = await supabase.from('email_reply_texts').select('subject, body_text').eq('event_id', eventId).maybeSingle();
  if (found.error || !found.data) return null;
  const row = found.data as Row;
  return { subject: text(row.subject), body: text(row.body_text) };
}

/** One sent email, with everything the window shows about it. */
export interface SentEmail {
  to: string;
  toName: string | null;
  /** The name the email was shown as from: the campaign's own when it has one, else the mailbox's. */
  fromName: string | null;
  /** Empty when the mailbox that sent it has been removed since. */
  fromEmail: string;
  /** Null while it has not gone out yet. */
  sentAt: Date | null;
  status: string;
  campaignName: string;
  view: SentEmailView;
}

/**
 * One email of a campaign as the person got it: the campaign's wording with
 * that person's own values filled in, and the signature of the mailbox that
 * sent it. Nothing extra is stored for this; it is put together again from
 * what the campaign and the email already keep.
 */
export async function loadSentEmail(messageId: string): Promise<SentEmail> {
  const message = await supabase.from('email_messages').select('*').eq('id', messageId).maybeSingle();
  if (message.error) throw message.error;
  const m = message.data as Row | null;
  if (!m) throw new Error('This email was not found.');

  const campaign = await supabase.from('email_campaigns').select('*').eq('id', text(m.campaign_id)).maybeSingle();
  if (campaign.error) throw campaign.error;
  const c = campaign.data as Row | null;
  if (!c) throw new Error('This email was not found.');

  // The mailbox that sent it, or (not sent yet) the one the campaign names. It may be gone: the email is still shown.
  const accountId = text(m.sent_account_id) || text(c.account_id);
  let a: Row | null = null;
  if (accountId) {
    const account = await supabase.from('email_accounts').select('from_name, from_email, signature_html').eq('id', accountId).maybeSingle();
    a = account.error ? null : ((account.data as Row | null) ?? null);
  }

  const merge = m.merge_data && typeof m.merge_data === 'object' ? (m.merge_data as Record<string, unknown>) : {};
  const kind = (text(c.kind) || 'bulk') as CampaignKind;
  return {
    to: text(m.to_email),
    toName: text(m.to_name) || null,
    fromName: text(c.sender_name).trim() || text(a?.from_name) || null,
    fromEmail: text(a?.from_email),
    sentAt: m.sent_at ? new Date(text(m.sent_at)) : null,
    status: text(m.status),
    campaignName: text(c.name),
    view: renderSentEmail({ kind, subject: text(c.subject), bodyHtml: text(c.body_html), mergeData: merge, signatureHtml: text(a?.signature_html) }),
  };
}
