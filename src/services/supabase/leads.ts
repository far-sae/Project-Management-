import { normalizeCompanyName, normalizeEmail } from './dupDetection';

export interface Lead {
  leadId: string;
  organizationId: string;
  workspaceId: string | null;
  leadNumber: string;
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  fax: string | null;
  website: string | null;
  skypeId: string | null;
  twitter: string | null;
  linkedinUrl: string | null;
  company: string | null;
  industry: string | null;
  annualRevenue: number | null;
  noOfEmployees: number | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  leadOwnerId: string | null;
  leadOwnerName: string | null;
  leadSource: string | null;
  leadStatus: string;
  rating: string | null;
  emailOptOut: boolean;
  accountId: string | null;
  category: string | null;
  convertedAt: Date | null;
  convertedToClientId: string | null;
  convertedToContactId: string | null;
  convertedToDealId: string | null;
  description: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  imageUrl: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type LeadInput = Partial<Lead> & {
  accountId?: string | null;
  category?: string | null;
};

const storageKey = (orgId: string) => `pm:local-leads:${orgId}`;

const readLeads = (orgId: string): Lead[] => {
  const raw = localStorage.getItem(storageKey(orgId));
  if (!raw) return [];
  return (JSON.parse(raw) as Array<Omit<Lead, 'createdAt' | 'updatedAt' | 'convertedAt'> & {
    createdAt: string;
    updatedAt: string;
    convertedAt: string | null;
  }>).map((lead) => ({
    ...lead,
    createdAt: new Date(lead.createdAt),
    updatedAt: new Date(lead.updatedAt),
    convertedAt: lead.convertedAt ? new Date(lead.convertedAt) : null,
  }));
};

const writeLeads = (orgId: string, leads: Lead[]) => {
  localStorage.setItem(storageKey(orgId), JSON.stringify(leads));
};

const nextNumber = (count: number) => `L-${String(count + 1).padStart(6, '0')}`;

export const createLead = async (
  organizationId: string,
  workspaceId: string | null,
  createdBy: string | null,
  input: LeadInput,
): Promise<Lead> => {
  const leads = readLeads(organizationId);
  const now = new Date();
  const lead: Lead = {
    leadId: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    organizationId,
    workspaceId,
    leadNumber: input.leadNumber ?? nextNumber(leads.length),
    salutation: input.salutation ?? null,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    title: input.title ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    mobile: input.mobile ?? null,
    fax: input.fax ?? null,
    website: input.website ?? null,
    skypeId: input.skypeId ?? null,
    twitter: input.twitter ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    company: input.company ?? null,
    industry: input.industry ?? null,
    annualRevenue: input.annualRevenue ?? null,
    noOfEmployees: input.noOfEmployees ?? null,
    street: input.street ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? null,
    leadOwnerId: input.leadOwnerId ?? null,
    leadOwnerName: input.leadOwnerName ?? null,
    leadSource: input.leadSource ?? null,
    leadStatus: input.leadStatus ?? 'new',
    rating: input.rating ?? null,
    emailOptOut: input.emailOptOut ?? false,
    accountId: input.accountId ?? null,
    category: input.category ?? null,
    convertedAt: input.convertedAt ?? null,
    convertedToClientId: input.convertedToClientId ?? null,
    convertedToContactId: input.convertedToContactId ?? null,
    convertedToDealId: input.convertedToDealId ?? null,
    description: input.description ?? null,
    tags: input.tags ?? [],
    customFields: input.customFields ?? {},
    imageUrl: input.imageUrl ?? null,
    createdBy,
    createdByName: input.createdByName ?? null,
    createdAt: now,
    updatedAt: now,
  };
  writeLeads(organizationId, [...leads, lead]);
  return lead;
};

export const updateLead = async (
  organizationId: string,
  leadId: string,
  input: LeadInput,
): Promise<Lead> => {
  const leads = readLeads(organizationId);
  const index = leads.findIndex((lead) => lead.leadId === leadId);
  if (index === -1) throw new Error('Lead not found');
  const updated = { ...leads[index], ...input, updatedAt: new Date() };
  const next = [...leads];
  next[index] = updated;
  writeLeads(organizationId, next);
  return updated;
};

export const listAccountLeads = async (organizationId: string, accountId: string): Promise<Lead[]> =>
  readLeads(organizationId).filter((lead) => lead.accountId === accountId);

export const listUnassignedLeads = async (organizationId: string): Promise<Lead[]> =>
  readLeads(organizationId).filter((lead) => !lead.category);

export const isLeadDuplicate = (a: Partial<Lead>, b: Partial<Lead>): boolean => {
  const aEmail = normalizeEmail(a.email);
  const bEmail = normalizeEmail(b.email);
  if (aEmail && bEmail && aEmail === bEmail) return true;
  const aLast = a.lastName?.trim().toLowerCase();
  const bLast = b.lastName?.trim().toLowerCase();
  const aCompany = normalizeCompanyName(a.company);
  const bCompany = normalizeCompanyName(b.company);
  return !!aLast && !!bLast && !!aCompany && !!bCompany && aLast === bLast && aCompany === bCompany;
};

export const findLeadDuplicates = async (organizationId: string, candidate: Partial<Lead>): Promise<Lead[]> => {
  if (!normalizeEmail(candidate.email) && !(candidate.lastName && normalizeCompanyName(candidate.company))) {
    return [];
  }
  return readLeads(organizationId).filter((lead) => isLeadDuplicate(candidate, lead));
};

export const LEAD_CSV_HEADERS = [
  'Lead Number',
  'First Name',
  'Last Name',
  'Email',
  'Company',
  'Lead Status',
  'Tags',
  'Description',
];

const MINOR_LABEL_WORDS = new Set(['and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

const statusLabel = (status: string) =>
  status.split('_').map((part, index) => {
    const word = part.toLowerCase();
    return index > 0 && MINOR_LABEL_WORDS.has(word)
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');

const csvValue = (value: unknown): string => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const exportLeadsToCsv = (leads: Lead[]): string => {
  const rows = leads.map((lead) => [
    lead.leadNumber,
    lead.firstName,
    lead.lastName,
    lead.email,
    lead.company,
    statusLabel(lead.leadStatus),
    lead.tags.join(';'),
    lead.description,
  ].map(csvValue).join(','));
  return [LEAD_CSV_HEADERS.join(','), ...rows].join('\n');
};
