import { useCallback } from 'react';
import { useOrgCurrency } from './useOrgCurrency';
import { formatMoney as formatMoneyRaw } from '@/services/supabase/payroll';
import { convertAmount, useFxRates } from '@/lib/fxRates';

/**
 * React-aware money formatter that respects the org's preferred currency
 * AND converts the value via live FX rates when the row's stored
 * currency differs from the display currency.
 *
 * History — why this matters:
 *
 *   • DB rows carry their own `currency` column. Historically, when no
 *     currency was supplied the column defaulted to 'USD', so a column
 *     value of "USD" can mean either "this is genuinely a USD amount"
 *     or "we didn't know, so we stored USD as a placeholder".
 *
 *   • The old behaviour: if `rowCurrency` was unset OR equal to 'USD',
 *     relabel as the org currency without converting. That made sense
 *     for legacy rows with placeholder USD but it was WRONG for
 *     deliberately-USD rows (a $10,000 deal rendered as £10,000 in a
 *     GBP org). Several screens — DealsListView, DealDetailView, the
 *     dashboards — were affected.
 *
 * New behaviour: always display in the org currency, and convert the
 * value through `convertAmount` first when needed. Net effect:
 *
 *   • $10,000 deal in a GBP org → £7,440 (correct, at current rate).
 *   • $10,000 deal in a USD org → $10,000 (no conversion needed).
 *   • £500 expense in a USD org → ~$540 (converted to display currency).
 *
 * Callers that ALREADY convert before calling this (e.g. PipelineAnalyticsCard,
 * the per-column deal kanban totals) are safe — they pass the already-
 * converted amount with `rowCurrency = orgCurrency`, so the inner
 * converter is a no-op.
 */
export const useFormatMoney = () => {
  const orgCurrency = useOrgCurrency();
  const { rates } = useFxRates();
  return useCallback(
    (amount: number, rowCurrency?: string | null): string => {
      // Defensive: callers occasionally bind this directly to library
      // formatters (e.g. Recharts tickFormatter) that pass a numeric tick
      // index as the second arg. Treat anything non-string as "use the
      // org currency directly" so .trim() doesn't crash the render and
      // we don't try to FX-convert a chart tick.
      const raw = typeof rowCurrency === 'string' ? rowCurrency : '';
      const fromCurrency = raw.trim().toUpperCase() || orgCurrency;
      const displayAmount = fromCurrency === orgCurrency
        ? amount
        : convertAmount(amount, fromCurrency, orgCurrency, rates);
      return formatMoneyRaw(displayAmount, orgCurrency);
    },
    [orgCurrency, rates],
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
      const raw = typeof rowCurrency === 'string' ? rowCurrency : '';
      const trimmed = raw.trim().toUpperCase();
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
