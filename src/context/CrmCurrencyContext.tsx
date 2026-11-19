import React, { createContext, useCallback, useContext, useState } from 'react';
import { useOrganization } from './OrganizationContext';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { updateOrganization } from '@/services/supabase/organizations';
import { DEFAULT_CURRENCY, currencyDef, formatCurrency, type CurrencyDef } from '@/lib/crmCurrency';

interface CrmCurrencyContextValue {
  code: string;
  def: CurrencyDef;
  loading: boolean;
  setCurrency: (next: string) => Promise<void>;
  format: (amount: number, opts?: { maximumFractionDigits?: number }) => string;
}

const noop = async () => {};

const CrmCurrencyContext = createContext<CrmCurrencyContextValue>({
  code: DEFAULT_CURRENCY,
  def: currencyDef(DEFAULT_CURRENCY),
  loading: false,
  setCurrency: noop,
  format: (n) => formatCurrency(n, DEFAULT_CURRENCY),
});

/**
 * Money in the CRM. There is one currency for the whole company (the one in
 * the organisation's settings, which HR, payroll, expenses and contracts
 * already use), so the CRM reads that and changing it here changes it there.
 */
export const CrmCurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { organization, refreshOrganization } = useOrganization();
  const code = useOrgCurrency();
  const [loading, setLoading] = useState(false);

  const setCurrency = useCallback(async (next: string) => {
    if (!organization) return;
    setLoading(true);
    try {
      await updateOrganization(organization.organizationId, {
        settings: { ...organization.settings, currency: next },
      });
      await refreshOrganization({ silent: true });
    } finally {
      setLoading(false);
    }
  }, [organization, refreshOrganization]);

  const format = useCallback(
    (amount: number, opts?: { maximumFractionDigits?: number }) => formatCurrency(amount, code, opts),
    [code],
  );

  const value: CrmCurrencyContextValue = { code, def: currencyDef(code), loading, setCurrency, format };

  return <CrmCurrencyContext.Provider value={value}>{children}</CrmCurrencyContext.Provider>;
};

export const useCrmCurrency = () => useContext(CrmCurrencyContext);
