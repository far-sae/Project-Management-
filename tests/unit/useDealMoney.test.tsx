// How one deal's money is written, and what it is worth in the company currency.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const ctx = vi.hoisted(() => ({
  currency: {
    code: 'GBP',
    format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`,
  },
  // 1 USD = 0.8 GBP = 0.9 EUR
  fx: { rates: { USD: 1, GBP: 0.8, EUR: 0.9 } as Record<string, number>, usingFallback: false, fetchedAt: 1 },
}));

vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => ctx.currency }));
vi.mock('@/lib/fxRates', async (original) => ({
  ...(await original<typeof import('@/lib/fxRates')>()),
  useFxRates: () => ctx.fx,
}));

import { useDealMoney } from '@/hooks/useDealMoney';

afterEach(cleanup);

const money = () => renderHook(() => useDealMoney()).result.current;

describe('useDealMoney', () => {
  it('says what the company currency is', () => {
    expect(money().companyCurrency).toBe('GBP');
  });

  it('writes a deal in its own currency', () => {
    const { formatDeal } = money();
    expect(formatDeal({ value: 12000, currency: 'USD' })).toBe('$12,000');
    expect(formatDeal({ value: 900, currency: 'EUR' })).toBe('€900');
    expect(formatDeal({ value: 9500, currency: null })).toBe('£9,500');
    expect(formatDeal({ value: 9500, currency: 'GBP' })).toBe('£9,500');
  });

  it('adds the converted amount only for a deal in another currency', () => {
    const { formatDealConverted } = money();
    expect(formatDealConverted({ value: 12000, currency: 'USD' })).toBe('≈ £9,600');
    expect(formatDealConverted({ value: 9500, currency: null })).toBeNull();
    expect(formatDealConverted({ value: 9500, currency: 'GBP' })).toBeNull();
  });

  it('does not show a converted amount it cannot work out', () => {
    expect(money().formatDealConverted({ value: 700, currency: 'XXX' })).toBeNull();
  });

  it('gives the value in the company currency for totals', () => {
    const { inCompany } = money();
    expect(inCompany({ value: 12000, currency: 'USD' })).toBeCloseTo(9600);
    expect(inCompany({ value: 9500, currency: null })).toBe(9500);
  });

  it('converts a list of deals for the functions that add them up', () => {
    const { allInCompany } = money();
    const converted = allInCompany([
      { id: 'd1', value: 12000, currency: 'USD' },
      { id: 'd2', value: 4000, currency: null },
    ]);
    expect(converted.map((d) => [d.id, Math.round(d.value), d.currency])).toEqual([
      ['d1', 9600, 'GBP'],
      ['d2', 4000, 'GBP'],
    ]);
  });

  it('hands back the same functions until the currency or the rates change', () => {
    const { result, rerender } = renderHook(() => useDealMoney());
    const first = result.current;
    rerender();
    expect(result.current.formatDeal).toBe(first.formatDeal);
    expect(result.current.allInCompany).toBe(first.allInCompany);
  });
});
