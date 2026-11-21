import { supabase } from '../config';
import type { CrmContact } from '@/types/crmHub';
import { personExport, type PersonExport } from '@/lib/crmPersonData';
import { leadName } from '@/lib/crmFlow';
import { deletePersonCalls, personCalls } from '@/services/voice/client';
import { listActivities } from './activities';
import { listDeals } from './deals';
import { listTasks } from './tasks';

/** Shown when the erase function is not in the database yet. */
export const ERASE_NOT_SET_UP_MESSAGE =
  'Erasing a person is not set up yet: run supabase/migrations/195_crm_erase_person.sql in the Supabase SQL editor.';

type Row = Record<string, unknown>;

/** The emails sent to this lead, with the campaign each one belongs to. An empty list where email was never set up. */
async function emailsTo(contactId: string): Promise<Row[]> {
  const sent = await supabase
    .from('email_messages')
    .select('id, campaign_id, to_email, status, sent_at, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (sent.error) return [];
  const rows = (sent.data ?? []) as Row[];
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter((id): id is string => typeof id === 'string'))];
  const campaigns = campaignIds.length > 0 ? await supabase.from('email_campaigns').select('id, name, subject').in('id', campaignIds) : { data: [], error: null };
  const byId = new Map(((campaigns.error ? [] : campaigns.data ?? []) as Row[]).map((c) => [c.id as string, c]));
  return rows.map((r) => ({
    to: r.to_email,
    subject: byId.get(r.campaign_id as string)?.subject ?? null,
    campaign: byId.get(r.campaign_id as string)?.name ?? null,
    status: r.status,
    sentAt: r.sent_at,
  }));
}

/** Reads everything about one lead and puts it into one structure, ready to save as a file. */
export async function collectPersonData(contact: CrmContact, companyName: string | null): Promise<PersonExport> {
  const [deals, followUps, timeline, emails, calls] = await Promise.all([
    listDeals(contact.organizationId, { contactId: contact.id }),
    listTasks(contact.organizationId, { contactId: contact.id }),
    listActivities(contact.organizationId, { contactId: contact.id, limit: 2000 }),
    emailsTo(contact.id),
    // Calls are for the owner and admins; for anyone else the copy says they are missing.
    personCalls(contact.id).then((r) => r.calls as unknown as Row[]).catch(() => null),
  ]);
  return personExport(
    leadName(contact),
    {
      lead: contact as unknown as Row,
      company: companyName ? { name: companyName } : null,
      deals: deals as unknown as Row[],
      followUps: followUps as unknown as Row[],
      timeline: timeline as unknown as Row[],
      emails,
      calls,
    },
    new Date(),
  );
}

/**
 * Erases one person for good. First the call recordings at the phone provider
 * (the database cannot reach them), then everything in the database in one
 * step. The organisation's owner only; both steps check that themselves.
 */
export async function erasePerson(contactId: string): Promise<void> {
  await deletePersonCalls(contactId);
  const { error } = await supabase.rpc('crm_erase_person', { p_contact: contactId });
  if (!error) return;
  if (error.code === 'PGRST202' || error.code === '42883') throw new Error(ERASE_NOT_SET_UP_MESSAGE);
  throw new Error(error.message || 'This person could not be erased.');
}
