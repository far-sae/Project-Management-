import { supabase } from '../config';
import type { CurrencyCode } from '@/lib/crmCurrency';
import { DEFAULT_CURRENCY } from '@/lib/crmCurrency';

/**
 * CRM-scoped org settings — stored in `organizations.settings` jsonb under
 * the `crm` key. No new table needed; RLS on the organizations table already
 * gates read/write to org members / admins.
 */

interface CrmSettings {
  currency: CurrencyCode;
}

const DEFAULT_SETTINGS: CrmSettings = {
  currency: DEFAULT_CURRENCY,
};

export async function getCrmSettings(organizationId: string): Promise<CrmSettings> {
  const { data, error } = await supabase
    .from('organizations')
    .select('settings')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  const raw = (data?.settings as Record<string, unknown> | null | undefined) ?? {};
  const crm = (raw.crm as Record<string, unknown> | undefined) ?? {};
  const currency = typeof crm.currency === 'string' ? (crm.currency as CurrencyCode) : DEFAULT_SETTINGS.currency;
  return { currency };
}

export async function updateCrmSettings(organizationId: string, patch: Partial<CrmSettings>): Promise<CrmSettings> {
  // Fetch existing settings, merge, write back — avoids clobbering non-CRM
  // keys other features may store on organizations.settings.
  const { data: row, error: readErr } = await supabase
    .from('organizations')
    .select('settings')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (readErr) throw readErr;

  const raw = (row?.settings as Record<string, unknown> | null | undefined) ?? {};
  const existingCrm = (raw.crm as Record<string, unknown> | undefined) ?? {};
  const nextCrm = { ...existingCrm, ...patch };
  const nextSettings = { ...raw, crm: nextCrm };

  const { error: writeErr } = await supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('organization_id', organizationId);
  if (writeErr) throw writeErr;

  return {
    currency: (nextCrm.currency as CurrencyCode) ?? DEFAULT_SETTINGS.currency,
  };
}
