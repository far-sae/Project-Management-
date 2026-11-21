/**
 * The recycle bin and the change log of the CRM, as the screens show them.
 * Pure: turning stored rows and field names into plain words.
 */

export type HistoryKind = 'lead' | 'company' | 'deal';

export const KIND_LABEL: Record<HistoryKind, string> = { lead: 'Lead', company: 'Company', deal: 'Deal' };

/** Where a restored or changed record is opened. */
export const recordPath = (kind: HistoryKind, id: string): string =>
  kind === 'lead' ? `/crm/contacts/${id}` : kind === 'company' ? `/crm/companies/${id}` : `/crm/deals/${id}`;

/** How long a deleted record stays in the bin. The database clears older ones. */
export const TRASH_DAYS = 30;

export interface TrashItem {
  id: string;
  kind: HistoryKind;
  recordId: string;
  name: string;
  deletedBy: string | null;
  deletedAt: Date;
  /** How many notes and timeline entries come back with it. */
  notes: number;
  timeline: number;
}

export interface ChangeRow {
  id: string;
  kind: HistoryKind;
  recordId: string;
  name: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  changedBy: string | null;
  changedAt: Date;
}

/** Whole days until the bin lets go of it. Never below zero. */
export function daysLeft(deletedAt: Date, now: Date): number {
  const left = TRASH_DAYS - (now.getTime() - deletedAt.getTime()) / 86400000;
  return Math.max(0, Math.ceil(left));
}

const FIELD_LABEL: Record<string, string> = {
  first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone', job_title: 'Job title',
  company_id: 'Company', contact_id: 'Lead', owner_id: 'Owner', lifecycle_stage: 'Step', lead_status: 'Lead status',
  source: 'Source', notes: 'Notes', category: 'Category', custom_fields: 'Custom fields', name: 'Name', value: 'Value',
  stage_id: 'Stage', status: 'Status', expected_close_date: 'Expected close date', probability: 'Chance of winning',
  lost_reason: 'Reason lost', closed_at: 'Closed on', currency: 'Currency', project_id: 'Project', workspace_id: 'Workspace',
  website: 'Website', industry: 'Industry', city: 'City', country: 'Country', company_size: 'Company size', pain_point: 'Pain point',
};

/** A column name in plain words. One that is not known is shown tidied, not hidden. */
export function fieldLabel(key: string): string {
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  const words = key.replace(/_id$/, '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** The names behind the ids a change can hold. */
export interface HistoryNames {
  people: Map<string, string>;
  stages: Map<string, string>;
  companies: Map<string, string>;
  leads: Map<string, string>;
}

const LONGEST = 80;
const short = (text: string): string => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text);

/** One value of a change, as a person would say it. */
export function showValue(key: string, value: unknown, names: HistoryNames): string {
  if (value === null || value === undefined || value === '') return 'nothing';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') {
    if (key === 'owner_id') return names.people.get(value) ?? 'someone who has left';
    if (key === 'stage_id') return names.stages.get(value) ?? 'a stage that was deleted';
    if (key === 'company_id') return names.companies.get(value) ?? 'a company that was deleted';
    if (key === 'contact_id') return names.leads.get(value) ?? 'a lead that was deleted';
    if (key.endsWith('_id')) return 'something else';
    // "sales_qualified_lead" reads better as words.
    if (key === 'lifecycle_stage' || key === 'lead_status' || key === 'status') return value.replace(/_/g, ' ');
    return short(value);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return 'nothing';
    return short(entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', '));
  }
  return short(String(value));
}

/** The lines of one change: "Owner: Sam → Dana". In the order of the field names. */
export function describeChange(changes: ChangeRow['changes'], names: HistoryNames): string[] {
  return Object.entries(changes)
    .map(([key, pair]) => ({ label: fieldLabel(key), from: showValue(key, pair?.from, names), to: showValue(key, pair?.to, names) }))
    .filter((line) => line.from !== line.to)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((line) => `${line.label}: ${line.from} → ${line.to}`);
}

/** Who did it. No user means the server did (an automation, an import, a web form). */
export function whoDid(userId: string | null, names: HistoryNames): string {
  if (!userId) return 'The system';
  return names.people.get(userId) ?? 'Someone who has left';
}
