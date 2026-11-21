// Which open deals need attention: nothing happening, or the close date gone by.
import { describe, expect, it } from 'vitest';
import { dealHealth, IDLE_DAYS } from '@/lib/crmDealHealth';

const now = new Date('2026-11-21T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const deal = (over: Partial<{ status: string; updatedAt: Date; expectedCloseDate: string | null }> = {}) => ({
  status: 'open', updatedAt: daysAgo(1), expectedCloseDate: null, ...over,
});

describe('deal health', () => {
  it('flags an open deal nobody has touched for two weeks', () => {
    expect(IDLE_DAYS).toBe(14);
    expect(dealHealth(deal({ updatedAt: daysAgo(13) }), null, now)).toMatchObject({ attention: false, label: null });
    expect(dealHealth(deal({ updatedAt: daysAgo(14) }), null, now)).toMatchObject({ idle: true, attention: true, label: 'No activity for 14 days' });
    expect(dealHealth(deal({ updatedAt: daysAgo(40) }), undefined, now).label).toBe('No activity for 40 days');
  });

  it('counts anything logged on the deal as activity, not only a change to the deal itself', () => {
    const old = deal({ updatedAt: daysAgo(40) });
    expect(dealHealth(old, daysAgo(2), now)).toMatchObject({ idleDays: 2, attention: false });
    expect(dealHealth(old, daysAgo(20), now).label).toBe('No activity for 20 days');
    // And the other way round: an old note does not hide a deal that was moved yesterday.
    expect(dealHealth(deal({ updatedAt: daysAgo(1) }), daysAgo(60), now).attention).toBe(false);
  });

  it('flags a deal whose close date has passed, but not on the day itself', () => {
    expect(dealHealth(deal({ expectedCloseDate: '2026-11-20' }), null, now)).toMatchObject({ closeDatePassed: true, attention: true, label: 'Close date passed' });
    expect(dealHealth(deal({ expectedCloseDate: '2026-11-21' }), null, now).attention).toBe(false);
    expect(dealHealth(deal({ expectedCloseDate: '2026-12-15' }), null, now).attention).toBe(false);
    expect(dealHealth(deal({ expectedCloseDate: '2026-11-01', updatedAt: daysAgo(30) }), null, now).label).toBe('Close date passed, no activity for 30 days');
    expect(dealHealth(deal({ expectedCloseDate: 'not a date' }), null, now).attention).toBe(false);
  });

  it('never flags a deal that is won or lost', () => {
    for (const status of ['won', 'lost']) {
      expect(dealHealth(deal({ status, updatedAt: daysAgo(200), expectedCloseDate: '2026-01-01' }), null, now)).toMatchObject({ attention: false, label: null });
    }
  });
});
