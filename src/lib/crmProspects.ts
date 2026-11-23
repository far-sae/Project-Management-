// Finding leads in Apollo: the small rules the page uses. What to search by,
// which people are leads already, and how a person bought with a credit becomes
// a lead in the CRM.
import type { FoundPerson, PhoneType, RevealedPerson } from '../../api/_prospect/shared/types';
import { splitDuplicateLeads } from '@/lib/crmDuplicates';

/** What a lead's "Source" says when it came from here. */
export const APOLLO_SOURCE = 'Apollo';
/** The custom field that remembers which Apollo person a lead is, so nobody is paid for twice. */
export const APOLLO_ID_FIELD = 'Apollo ID';
export const LINKEDIN_FIELD = 'LinkedIn';
export const LOCATION_FIELD = 'Location';
export const EMAIL_STATUS_FIELD = 'Email status';
/** Whose number the lead's phone is: the person's own mobile or line, or their company's. */
export const PHONE_TYPE_FIELD = 'Phone type';
export const COMPANY_PHONE = 'Company';
export const PHONE_TYPE_LABEL: Record<PhoneType, string> = { mobile: 'Mobile', direct: 'Direct line', other: 'Own number' };

/** The most people that can be added in one go (the server's limit too). */
export const ADD_MAX = 50;

export const SENIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'founder', label: 'Founder' },
  { value: 'c_suite', label: 'C-level' },
  { value: 'partner', label: 'Partner' },
  { value: 'vp', label: 'VP' },
  { value: 'head', label: 'Head' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry level' },
];

export const SIZE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1,10', label: '1–10' },
  { value: '11,50', label: '11–50' },
  { value: '51,200', label: '51–200' },
  { value: '201,500', label: '201–500' },
  { value: '501,1000', label: '501–1,000' },
  { value: '1001,5000', label: '1,001–5,000' },
  { value: '5001,1000000', label: 'Over 5,000' },
];

/** "CEO, Founder; Head of Sales" (or one a line) → the values, trimmed, without repeats. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,;\n]/)) {
    const value = part.replace(/\s+/g, ' ').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** The Apollo people who are leads already, by the id kept on the lead. */
