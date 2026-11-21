import { supabase } from './config';
import { buildReplies, type RepliedCampaign, type RepliedMessage, type ReplyEvent, type ReplyRow } from '@/lib/email/replies';

/** Replies looked at for the list: the newest ones. */
export const REPLIES_LIMIT = 200;

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The replies of a workspace, newest first.
 *
 * Three plain reads (the events, the emails they answer, those emails'
 * campaigns) and one of the mailboxes, put together in the browser. No reply
 * text is read because none is stored.
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
