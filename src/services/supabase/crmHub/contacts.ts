import { supabase } from '../config';
import type {
  CrmContact,
  CreateContactInput,
  UpdateContactInput,
  LifecycleStage,
  LeadStatus,
} from '@/types/crmHub';
import { tryLogActivity } from './activities';

interface ContactRow {
  id: string;
  organization_id: string;
  owner_id: string | null;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  lifecycle_stage: LifecycleStage;
  lead_status: LeadStatus;
  source: string | null;
  notes: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

const mapContact = (r: ContactRow): CrmContact => ({
  id: r.id,
  organizationId: r.organization_id,
  ownerId: r.owner_id,
  companyId: r.company_id,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  jobTitle: r.job_title,
  lifecycleStage: r.lifecycle_stage,
  leadStatus: r.lead_status,
  source: r.source,
  notes: r.notes,
  lastContactedAt: r.last_contacted_at ? new Date(r.last_contacted_at) : null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export const listContacts = async (organizationId: string): Promise<CrmContact[]> => {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('organization_id', organizationId)
    .order('first_name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapContact);
};

export const getContact = async (id: string): Promise<CrmContact | null> => {
  const { data, error } = await supabase.from('crm_contacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapContact(data) : null;
};

export const createContact = async (input: CreateContactInput, ownerId: string | null): Promise<CrmContact> => {
  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      organization_id: input.organizationId,
      owner_id: ownerId,
      company_id: input.companyId ?? null,
      first_name: input.firstName,
      last_name: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      job_title: input.jobTitle ?? null,
      lifecycle_stage: input.lifecycleStage ?? 'lead',
      lead_status: input.leadStatus ?? 'new',
      source: input.source ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const contact = mapContact(data);
  tryLogActivity(
    {
      organizationId: contact.organizationId,
      type: 'contact_created',
      contactId: contact.id,
      description: `${contact.firstName} ${contact.lastName ?? ''}`.trim(),
    },
    ownerId,
  );
  return contact;
};

export const updateContact = async (id: string, input: UpdateContactInput): Promise<CrmContact> => {
  const patch: Record<string, unknown> = {};
  if (input.firstName !== undefined) patch.first_name = input.firstName;
  if (input.lastName !== undefined) patch.last_name = input.lastName;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.jobTitle !== undefined) patch.job_title = input.jobTitle;
  if (input.companyId !== undefined) patch.company_id = input.companyId;
  if (input.lifecycleStage !== undefined) patch.lifecycle_stage = input.lifecycleStage;
  if (input.leadStatus !== undefined) patch.lead_status = input.leadStatus;
  if (input.source !== undefined) patch.source = input.source;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from('crm_contacts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapContact(data);
};

export const deleteContact = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_contacts').delete().eq('id', id);
  if (error) throw error;
};
