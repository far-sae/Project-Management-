/**
 * The set-up check: the parts of the CRM that need a database file run once,
 * and how to tell from the database's answer whether that was done. Pure.
 */

/** What to ask the database to learn whether a file was run. */
export type Probe =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; column: string }
  /** Called with arguments it refuses, so it answers without changing anything. */
  | { kind: 'function'; name: string; args: Record<string, unknown> }
  /** The file only adds something the app cannot see (a trigger). */
  | { kind: 'none' };

export type SetupState = 'ready' | 'missing' | 'unknown';

export interface SetupPart {
  id: string;
  name: string;
  /** What you get once it is set up, in one sentence. */
  gives: string;
  /** The file in supabase/migrations to run in the Supabase SQL editor. */
  file: string;
  probe: Probe;
}

export const SETUP_PARTS: SetupPart[] = [
  { id: 'automation', name: 'AI automation', gives: 'Agents that follow up leads and move deals for you.', file: '187_automation.sql', probe: { kind: 'table', table: 'auto_rules' } },
  { id: 'calls', name: 'Calling', gives: 'Calls from a lead or a company, with the recording.', file: '188_crm_calls.sql', probe: { kind: 'table', table: 'crm_calls' } },
  { id: 'warmup', name: 'Email warm-up', gives: 'Warm-up, spam and bounce figures for your mailboxes.', file: '189_email_warmup.sql', probe: { kind: 'table', table: 'email_warmup_keys' } },
  { id: 'emailTimeline', name: 'Emails on the lead’s timeline', gives: 'Bulk and sequence emails show on the lead they were sent to.', file: '190_email_on_lead_timeline.sql', probe: { kind: 'none' } },
  { id: 'documentTimeline', name: 'Documents on the deal’s timeline', gives: 'Agreements and invoices show on the deal they belong to.', file: '191_documents_on_deal_timeline.sql', probe: { kind: 'none' } },
  { id: 'forms', name: 'Web forms', gives: 'A form for your website that makes a lead by itself.', file: '192_crm_lead_forms.sql', probe: { kind: 'table', table: 'crm_lead_forms' } },
  { id: 'merge', name: 'Merging duplicate leads', gives: 'Two leads with the same email become one.', file: '193_crm_merge_leads.sql', probe: { kind: 'function', name: 'crm_merge_contacts', args: { p_keep: null, p_drop: null } } },
  { id: 'followUps', name: 'Follow-up types and repeats', gives: 'A follow-up can be a call, an email or a meeting, and can repeat.', file: '194_crm_follow_up_kinds.sql', probe: { kind: 'column', table: 'crm_tasks', column: 'kind' } },
  { id: 'erase', name: 'Erasing a person', gives: 'Removes everything about one person when they ask for it.', file: '195_crm_erase_person.sql', probe: { kind: 'function', name: 'crm_erase_person', args: { p_contact: null } } },
  { id: 'formSharing', name: 'Sharing web-form leads', gives: 'A form gives its leads to several people in turn.', file: '196_crm_lead_form_sharing.sql', probe: { kind: 'column', table: 'crm_lead_forms', column: 'share_with' } },
  { id: 'history', name: 'Recycle bin and change log', gives: 'Deleted leads, companies and deals can be put back for 30 days, and every change says who made it.', file: '197_crm_recycle_bin_and_changes.sql', probe: { kind: 'table', table: 'crm_trash' } },
];

/** The database's codes for "there is no such table / column / function". */
const NO_TABLE = new Set(['42P01', 'PGRST205']);
const NO_COLUMN = new Set(['42703', 'PGRST204']);
const NO_FUNCTION = new Set(['42883', 'PGRST202']);
/** "You may not read this": it is there. */
const NOT_ALLOWED = '42501';

/**
 * Whether the part is set up, from the answer to its probe. `unknown` when the
 * answer says nothing about it (the request failed, the sign-in ran out) or
 * when there is nothing the app can ask.
 */
export function probeState(probe: Probe, error: { code?: string; message?: string } | null): SetupState {
  if (probe.kind === 'none') return 'unknown';
  const code = error?.code ?? '';
  if (probe.kind === 'function') {
    if (!error) return 'ready';
    if (NO_FUNCTION.has(code)) return 'missing';
    // Any answer written by the function itself, or by the database about its arguments, means it exists.
    return code ? 'ready' : 'unknown';
  }
  if (!error || code === NOT_ALLOWED) return 'ready';
  if (NO_TABLE.has(code)) return 'missing';
  if (probe.kind === 'column' && NO_COLUMN.has(code)) return 'missing';
  return 'unknown';
}
