import { supabase } from '../config';
import type { CurrencyCode } from '@/lib/crmCurrency';
import { DEFAULT_CURRENCY } from '@/lib/crmCurrency';

export interface CrmSettings {
  currency: CurrencyCode;
}

const DEFAULT_SETTINGS: CrmSettings = { currency: DEFAULT_CURRENCY };

export async function getCrmSettings(
  organizationId: string,
  workspaceId: string,
): Promise<CrmSettings> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('crm_settings')
    .eq('workspace_id', workspaceId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  const crm = (data?.crm_settings as Record<string, unknown> | null | undefined) ?? {};
  const currency = typeof crm.currency === 'string'
    ? (crm.currency as CurrencyCode)
    : DEFAULT_SETTINGS.currency;
  return { currency };
}

export async function updateCrmSettings(
  organizationId: string,
  workspaceId: string,
  patch: Partial<CrmSettings>,
): Promise<CrmSettings> {
  const { data: row, error: readError } = await supabase
    .from('workspaces')
    .select('crm_settings')
    .eq('workspace_id', workspaceId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (readError) throw readError;

  const current = (row?.crm_settings as Record<string, unknown> | null | undefined) ?? {};
  const next = { ...current, ...patch };
  const { error: writeError } = await supabase
    .from('workspaces')
    .update({ crm_settings: next })
    .eq('workspace_id', workspaceId)
    .eq('organization_id', organizationId);
  if (writeError) throw writeError;

  return { currency: (next.currency as CurrencyCode) ?? DEFAULT_SETTINGS.currency };
}
