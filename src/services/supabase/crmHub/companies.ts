import { supabase } from '../config';
import type { CrmCompany, CreateCompanyInput, UpdateCompanyInput } from '@/types/crmHub';
import { tryLogActivity } from './activities';
import { applyWorkspaceFilter } from './workspaceFilter';
import { allRows } from './allRows';
import { companyKey } from '@/lib/crmImport';

interface CompanyRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  owner_id: string | null;
  name: string;
  website: string | null;
  industry: string | null;
  type?: string | null;
  state?: string | null;
  postal_code?: string | null;
  linkedin_url?: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  company_size: string | null;
  annual_revenue: number | null;
  notes: string | null;
  custom_fields: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

const mapCompany = (r: CompanyRow): CrmCompany => ({
  id: r.id,
  organizationId: r.organization_id,
  workspaceId: r.workspace_id ?? null,
  ownerId: r.owner_id,
  name: r.name,
  website: r.website,
  industry: r.industry,
  type: r.type ?? null,
  phone: r.phone,
  email: r.email,
  address: r.address,
  city: r.city,
  state: r.state ?? null,
  postalCode: r.postal_code ?? null,
  country: r.country,
  linkedinUrl: r.linkedin_url ?? null,
  companySize: r.company_size,
  annualRevenue: r.annual_revenue == null ? null : Number(r.annual_revenue),
  notes: r.notes,
  customFields: r.custom_fields ?? {},
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

/** Columns added by migration 183. A database without them still has to take the rest of a save. */
const DETAIL_COLUMNS = ['type', 'state', 'postal_code', 'linkedin_url'] as const;

const isDetailColumnMissing = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  const message = (e.message ?? '').toLowerCase();
  const named = DETAIL_COLUMNS.some((column) => message.includes(column));
  return named && (e.code === 'PGRST204' || e.code === '42703' || message.includes('column'));
};

const withoutDetailColumns = <T extends Record<string, unknown>>(row: T): T => {
  const copy: Record<string, unknown> = { ...row };
  for (const column of DETAIL_COLUMNS) delete copy[column];
  return copy as T;
};

export const listCompanies = async (
  organizationId: string,
  opts: { workspaceId?: string | null } = {},
): Promise<CrmCompany[]> => {
  const rows = await allRows<CompanyRow>((from, to) => {
    const q = supabase
      .from('crm_companies')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true })
      .order('id', { ascending: true });
    return applyWorkspaceFilter(q, opts.workspaceId).range(from, to);
  });
  return rows.map(mapCompany);
};

export const getCompany = async (id: string): Promise<CrmCompany | null> => {
  const { data, error } = await supabase.from('crm_companies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapCompany(data) : null;
};

export const createCompany = async (input: CreateCompanyInput, ownerId: string | null): Promise<CrmCompany> => {
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    owner_id: ownerId,
    name: input.name,
    website: input.website ?? null,
    industry: input.industry ?? null,
    type: input.type ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postal_code: input.postalCode ?? null,
    country: input.country ?? null,
    linkedin_url: input.linkedinUrl ?? null,
    company_size: input.companySize ?? null,
    annual_revenue: input.annualRevenue ?? null,
    notes: input.notes ?? null,
    custom_fields: input.customFields ?? {},
  };
  let { data, error } = await supabase.from('crm_companies').insert(row).select().single();
  if (error && isDetailColumnMissing(error)) {
    ({ data, error } = await supabase.from('crm_companies').insert(withoutDetailColumns(row)).select().single());
  }
  if (error) throw error;
  const company = mapCompany(data);
  tryLogActivity(
    {
      organizationId: company.organizationId,
      workspaceId: company.workspaceId,
      type: 'company_created',
      companyId: company.id,
      description: company.name,
    },
    ownerId,
  );
  return company;
};

