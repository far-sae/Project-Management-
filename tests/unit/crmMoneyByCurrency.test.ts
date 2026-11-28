import { describe, expect, it } from 'vitest';
import { accountCurrency, formatByCurrency } from '@/lib/crmCurrency';

describe('money that may be in more than one currency', () => {
  it('writes one currency as one amount', () => {
    expect(formatByCurrency([{ amount: 700, currency: 'GBP' }, { amount: 500, currency: 'GBP' }], 'GBP')).toBe('£1,200');
  });

  it('never adds two currencies: each has its own amount, ours first', () => {
    expect(formatByCurrency([
      { amount: 200, currency: 'USD' }, { amount: 700, currency: 'GBP' }, { amount: 50, currency: 'EUR' }, { amount: 300, currency: 'USD' },
    ], 'GBP')).toBe('£700 + €50 + $500');
  });

  it('leaves out a currency with nothing in it, and writes zero in ours when there is nothing at all', () => {
    expect(formatByCurrency([{ amount: 0, currency: 'USD' }, { amount: 40, currency: 'GBP' }], 'GBP')).toBe('£40');
    expect(formatByCurrency([{ amount: 0, currency: 'USD' }], 'GBP')).toBe('£0');
    expect(formatByCurrency([], 'GBP')).toBe('£0');
  });

  it('takes a service without a currency of its own as being in ours', () => {
    expect(accountCurrency({ currency: null }, 'GBP')).toBe('GBP');
    expect(accountCurrency({}, 'GBP')).toBe('GBP');
    expect(accountCurrency({ currency: ' usd ' }, 'GBP')).toBe('USD');
  });
});
