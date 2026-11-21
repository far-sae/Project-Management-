/**
 * A copy of everything the CRM holds about one person, as one file they can be
 * given when they ask for it. Pure: the caller reads the records and this puts
 * them into one plain structure.
 */

export interface PersonRecords {
  lead: Record<string, unknown>;
  company: { name: string } | null;
  deals: Array<Record<string, unknown>>;
  followUps: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  emails: Array<Record<string, unknown>>;
  /** Null when the calls could not be read (calling is for the owner and admins). */
  calls: Array<Record<string, unknown>> | null;
}

export interface PersonExport {
  about: string;
  exportedAt: string;
  notIncluded: string[];
  lead: Record<string, unknown>;
  company: { name: string } | null;
  deals: Array<Record<string, unknown>>;
  followUps: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  emails: Array<Record<string, unknown>>;
  calls: Array<Record<string, unknown>>;
}

/** Dates as text, so the file reads the same wherever it is opened. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

export function personExport(name: string, records: PersonRecords, now: Date): PersonExport {
  const notIncluded = [
    'Call recordings: they are audio kept at the phone provider. The list of calls is included.',
    'The text of emails this person sent: replies are read in the mailbox and are not stored here.',
    'Agreements and invoices: they are documents of the company, found under Agreements and Invoices.',
  ];
  if (records.calls === null) notIncluded.unshift('Calls: they could not be read. Only the owner and admins can see calls.');
  return {
    about: `Everything the CRM holds about ${name}.`,
    exportedAt: now.toISOString(),
    notIncluded,
    lead: plain(records.lead) as Record<string, unknown>,
    company: records.company,
    deals: plain(records.deals) as Array<Record<string, unknown>>,
    followUps: plain(records.followUps) as Array<Record<string, unknown>>,
    timeline: plain(records.timeline) as Array<Record<string, unknown>>,
    emails: plain(records.emails) as Array<Record<string, unknown>>,
    calls: plain(records.calls ?? []) as Array<Record<string, unknown>>,
  };
}

/** "elena-rossi-data-2026-11-21.json": safe as a file name on every system. */
export function exportFileName(name: string, now: Date): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'lead'}-data-${now.toISOString().slice(0, 10)}.json`;
}
