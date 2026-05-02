import { useCallback } from 'react';
import { useOrgCurrency } from './useOrgCurrency';
import { formatMoney as formatMoneyRaw } from '@/services/supabase/payroll';

/**
 * React-aware money formatter that respects the org's preferred currency.
 *
 * Why this exists: rows in the DB carry a `currency` column that's been
 * defaulting to 'USD' since long before the multi-currency Settings page
 * existed. Showing those legacy rows in $ even after the owner picks GBP is
 * the bug the user keeps hitting. So:
 *
 *   • Row currency missing OR equal to 'USD' → use the org currency.
 *   • Row currency explicitly set to something other than 'USD' → keep it
 *     (otherwise a genuinely-EUR contract would silently relabel as GBP).
 *
 * If the org is itself in USD, this is a no-op — every row stays as it was.
 */
export const useFormatMoney = () => {
  const orgCurrency = useOrgCurrency();
  return useCallback(
    (amount: number, rowCurrency?: string | null): string => {
      const trimmed = (rowCurrency ?? '').trim().toUpperCase();
      const useCurrency = trimmed && trimmed !== 'USD' ? trimmed : orgCurrency;
      return formatMoneyRaw(amount, useCurrency);
    },
    [orgCurrency],
  );
};

/**
 * Convenience: returns just the symbol (e.g. "£") that goes with the
 * resolved display currency. Used in places that prefix amounts manually
 * (Contracts list).
 */
export const useDisplayCurrencySymbol = () => {
  const orgCurrency = useOrgCurrency();
  return useCallback(
    (rowCurrency?: string | null): string => {
      const trimmed = (rowCurrency ?? '').trim().toUpperCase();
      const useCurrency = trimmed && trimmed !== 'USD' ? trimmed : orgCurrency;
      try {
        const parts = new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: useCurrency,
          currencyDisplay: 'narrowSymbol',
        }).formatToParts(0);
        const sym = parts.find((p) => p.type === 'currency');
        return sym?.value ?? useCurrency;
      } catch {
        return useCurrency;
      }
    },
    [orgCurrency],
  );
};

export default useFormatMoney;
