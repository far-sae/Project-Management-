import { supabase } from '../config';
import type { CrmDeal, CreateDealInput, UpdateDealInput, DealStatus } from '@/types/crmHub';
import { tryLogActivity } from './activities';

interface DealRow {
  id: string;
  organization_id: string;
  owner_id: string | null;
  stage_id: string;
  company_id: string | null;
  contact_id: string | null;
  name: string;
  value: number | string;
  probability: number;
  status: DealStatus;
  expected_close_date: string | null;
  source: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const mapDeal = (r: DealRow): CrmDeal => ({
  id: r.id,
  organizationId: r.organization_id,
  ownerId: r.owner_id,
  stageId: r.stage_id,
  companyId: r.company_id,
  contactId: r.contact_id,
  name: r.name,
  value: Number(r.value),
  probability: r.probability,
  status: r.status,
  expectedCloseDate: r.expected_close_date,
  source: r.source,
  notes: r.notes,
  sortOrder: r.sort_order,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export const listDeals = async (organizationId: string): Promise<CrmDeal[]> => {
  const { data, error } = await supabase
    .from('crm_deals')
    .select('*')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDeal);
};

export const getDeal = async (id: string): Promise<CrmDeal | null> => {
  const { data, error } = await supabase.from('crm_deals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapDeal(data) : null;
};

export const createDeal = async (input: CreateDealInput, ownerId: string | null): Promise<CrmDeal> => {
  const { data, error } = await supabase
    .from('crm_deals')
    .insert({
      organization_id: input.organizationId,
      owner_id: ownerId,
      stage_id: input.stageId,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      name: input.name,
      value: input.value ?? 0,
      probability: input.probability ?? 0,
      expected_close_date: input.expectedCloseDate ?? null,
      source: input.source ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const deal = mapDeal(data);
  tryLogActivity(
    {
      organizationId: deal.organizationId,
      type: 'deal_created',
      dealId: deal.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      description: deal.name,
      metadata: { value: deal.value },
    },
    ownerId,
  );
  return deal;
};

export const updateDeal = async (id: string, input: UpdateDealInput): Promise<CrmDeal> => {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.value !== undefined) patch.value = input.value;
  if (input.probability !== undefined) patch.probability = input.probability;
  if (input.stageId !== undefined) patch.stage_id = input.stageId;
  if (input.companyId !== undefined) patch.company_id = input.companyId;
  if (input.contactId !== undefined) patch.contact_id = input.contactId;
  if (input.expectedCloseDate !== undefined) patch.expected_close_date = input.expectedCloseDate;
  if (input.source !== undefined) patch.source = input.source;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from('crm_deals')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapDeal(data);
};

/** Move a deal to a new stage; also updates status if the target stage is won/lost. */
export const moveDealToStage = async (
  id: string,
  stageId: string,
  stageStatus: DealStatus,
  stageName?: string,
): Promise<CrmDeal> => {
  const { data, error } = await supabase
    .from('crm_deals')
    .update({ stage_id: stageId, status: stageStatus })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  const deal = mapDeal(data);
  const activityType =
    stageStatus === 'won' ? 'deal_won'
    : stageStatus === 'lost' ? 'deal_lost'
    : 'deal_stage_changed';
  tryLogActivity(
    {
      organizationId: deal.organizationId,
      type: activityType,
      dealId: deal.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      description: stageName ? `Moved to ${stageName}` : null,
      metadata: { stageId, stageStatus },
    },
    deal.ownerId,
  );
  return deal;
};

export const deleteDeal = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_deals').delete().eq('id', id);
  if (error) throw error;
};
