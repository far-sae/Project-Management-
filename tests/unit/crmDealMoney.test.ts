// A deal can be in its own currency; totals are always in the company currency.
import { describe, expect, it } from 'vitest';
import {
  currencyNotSaved, dealCurrency, dealHasConversion, dealValueInCompany, dealsInCompanyCurrency,
} from '@/lib/crmDealMoney';
import { weightedDealValue } from '@/lib/crmFlow';
import { pipelineStats, stageBreakdown } from '@/lib/crmDashboard';
import { companyDealSummary } from '@/lib/crmCompany';

// 1 USD = 0.8 GBP = 0.9 EUR
const rates = { USD: 1, GBP: 0.8, EUR: 0.9 };

describe('dealCurrency', () => {
  it('is the company currency when the deal has none of its own', () => {
    expect(dealCurrency({ currency: null }, 'GBP')).toBe('GBP');
    expect(dealCurrency({ currency: '' }, 'GBP')).toBe('GBP');
    expect(dealCurrency({ currency: '  ' }, 'GBP')).toBe('GBP');
  });

  it('is the deal’s own currency when it has one, tidied up', () => {
    expect(dealCurrency({ currency: 'USD' }, 'GBP')).toBe('USD');
    expect(dealCurrency({ currency: ' usd ' }, 'GBP')).toBe('USD');
  });

  it('tidies the company currency too', () => {
    expect(dealCurrency({ currency: null }, ' gbp ')).toBe('GBP');
  });
});

describe('dealValueInCompany', () => {
  it('converts a deal in another currency', () => {
    expect(dealValueInCompany({ value: 12000, currency: 'USD' }, 'GBP', rates)).toBeCloseTo(9600);
    expect(dealValueInCompany({ value: 900, currency: 'EUR' }, 'GBP', rates)).toBeCloseTo(800);
  });

  it('leaves a deal in the company currency as it is', () => {
    expect(dealValueInCompany({ value: 500, currency: null }, 'GBP', rates)).toBe(500);
    expect(dealValueInCompany({ value: 500, currency: 'GBP' }, 'GBP', rates)).toBe(500);
    expect(dealValueInCompany({ value: 500, currency: 'gbp' }, 'GBP', rates)).toBe(500);
  });

  it('keeps the amount when there is no rate for the currency', () => {
    expect(dealValueInCompany({ value: 700, currency: 'XXX' }, 'GBP', rates)).toBe(700);
  });
});

describe('dealHasConversion', () => {
  it('is true only for a deal in another currency that has a rate', () => {
    expect(dealHasConversion({ currency: 'USD' }, 'GBP', rates)).toBe(true);
    expect(dealHasConversion({ currency: null }, 'GBP', rates)).toBe(false);
    expect(dealHasConversion({ currency: 'GBP' }, 'GBP', rates)).toBe(false);
    expect(dealHasConversion({ currency: 'XXX' }, 'GBP', rates)).toBe(false);
    expect(dealHasConversion({ currency: 'USD' }, 'XXX', rates)).toBe(false);
  });
});

describe('dealsInCompanyCurrency', () => {
  const deals = [
    { id: 'd1', value: 12000, currency: 'USD', status: 'open' as const, stageId: 's1', probability: 0, projectId: null },
    { id: 'd2', value: 4000, currency: null, status: 'open' as const, stageId: 's2', probability: 50, projectId: null },
    { id: 'd3', value: 900, currency: 'EUR', status: 'won' as const, stageId: 's3', probability: 100, projectId: 'p1' },
  ];

  it('returns copies with the value converted and the company currency set', () => {
    const converted = dealsInCompanyCurrency(deals, 'GBP', rates);
    expect(converted.map((d) => Math.round(d.value))).toEqual([9600, 4000, 800]);
    expect(converted.map((d) => d.currency)).toEqual(['GBP', 'GBP', 'GBP']);
    expect(converted[0]).toMatchObject({ id: 'd1', status: 'open', stageId: 's1' });
  });

  it('does not change the deals it was given', () => {
    dealsInCompanyCurrency(deals, 'GBP', rates);
    expect(deals[0]).toMatchObject({ value: 12000, currency: 'USD' });
  });

  it('converting twice changes nothing more', () => {
    const once = dealsInCompanyCurrency(deals, 'GBP', rates);
    const twice = dealsInCompanyCurrency(once, 'GBP', rates);
    expect(twice.map((d) => d.value)).toEqual(once.map((d) => d.value));
  });

  it('makes the forecast, the dashboard figures and the company totals add up in one currency', () => {
    const stages = [
      { id: 's1', name: 'Qualified', sortOrder: 1, probability: 25, status: 'open' as const },
      { id: 's2', name: 'Proposal', sortOrder: 2, probability: 60, status: 'open' as const },
      { id: 's3', name: 'Won', sortOrder: 3, probability: 100, status: 'won' as const },
    ];
    const stagesById = new Map(stages.map((s) => [s.id, s]));
    const now = new Date('2026-11-18T10:00:00Z');
    const converted = dealsInCompanyCurrency(
      deals.map((d) => ({ ...d, name: d.id, closedAt: d.status === 'won' ? now : null, lostReason: null, updatedAt: now })),
      'GBP',
      rates,
    );

    // 12,000 USD → 9,600 GBP at the stage's 25%.
    expect(weightedDealValue(converted[0]!, stagesById)).toBeCloseTo(2400);

    const stats = pipelineStats(converted, stagesById, now);
    expect(stats.openValue).toBeCloseTo(13600);
    // 9,600 × 25% + 4,000 × 50%
    expect(stats.forecast).toBeCloseTo(4400);
    expect(stats.wonThisMonthValue).toBeCloseTo(800);

    const rows = stageBreakdown(converted, stages);
    expect(rows.map((r) => Math.round(r.value))).toEqual([9600, 4000]);

    const summary = companyDealSummary(converted);
    expect(summary.openValue).toBeCloseTo(13600);
    expect(summary.wonValue).toBeCloseTo(800);
  });
});

describe('currencyNotSaved', () => {
  it('is true when a deal was entered in another currency but came back without one', () => {
    expect(currencyNotSaved('USD', { currency: null }, 'GBP')).toBe(true);
  });
  it('is false when the currency was kept', () => {
    expect(currencyNotSaved('USD', { currency: 'USD' }, 'GBP')).toBe(false);
  });
  it('is false when the deal was in the company currency anyway, so nothing is misread', () => {
    expect(currencyNotSaved('gbp', { currency: null }, 'GBP')).toBe(false);
    expect(currencyNotSaved(null, { currency: null }, 'GBP')).toBe(false);
  });
});
