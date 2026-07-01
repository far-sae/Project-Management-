import { supabase } from '../config';
import type { CrmDealStage, DealStatus } from '@/types/crmHub';

interface DealStageRow {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  probability: number;
  status: DealStatus;
  created_at: string;
}

const mapDealStage = (r: DealStageRow): CrmDealStage => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  sortOrder: r.sort_order,
  probability: r.probability,
  status: r.status,
  createdAt: new Date(r.created_at),
});

export const listDealStages = async (organizationId: string): Promise<CrmDealStage[]> => {
  const { data, error } = await supabase
    .from('crm_deal_stages')
    .select('*')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapDealStage);
};

/** Seeds the seven default HubSpot-style stages if the org has none. */
export const seedDefaultDealStages = async (organizationId: string): Promise<void> => {
  const { error } = await supabase.rpc('crm_seed_default_stages', { p_org: organizationId });
  if (error) throw error;
};