export function knownApolloIds(leads: Array<{ customFields?: Record<string, string> | null }>): Set<string> {
  const ids = new Set<string>();
  for (const lead of leads) {
    const id = lead.customFields?.[APOLLO_ID_FIELD]?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

/** A found person's name as far as the free search gives it: "Elena Ro***i". */
export const hiddenName = (person: FoundPerson): string => `${person.firstName} ${person.lastNameHidden}`.trim() || 'Name not shown';

/** A lead made from a person, ready for the CRM. */
export interface ProspectLead {
  apolloId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  /** The company's number, which comes free with the person. Their own number, when asked for, arrives later. */
  phone: string | null;
  jobTitle: string | null;
  customFields: Record<string, string>;
  /** The company to find or create by name, with what Apollo knows about it. Null when there is none. */
  company: { name: string } & Record<string, unknown> | null;
}

const place = (...parts: string[]): string => parts.map((p) => p.trim()).filter(Boolean).join(', ');

export function leadFromPerson(person: RevealedPerson): ProspectLead {
  const customFields: Record<string, string> = { [APOLLO_ID_FIELD]: person.id };
  if (person.linkedinUrl) customFields[LINKEDIN_FIELD] = person.linkedinUrl;
  const where = place(person.city, person.state, person.country);
  if (where) customFields[LOCATION_FIELD] = where;
  if (person.emailStatus) customFields[EMAIL_STATUS_FIELD] = person.emailStatus;
  const phone = person.company?.phone || null;
  if (phone) customFields[PHONE_TYPE_FIELD] = COMPANY_PHONE;

  const c = person.company;
  const company = c
    ? {
        name: c.name,
        ...(c.website ? { website: c.website } : {}),
        ...(c.industry ? { industry: c.industry } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.city ? { city: c.city } : {}),
        ...(c.state ? { state: c.state } : {}),
        ...(c.country ? { country: c.country } : {}),
        ...(c.size ? { company_size: String(c.size) } : {}),
      }
    : null;

  return {
    apolloId: person.id,
    // A lead needs a first name: fall back to the part of the email before the @.
    firstName: person.firstName || person.email.split('@')[0] || 'Unknown',
    lastName: person.lastName || null,
    email: person.email,
    phone,
    jobTitle: person.title || null,
    customFields,
    company,
  };
}

/** The people who are not leads yet (by email), and the ones who are. A person listed twice counts once. */
export function splitNewLeads(leads: ProspectLead[], existingEmails: Iterable<string>): { fresh: ProspectLead[]; already: ProspectLead[] } {
  const { fresh, duplicates } = splitDuplicateLeads(leads.map((lead) => ({ record: { email: lead.email }, lead })), existingEmails);
  return { fresh: fresh.map((row) => row.lead), already: duplicates.map((row) => row.lead) };
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What happened, in one line: how many leads were added, what it cost, and who was left out and why. */
export function addedSentence(result: { added: number; credits: number; already: number; unverified: number; notFound: number }): string {
  const parts = [
    result.added ? `Added ${count(result.added, 'lead', 'leads')}.` : 'No leads were added.',
    `${count(result.credits, 'Apollo credit', 'Apollo credits')} used.`,
  ];
  if (result.already) parts.push(`${count(result.already, 'was', 'were')} already a lead.`);
  if (result.unverified) parts.push(`${count(result.unverified, 'had', 'had')} no verified email.`);
  if (result.notFound) parts.push(`${count(result.notFound, 'was', 'were')} not found.`);
  return parts.join(' ');
}

// ── Phone numbers, which arrive after the lead is made ──────────────────

/** What to save on a lead when its own number arrives: the number, and whose it is. */
export function phonePatch(
  customFields: Record<string, string>,
  phone: { number: string; type: PhoneType },
): { phone: string; customFields: Record<string, string> } {
  return { phone: phone.number, customFields: { ...customFields, [PHONE_TYPE_FIELD]: PHONE_TYPE_LABEL[phone.type] } };
}

export function phonesSentence(result: { added: number; credits: number }): string {
  const used = `${count(result.credits, 'Apollo credit', 'Apollo credits')} used.`;
  return result.added
    ? `Phone numbers added to ${count(result.added, 'lead', 'leads')}. ${used}`
    : `Apollo found no valid phone number for these leads. ${used}`;
}

/**
 * Phone numbers still being looked up: which requests to ask Apollo about, and
 * which lead each person became. Kept in the browser, so numbers that were
 * paid for are still collected when the page is opened again.
 */
export interface PendingPhones {
  requestIds: string[];
  /** Apollo person id → the lead made from them. */
  leads: Record<string, { id: string; customFields: Record<string, string> }>;
  /** Totals so far, for the sentence at the end. */
  added: number;
  credits: number;
}

const pendingKey = (workspaceId: string): string => `crm.findLeads.pendingPhones.${workspaceId}`;

export function readPendingPhones(workspaceId: string): PendingPhones | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(workspaceId));
    const value = raw ? (JSON.parse(raw) as Partial<PendingPhones> | null) : null;
    if (!value || !Array.isArray(value.requestIds) || value.requestIds.length === 0 || !value.leads || typeof value.leads !== 'object') return null;
    return { requestIds: value.requestIds.map(String), leads: value.leads, added: Number(value.added) || 0, credits: Number(value.credits) || 0 };
  } catch {
    return null;
  }
}

export function savePendingPhones(workspaceId: string, pending: PendingPhones | null): void {
  try {
    if (pending && pending.requestIds.length) window.localStorage.setItem(pendingKey(workspaceId), JSON.stringify(pending));
    else window.localStorage.removeItem(pendingKey(workspaceId));
  } catch {
    /* A private window: the numbers are still collected while the page stays open. */
  }
}

/** One list of pending phones added to another (a second batch while the first is still being looked up). */
export function mergePendingPhones(a: PendingPhones | null, b: PendingPhones): PendingPhones {
  if (!a) return b;
  return {
    requestIds: [...new Set([...a.requestIds, ...b.requestIds])],
    leads: { ...a.leads, ...b.leads },
    added: a.added + b.added,
    credits: a.credits + b.credits,
  };
}

const PHONES_CHOICE_KEY = 'crm.findLeads.withPhones';

/** Whether "also get phone numbers" was on last time. On until somebody turns it off. */
export function readPhonesChoice(): boolean {
  try {
    return window.localStorage.getItem(PHONES_CHOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function savePhonesChoice(on: boolean): void {
  try {
    window.localStorage.setItem(PHONES_CHOICE_KEY, on ? 'on' : 'off');
  } catch {
    /* Not remembered in a private window. */
  }
}
