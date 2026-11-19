/**
 * Rules for importing leads and companies from a spreadsheet file. Pure: no
 * database calls here, so the wizard stays thin and the rules stay testable.
 */

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
}

export const SKIP = '__skip__';
export const CUSTOM = '__custom__';

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Headings that mean exactly this field. */
const EXACT: Record<string, string[]> = {
  full_name: ['name', 'fullname', 'contactname', 'leadname', 'customername', 'clientname', 'contact', 'contactperson', 'person'],
  first_name: ['firstname', 'first', 'givenname', 'forename', 'fname'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  email: ['email', 'emailaddress', 'mail', 'emailid'],
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'mobileno', 'tel', 'telephone', 'cell', 'cellphone', 'contactnumber', 'whatsapp'],
  job_title: ['jobtitle', 'title', 'role', 'position', 'designation'],
  company: ['company', 'companyname', 'organisation', 'organization', 'business', 'businessname', 'account', 'accountname', 'employer', 'firm'],
  source: ['source', 'leadsource', 'origin', 'channel'],
  category: ['category', 'segment', 'bucket', 'tier', 'group'],
  lifecycle_stage: ['lifecyclestage', 'lifecycle', 'stage'],
  lead_status: ['leadstatus', 'status'],
  name: ['name', 'company', 'companyname', 'organisation', 'organization', 'business', 'businessname', 'account', 'accountname'],
  website: ['website', 'url', 'site', 'web', 'domain'],
  industry: ['industry', 'sector'],
  address: ['address', 'streetaddress'],
  city: ['city', 'town'],
  country: ['country'],
  company_size: ['companysize', 'size', 'employees', 'headcount', 'teamsize'],
  annual_revenue: ['annualrevenue', 'revenue', 'turnover'],
};

/** Words that suggest a field when no heading matched exactly. */
const LOOSE: Record<string, string[]> = {
  full_name: ['fullname', 'contactname', 'leadname', 'customername', 'clientname'],
  first_name: ['firstname', 'givenname', 'forename'],
  last_name: ['lastname', 'surname', 'familyname'],
  email: ['email', 'mail'],
  phone: ['phone', 'mobile', 'telephone', 'whatsapp'],
  job_title: ['jobtitle', 'title', 'position', 'designation'],
  company: ['company', 'organisation', 'organization', 'business', 'employer'],
  source: ['source'],
  category: ['category', 'segment'],
  lifecycle_stage: ['lifecycle'],
  lead_status: ['leadstatus', 'status'],
  name: ['companyname', 'businessname', 'organisation', 'organization', 'company'],
  website: ['website', 'url'],
  industry: ['industry', 'sector'],
  address: ['address'],
  city: ['city', 'town'],
  country: ['country'],
  company_size: ['size', 'employees', 'headcount'],
  annual_revenue: ['revenue', 'turnover'],
};

/** "Company website" is about the company, but it is not the company's name. */
const NOT_A_NAME = ['website', 'url', 'email', 'mail', 'phone', 'tel', 'size', 'revenue', 'address', 'city', 'country', 'industry'];

/**
 * Picks a field for every column heading. Exact headings win over loose ones
 * wherever they sit in the file, and a field is never handed out twice.
 */
export function autoMapColumns(headers: string[], fields: ImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const h of headers) mapping[h] = SKIP;

  const claim = (pick: (heading: string, field: ImportField) => boolean) => {
    for (const h of headers) {
      if (mapping[h] !== SKIP) continue;
      const heading = norm(h);
      if (!heading) continue;
      const field = fields.find((f) => !taken.has(f.key) && pick(heading, f));
      if (field) {
        mapping[h] = field.key;
        taken.add(field.key);
      }
    }
  };

  claim((heading, f) => heading === norm(f.key) || heading === norm(f.label) || (EXACT[f.key] ?? []).includes(heading));
  claim((heading, f) => {
    if (!(LOOSE[f.key] ?? []).some((word) => heading.includes(word))) return false;
    if ((f.key === 'company' || f.key === 'name') && NOT_A_NAME.some((word) => heading.includes(word))) return false;
    return true;
  });
  return mapping;
}

/** "Elena Rossi" and "Rossi, Elena" both give first name Elena, last name Rossi. */
export function splitFullName(raw: string): { firstName: string; lastName: string | null } {
  const full = raw.replace(/\s+/g, ' ').trim();
  const comma = full.indexOf(',');
  if (comma > 0 && comma < full.length - 1) {
    return { firstName: full.slice(comma + 1).trim(), lastName: full.slice(0, comma).trim() || null };
  }
  const space = full.indexOf(' ');
  if (space === -1) return { firstName: full, lastName: null };
  return { firstName: full.slice(0, space), lastName: full.slice(space + 1) };
}

/** Two spellings of a company name are the same company when their keys match. */
export const companyKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** A custom field's storage key: lowercase letters, digits and underscores. */
export const toCustomKey = (raw: string): string => {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return s.slice(0, 40) || 'field';
};