export const updateCompany = async (id: string, input: UpdateCompanyInput): Promise<CrmCompany> => {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
  if (input.website !== undefined) patch.website = input.website;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.type !== undefined) patch.type = input.type;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.address !== undefined) patch.address = input.address;
  if (input.city !== undefined) patch.city = input.city;
  if (input.state !== undefined) patch.state = input.state;
  if (input.postalCode !== undefined) patch.postal_code = input.postalCode;
  if (input.country !== undefined) patch.country = input.country;
  if (input.linkedinUrl !== undefined) patch.linkedin_url = input.linkedinUrl;
  if (input.companySize !== undefined) patch.company_size = input.companySize;
  if (input.annualRevenue !== undefined) patch.annual_revenue = input.annualRevenue;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.customFields !== undefined) patch.custom_fields = input.customFields ?? {};

  let { data, error } = await supabase.from('crm_companies').update(patch).eq('id', id).select().single();
  if (error && isDetailColumnMissing(error)) {
    ({ data, error } = await supabase
      .from('crm_companies')
      .update(withoutDetailColumns(patch))
      .eq('id', id)
      .select()
      .single());
  }
  if (error) throw error;
  return mapCompany(data);
};

export const deleteCompany = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_companies').delete().eq('id', id);
  if (error) throw error;
};

/**
 * Adds many companies at once and returns their ids and names. On a database
 * that does not have the newer columns yet, the same rows go in without them.
 */
export const insertCompanyRows = async (
  rows: Array<Record<string, unknown>>,
): Promise<Array<{ id: string; name: string }>> => {
  if (rows.length === 0) return [];
  let { data, error } = await supabase.from('crm_companies').insert(rows).select('id, name');
  if (error && isDetailColumnMissing(error)) {
    ({ data, error } = await supabase.from('crm_companies').insert(rows.map(withoutDetailColumns)).select('id, name'));
  }
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
};

const COMPANY_SEED_COLUMNS = [
  'website', 'industry', 'phone', 'email', 'address', 'city', 'state', 'postal_code', 'country',
  'company_size', 'annual_revenue',
] as const;

/** A company to find or create by name, with whatever else is known about it. */
export type CompanySeed = { name: string } & Partial<Record<(typeof COMPANY_SEED_COLUMNS)[number], unknown>>;

/**
 * Finds the companies with these names in a workspace and creates the ones
 * that are missing, so a lead can be linked to its company by name. Names are
 * compared without regard to capitals or spacing. A company that already
 * exists is left as it is; a new one gets the details passed with its name.
 * Returns company ids keyed by `companyKey(name)`.
 */
export const ensureCompaniesByName = async (
  organizationId: string,
  workspaceId: string | null,
  companies: Array<string | CompanySeed>,
  ownerId: string | null,
): Promise<Map<string, string>> => {
  // The first mention of a company decides its spelling and its details.
  const wanted = new Map<string, CompanySeed>();
  for (const entry of companies) {
    const seed = typeof entry === 'string' ? { name: entry } : entry;
    const name = seed.name.replace(/\s+/g, ' ').trim();
    if (name && !wanted.has(companyKey(name))) wanted.set(companyKey(name), { ...seed, name });
  }
  const ids = new Map<string, string>();
  if (wanted.size === 0) return ids;

  let q = supabase.from('crm_companies').select('id, name').eq('organization_id', organizationId);
  q = applyWorkspaceFilter(q, workspaceId);
  const { data: existing, error } = await q;
  if (error) throw error;
  for (const row of (existing ?? []) as Array<{ id: string; name: string }>) {
    const key = companyKey(row.name);
    if (wanted.has(key) && !ids.has(key)) ids.set(key, row.id);
  }

  // Every row carries every column, so one company's details never blank another's defaults.
  const missing = [...wanted].filter(([key]) => !ids.has(key)).map(([, seed]) => {
    const row: Record<string, unknown> = {
      organization_id: organizationId,
      workspace_id: workspaceId,
      owner_id: ownerId,
      name: seed.name,
    };
    for (const column of COMPANY_SEED_COLUMNS) row[column] = seed[column] ?? null;
    return row;
  });
  if (missing.length) {
    const created = await insertCompanyRows(missing);
    for (const row of created) ids.set(companyKey(row.name), row.id);
  }
  return ids;
};
