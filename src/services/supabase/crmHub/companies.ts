import { supabase } from '../config';
import type { CrmCompany, CreateCompanyInput, UpdateCompanyInput } from '@/types/crmHub';
import { tryLogActivity } from './activities';
import { applyWorkspaceFilter } from './workspaceFilter';
import { companyKey } from '@/lib/crmImport';

interface CompanyRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  owner_id: string | null;
  name: string;
  website: string | null;
  industry: string | null;
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
  phone: r.phone,
  email: r.email,
  address: r.address,
  city: r.city,
  country: r.country,
  companySize: r.company_size,
  annualRevenue: r.annual_revenue == null ? null : Number(r.annual_revenue),
  notes: r.notes,
  customFields: r.custom_fields ?? {},
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export const listCompanies = async (
  organizationId: string,
  opts: { workspaceId?: string | null } = {},
): Promise<CrmCompany[]> => {
  let q = supabase
    .from('crm_companies')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true });
  q = applyWorkspaceFilter(q, opts.workspaceId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapCompany);
};

export const getCompany = async (id: string): Promise<CrmCompany | null> => {
  const { data, error } = await supabase.from('crm_companies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapCompany(data) : null;
};

export const createCompany = async (input: CreateCompanyInput, ownerId: string | null): Promise<CrmCompany> => {
  const { data, error } = await supabase
    .from('crm_companies')
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId ?? null,
      owner_id: ownerId,
      name: input.name,
      website: input.website ?? null,
      industry: input.industry ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      company_size: input.companySize ?? null,
      annual_revenue: input.annualRevenue ?? null,
      notes: input.notes ?? null,
      custom_fields: input.customFields ?? {},
    })
    .select()
    .single();
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
  if (input.website !== undefined) patch.website = input.website;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.address !== undefined) patch.address = input.address;
  if (input.city !== undefined) patch.city = input.city;
  if (input.country !== undefined) patch.country = input.country;
  if (input.companySize !== undefined) patch.company_size = input.companySize;
  if (input.annualRevenue !== undefined) patch.annual_revenue = input.annualRevenue;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.customFields !== undefined) patch.custom_fields = input.customFields ?? {};

  const { data, error } = await supabase
    .from('crm_companies')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapCompany(data);
};

export const deleteCompany = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_companies').delete().eq('id', id);
  if (error) throw error;
};

const COMPANY_SEED_COLUMNS = [
  'website', 'industry', 'phone', 'email', 'address', 'city', 'country', 'company_size', 'annual_revenue',
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
    const { data: created, error: insertError } = await supabase.from('crm_companies').insert(missing).select('id, name');
    if (insertError) throw insertError;
    for (const row of (created ?? []) as Array<{ id: string; name: string }>) ids.set(companyKey(row.name), row.id);
  }
  return ids;
};
