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
  full_name: ['name', 'fullname', 'contactname', 'leadname', 'customername', 'clientname', 'contact', 'contactperson', 'person', 'primarycontactname', 'primarycontact'],
  first_name: ['firstname', 'first', 'givenname', 'forename', 'fname'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  email: ['email', 'emailaddress', 'mail', 'emailid'],
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'mobileno', 'tel', 'telephone', 'cell', 'cellphone', 'contactnumber', 'whatsapp'],
  job_title: ['jobtitle', 'title', 'role', 'position', 'designation', 'primarycontacttitle'],
  company: ['company', 'companyname', 'organisation', 'organization', 'business', 'businessname', 'account', 'accountname', 'employer', 'firm'],
  company_website: ['website', 'url', 'site', 'web', 'domain'],
  company_industry: ['industry', 'sector'],
  company_address: ['address', 'streetaddress', 'addressline1', 'street'],
  company_city: ['city', 'town'],
  company_state: ['state', 'county', 'region', 'province'],
  company_postcode: ['postalcode', 'postcode', 'zip', 'zipcode'],
  company_country: ['country'],
  company_size: ['companysize', 'size', 'employees', 'employeecount', 'numberofemployees', 'headcount', 'teamsize'],
  company_revenue: ['annualrevenue', 'revenue', 'turnover'],
  source: ['source', 'leadsource', 'origin', 'channel'],
  category: ['category', 'segment', 'bucket', 'tier', 'group'],
  lifecycle_stage: ['lifecyclestage', 'lifecycle', 'stage', 'type', 'clienttype', 'customertype'],
  lead_status: ['leadstatus', 'status'],
  name: ['name', 'company', 'companyname', 'organisation', 'organization', 'business', 'businessname', 'account', 'accountname'],
  website: ['website', 'url', 'site', 'web', 'domain'],
  industry: ['industry', 'sector'],
  address: ['address', 'streetaddress', 'addressline1', 'street'],
  city: ['city', 'town'],
  state: ['state', 'county', 'region', 'province'],
  postal_code: ['postalcode', 'postcode', 'zip', 'zipcode'],
  country: ['country'],
  type: ['type', 'companytype', 'accounttype'],
  linkedin_url: ['linkedin', 'linkedinurl', 'linkedinpage', 'companylinkedin'],
  annual_revenue: ['annualrevenue', 'revenue', 'turnover'],
  notes: ['notes', 'note', 'description', 'comments', 'comment'],
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
  company_website: ['website', 'url'],
  company_industry: ['industry', 'sector'],
  company_address: ['address'],
  company_city: ['city', 'town'],
  company_country: ['country'],
  company_revenue: ['revenue', 'turnover'],
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
  company_size: ['size', 'employee', 'headcount'],
  annual_revenue: ['revenue', 'turnover'],
};

/** "Company website" is about the company, but it is not the company's name. */
const NOT_A_NAME = ['website', 'url', 'email', 'mail', 'phone', 'tel', 'size', 'revenue', 'address', 'city', 'country', 'industry'];

/** Headings that only a list of companies has. Two of them make "name" the company's name. */
const COMPANY_FILE_SIGNS = [
  'legalname', 'industry', 'website', 'annualrevenue', 'employeecount', 'companysize', 'taxid',
  'accountnumber', 'primarycontactname',
];

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

  // In a list of companies imported as leads, "name" is the company, not a person.
  const has = (key: string) => fields.some((f) => f.key === key);
  if (has('company') && has('full_name')) {
    const headings = headers.map(norm);
    const nameAt = headings.indexOf('name');
    const companyColumn = headings.some((h) => EXACT.company!.includes(h));
    const signs = headings.filter((h) => COMPANY_FILE_SIGNS.includes(h)).length;
    if (nameAt !== -1 && !companyColumn && signs >= 2) {
      mapping[headers[nameAt]!] = 'company';
      taken.add('company');
    }
  }

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
  /** What the file says about the company, by company column. Used when the company is created. */
  companyDetails: Record<string, unknown>;
}

/** Lead-import fields that describe the lead's company, and the company column each fills. */
const COMPANY_DETAIL_COLUMNS: Array<[field: string, column: string]> = [
  ['company_website', 'website'],
  ['company_industry', 'industry'],
  ['company_address', 'address'],
  ['company_city', 'city'],
  ['company_state', 'state'],
  ['company_postcode', 'postal_code'],
  ['company_country', 'country'],
  ['company_size', 'company_size'],
];