/** Who the imported leads belong to: 'me', 'none', 'team' (in turn), or one person's user id. */
export type ImportOwnerMode = string;

export function importOwners(mode: ImportOwnerMode, meId: string | null, teamIds: string[]): Array<string | null> {
  if (mode === 'none') return [null];
  if (mode === 'team') return teamIds.length ? teamIds : [meId];
  if (mode === 'me') return [meId];
  return [mode];
}

// The two step columns only accept these values; anything else falls back to
// the default so the database does not reject the row.
const LIFECYCLE_STAGES = new Set([
  'subscriber', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead',
  'opportunity', 'customer', 'evangelist', 'other',
]);
const LEAD_STATUSES = new Set([
  'new', 'open', 'in_progress', 'open_deal', 'unqualified',
  'attempted_to_contact', 'connected', 'bad_timing',
]);
const asEnum = (value: string | undefined, allowed: Set<string>, fallback: string): string => {
  const v = (value ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return allowed.has(v) ? v : fallback;
};

type Row = Record<string, string>;

/** Reads one file row into field values and custom fields, following the mapping. */
function readRow(row: Row, mapping: Record<string, string>, customNames: Record<string, string>) {
  const values: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (!key || key === SKIP) continue;
    const v = row[header]?.trim();
    if (!v) continue;
    if (key === CUSTOM) custom[toCustomKey(customNames[header] ?? header)] = v;
    else values[key] = v;
  }
  return { values, custom };
}

export interface LeadImportOptions {
  organizationId: string;
  workspaceId: string | null;
  /** Category for rows that have none of their own. */
  category: string | null;
  /** Company for rows that have none of their own. */
  company: string | null;
  /** Leads are handed to these owners in turn. */
  owners: Array<string | null>;
}

export interface LeadImportRow {
  /** Ready to insert, except `company_id`, which is filled once the company exists. */
  record: Record<string, unknown>;
  companyName: string | null;
}

/**
 * Turns file rows into leads. Every record has the same columns: a batch with
 * uneven columns stores the gaps as empty, which the database refuses for
 * columns that must have a value.
 */
export function buildLeadImport(
  rows: Row[],
  mapping: Record<string, string>,
  customNames: Record<string, string>,
  opts: LeadImportOptions,
): { leads: LeadImportRow[]; skipped: number } {
  const owners = opts.owners.length ? opts.owners : [null];
  const leads: LeadImportRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const { values, custom } = readRow(row, mapping, customNames);
    let firstName = values.first_name ?? '';
    let lastName: string | null = values.last_name ?? null;
    if (!firstName && values.full_name) {
      const split = splitFullName(values.full_name);
      firstName = split.firstName;
      lastName = lastName ?? split.lastName;
    }
    if (!firstName && lastName) {
      firstName = lastName;
      lastName = null;
    }
    const companyName = values.company || opts.company?.trim() || null;
    if (!firstName) firstName = values.email?.split('@')[0] || companyName || '';
    if (!firstName) {
      skipped += 1;
      continue;
    }
    leads.push({
      companyName,
      record: {
        organization_id: opts.organizationId,
        workspace_id: opts.workspaceId,
        owner_id: owners[leads.length % owners.length] ?? null,
        company_id: null,
        first_name: firstName,
        last_name: lastName,
        email: values.email ?? null,
        phone: values.phone ?? null,
        job_title: values.job_title ?? null,
        source: values.source ?? null,
        lifecycle_stage: asEnum(values.lifecycle_stage, LIFECYCLE_STAGES, 'lead'),
        lead_status: asEnum(values.lead_status, LEAD_STATUSES, 'new'),
        category: values.category ?? (opts.category?.trim() || null),
        custom_fields: custom,
      },
    });
  }
  return { leads, skipped };
}

const COMPANY_TEXT_COLUMNS = ['website', 'industry', 'phone', 'email', 'address', 'city', 'country', 'company_size'] as const;

export function buildCompanyImport(
  rows: Row[],
  mapping: Record<string, string>,
  customNames: Record<string, string>,
  opts: { organizationId: string; workspaceId: string | null; ownerId: string | null },
): { records: Array<Record<string, unknown>>; skipped: number } {
  const records: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const row of rows) {
    const { values, custom } = readRow(row, mapping, customNames);
    if (!values.name) {
      skipped += 1;
      continue;
    }
    const revenue = values.annual_revenue ? Number(values.annual_revenue.replace(/[^\d.-]/g, '')) : NaN;
    const record: Record<string, unknown> = {
      organization_id: opts.organizationId,
      workspace_id: opts.workspaceId,
      owner_id: opts.ownerId,
      name: values.name,
      annual_revenue: Number.isFinite(revenue) ? revenue : null,
      custom_fields: custom,
    };
    for (const column of COMPANY_TEXT_COLUMNS) record[column] = values[column] ?? null;
    records.push(record);
  }
  return { records, skipped };
}
