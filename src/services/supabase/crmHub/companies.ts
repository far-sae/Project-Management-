import { supabase } from '../config';
import type { CrmCompany, CreateCompanyInput, UpdateCompanyInput } from '@/types/crmHub';

interface CompanyRow {
  id: string;
  organization_id: string;
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
  created_at: string;
  updated_at: string;
}

const mapCompany = (r: CompanyRow): CrmCompany => ({
  id: r.id,
  organizationId: r.organization_id,
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
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export const listCompanies = async (organizationId: string): Promise<CrmCompany[]> => {
  const { data, error } = await supabase
    .from('crm_companies')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true });
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
      owner_id: ownerId,
      name: input.name,
      website: input.website ?? null,
      industry: input.industry ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      company_size: input.companySize ?? null,
      annual_revenue: input.annualRevenue ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapCompany(data);
};

export const updateCompany = async (id: string, input: UpdateCompanyInput): Promise<CrmCompany> => {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.website !== undefined) patch.website = input.website;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.city !== undefined) patch.city = input.city;
  if (input.country !== undefined) patch.country = input.country;
  if (input.companySize !== undefined) patch.company_size = input.companySize;
  if (input.annualRevenue !== undefined) patch.annual_revenue = input.annualRevenue;
  if (input.notes !== undefined) patch.notes = input.notes;

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
