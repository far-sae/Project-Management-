import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useOrganization } from './OrganizationContext';
import { getCrmSettings, updateCrmSettings } from '@/services/supabase/crmHub/settings';
import {
  CURRENCY_BY_CODE, DEFAULT_CURRENCY, formatCurrency,
  type CurrencyCode, type CurrencyDef,
} from '@/lib/crmCurrency';

interface CrmCurrencyContextValue {
  code: CurrencyCode;
  def: CurrencyDef;
  loading: boolean;
  setCurrency: (next: CurrencyCode) => Promise<void>;
  format: (amount: number, opts?: { maximumFractionDigits?: number }) => string;
}

const noop = async () => {};

const CrmCurrencyContext = createContext<CrmCurrencyContextValue>({
  code: DEFAULT_CURRENCY,
  def: CURRENCY_BY_CODE[DEFAULT_CURRENCY],
  loading: false,
  setCurrency: noop,
  format: (n) => formatCurrency(n, DEFAULT_CURRENCY),
});

export const CrmCurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [code, setCode] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    getCrmSettings(orgId)
      .then((s) => { if (!cancelled) setCode(s.currency); })
      .catch(() => { /* keep default */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orgId]);

  const setCurrency = useCallback(async (next: CurrencyCode) => {
    if (!orgId) return;
    setLoading(true);
    try {
      await updateCrmSettings(orgId, { currency: next });
      setCode(next);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const format = useCallback(
    (amount: number, opts?: { maximumFractionDigits?: number }) => formatCurrency(amount, code, opts),
    [code],
  );

  const value: CrmCurrencyContextValue = {
    code,
    def: CURRENCY_BY_CODE[code] ?? CURRENCY_BY_CODE[DEFAULT_CURRENCY],
    loading,
    setCurrency,
    format,
  };

  return <CrmCurrencyContext.Provider value={value}>{children}</CrmCurrencyContext.Provider>;
};

export const useCrmCurrency = () => useContext(CrmCurrencyContext);