/** "£1,200,000" → 1200000. Null when there is no number in it. */
const parseAmount = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && /\d/.test(raw) ? n : null;
};

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
    // A row with no person in it is about the company itself: the lead takes
    // the company's name, and its email and phone are the company's too.
    const aboutTheCompany = !firstName && companyName !== null;
    if (!firstName) firstName = companyName || values.email?.split('@')[0] || '';
    if (!firstName) {
      skipped += 1;
      continue;
    }
    const companyDetails: Record<string, unknown> = {};
    for (const [field, column] of COMPANY_DETAIL_COLUMNS) {
      if (values[field]) companyDetails[column] = values[field];
    }
    const revenue = parseAmount(values.company_revenue);
    if (revenue !== null) companyDetails.annual_revenue = revenue;
    if (aboutTheCompany) {
      if (values.email) companyDetails.email = values.email;
      if (values.phone) companyDetails.phone = values.phone;
    }
    leads.push({
      companyName,
      companyDetails,
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

const COMPANY_TEXT_COLUMNS = [
  'website', 'industry', 'type', 'phone', 'email', 'linkedin_url', 'address', 'city', 'state', 'postal_code',
  'country', 'company_size', 'notes',
] as const;

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
    const record: Record<string, unknown> = {
      organization_id: opts.organizationId,
      workspace_id: opts.workspaceId,
      owner_id: opts.ownerId,
      name: values.name,
      annual_revenue: parseAmount(values.annual_revenue),
      custom_fields: custom,
    };
    for (const column of COMPANY_TEXT_COLUMNS) record[column] = values[column] ?? null;
    records.push(record);
  }
  return { records, skipped };
}

// ── Files whose values are out of line with their headings ──────────────────

const STATUS_WORDS = new Set(['active', 'inactive', 'archived', 'paused', 'churned', 'closed', 'open', 'new']);
const TYPE_WORDS = new Set(['customer', 'client', 'prospect', 'lead', 'partner', 'vendor', 'supplier', 'reseller', 'competitor', 'other']);

/** Values that can be recognised on sight. A strong check is enough to prove a column is misplaced. */
const VALUE_CHECKS: Array<{ strong: boolean; applies: (heading: string) => boolean; ok: (value: string) => boolean }> = [
  { strong: true, applies: (h) => h.endsWith('email'), ok: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
  {
    strong: true,
    applies: (h) => h.endsWith('website') || h.endsWith('url'),
    ok: (v) => !v.includes('@') && /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v),
  },
  { strong: true, applies: (h) => h.endsWith('phone') || h === 'mobile', ok: (v) => /^[+(]?\d[\d\s().-]{5,}$/.test(v) },
  { strong: false, applies: (h) => h === 'status', ok: (v) => STATUS_WORDS.has(v.toLowerCase()) },
  { strong: false, applies: (h) => h === 'type', ok: (v) => TYPE_WORDS.has(v.toLowerCase()) },
];

function fitOf(headers: string[], rows: string[][]) {
  let strongOk = 0;
  let strongBad = 0;
  let weakOk = 0;
  headers.forEach((header, i) => {
    const check = VALUE_CHECKS.find((c) => c.applies(norm(header)));
    if (!check) return;
    for (const cells of rows) {
      const value = cells[i]?.trim();
      if (!value) continue;
      const ok = check.ok(value);
      if (check.strong) {
        if (ok) strongOk += 1;
        else strongBad += 1;
      } else if (ok) weakOk += 1;
    }
  });
  return { strongOk, strongBad, weakOk };
}

/**
 * Repairs a file whose heading row has one heading more than its rows have
 * values, so that every value after it sits one column to the left of its
 * heading (emails under "website", phone numbers under "email"). The export of
 * the old Clients module wrote files like that. The heading with no values is
 * dropped and the rest line up again.
 *
 * It only acts when emails, websites and phone numbers are plainly under the
 * wrong headings and dropping one heading puts every one of them right.
 */
export function realignShiftedColumns(
  headers: string[],
  rows: string[][],
): { headers: string[]; dropped: string | null } {
  const unchanged = { headers, dropped: null };
  if (!rows.length || rows.some((cells) => cells.length >= headers.length)) return unchanged;
  const before = fitOf(headers, rows);
  if (before.strongBad === 0 || before.strongBad <= before.strongOk) return unchanged;

  let best: { at: number; strongOk: number; weakOk: number } | null = null;
  for (let at = 0; at < headers.length; at++) {
    const candidate = headers.filter((_, i) => i !== at);
    const fit = fitOf(candidate, rows);
    if (fit.strongBad > 0 || fit.strongOk <= before.strongOk) continue;
    // On a tie the later heading wins: it leaves the most columns where they were.
    if (!best || fit.strongOk > best.strongOk || (fit.strongOk === best.strongOk && fit.weakOk >= best.weakOk)) {
      best = { at, strongOk: fit.strongOk, weakOk: fit.weakOk };
    }
  }
  if (!best) return unchanged;
  const at = best.at;
  return { headers: headers.filter((_, i) => i !== at), dropped: headers[at]! };
}
