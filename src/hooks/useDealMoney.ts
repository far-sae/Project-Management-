import { useMemo } from 'react';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { formatCurrency } from '@/lib/crmCurrency';
import {
  dealCurrency, dealHasConversion, dealValueInCompany, dealsInCompanyCurrency, type DealMoney,
} from '@/lib/crmDealMoney';
import { useFxRates } from '@/lib/fxRates';

export interface DealMoneyTools {
  companyCurrency: string;
  /** "$12,000": the deal in its own currency. */
  formatDeal: (deal: DealMoney) => string;
  /** "≈ £9,480" when the deal is in another currency, otherwise null. */
  formatDealConverted: (deal: DealMoney) => string | null;
  /** The deal's value in the company currency, for totals. */
  inCompany: (deal: DealMoney) => number;
  /** Deals with values converted, for the aggregate functions. */
  allInCompany: <T extends DealMoney>(deals: T[]) => T[];
}

/**
 * Money on deals. A deal is written in its own currency; anything that adds
 * deals up uses the company currency, converted with today's rates.
 *
 * Call it once per page or dialog and hand the result down to rows and cards:
 * every call keeps its own copy of the exchange rates.
 */
export function useDealMoney(): DealMoneyTools {
  const { code: companyCurrency, format } = useCrmCurrency();
  const { rates } = useFxRates();

  return useMemo(() => {
    const inCompany = (deal: DealMoney) => dealValueInCompany(deal, companyCurrency, rates);
    return {
      companyCurrency,
      formatDeal: (deal) => {
        const currency = dealCurrency(deal, companyCurrency);
        return currency === dealCurrency({ currency: null }, companyCurrency)
          ? format(deal.value)
          : formatCurrency(deal.value, currency);
      },
      formatDealConverted: (deal) =>
        dealHasConversion(deal, companyCurrency, rates) ? `≈ ${format(inCompany(deal))}` : null,
      inCompany,
      allInCompany: (deals) => dealsInCompanyCurrency(deals, companyCurrency, rates),
    };
  }, [companyCurrency, format, rates]);
}

export default useDealMoney;
