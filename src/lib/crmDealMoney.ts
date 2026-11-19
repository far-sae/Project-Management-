/**
 * Money on a deal. A deal can be in its own currency; every total is in the
 * company currency. Pure functions only: the caller passes in the company
 * currency and the exchange rates.
 */
import { convertAmount } from '@/lib/fxRates';

/** The parts of a deal these functions read. A `CrmDeal` fits as it is. */
export interface DealMoney {
  value: number;
  /** ISO code the value is in. Null means the company currency. */
  currency: string | null;
}

/** Exchange rates, as `useFxRates()` returns them. */
export type FxRates = Record<string, number>;

const tidy = (code: string | null | undefined): string => (code ?? '').trim().toUpperCase();

/** The currency a deal's value is in: its own, or the company currency when it has none. */
export function dealCurrency(deal: Pick<DealMoney, 'currency'>, companyCurrency: string): string {
  return tidy(deal.currency) || tidy(companyCurrency);
}

/**
 * True when a deal was entered in another currency but the database could not
 * keep it (migration 182 has not been run), so the amount now reads as the
 * company currency. The person has to be told: 12,000 dollars is not 12,000 pounds.
 */
export function currencyNotSaved(
  requested: string | null | undefined,
  saved: Pick<DealMoney, 'currency'>,
  companyCurrency: string,
): boolean {
  const wanted = tidy(requested);
  return Boolean(wanted) && wanted !== tidy(companyCurrency) && !tidy(saved.currency);
}

/**
 * True when the deal is in another currency and there is a rate for both, so
 * a converted amount can be shown next to it.
 */
export function dealHasConversion(
  deal: Pick<DealMoney, 'currency'>,
  companyCurrency: string,
  rates: FxRates,
): boolean {
  const from = dealCurrency(deal, companyCurrency);
  const to = tidy(companyCurrency);
  return from !== to && Boolean(rates[from]) && Boolean(rates[to]);
}

/**
 * What a deal is worth in the company currency. When there is no rate for the
 * deal's currency the amount is returned as it is.
 */
export function dealValueInCompany(deal: DealMoney, companyCurrency: string, rates: FxRates): number {
  const from = dealCurrency(deal, companyCurrency);
  const to = tidy(companyCurrency);
  return from === to ? deal.value : convertAmount(deal.value, from, to, rates);
}

/**
 * Copies of the deals with `value` converted and `currency` set to the company
 * currency, ready for the functions that add deals up (forecast, dashboard and
 * company totals).
 */
export function dealsInCompanyCurrency<T extends DealMoney>(
  deals: T[],
  companyCurrency: string,
  rates: FxRates,
): T[] {
  const currency = tidy(companyCurrency);
  return deals.map((deal) => ({ ...deal, value: dealValueInCompany(deal, companyCurrency, rates), currency }));
}
