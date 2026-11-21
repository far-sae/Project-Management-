// The CRM's reports: every figure, for a period and for one person.
import { describe, expect, it } from 'vitest';
import { periodRange, reportCsv, salesReport, type ReportDeal, type ReportLead } from '@/lib/crmReports';

const now = new Date(2026, 10, 21, 12, 0, 0); // 21 Nov 2026
const day = (d: number, month = 10) => new Date(2026, month, d, 10, 0, 0);

const SAM = 'u-sam';
const PRIYA = 'u-priya';
const people = [{ userId: SAM, name: 'Sam' }, { userId: PRIYA, name: 'Priya' }];
const stages = [
  { id: 's2', name: 'Qualified', sortOrder: 2, status: 'open' as const },
  { id: 's1', name: 'New', sortOrder: 1, status: 'open' as const },
  { id: 'sw', name: 'Won', sortOrder: 9, status: 'won' as const },
  { id: 'sl', name: 'Lost', sortOrder: 10, status: 'lost' as const },
];

const lead = (id: string, ownerId: string | null, source: string | null, createdAt: Date): ReportLead => ({ id, ownerId, source, createdAt });
const deal = (id: string, over: Partial<ReportDeal>): ReportDeal => ({
  id, ownerId: SAM, contactId: null, stageId: 's1', status: 'open', lostReason: null, createdAt: day(1), closedAt: null, value: 1000, ...over,
});

const data = {
  people,
  stages,
  leads: [
    lead('l1', SAM, 'Website form', day(3)),
    lead('l2', SAM, 'Website form', day(5)),
    lead('l3', PRIYA, ' Referral ', day(8)),
    lead('l4', null, null, day(9)),
    lead('old', SAM, 'Website form', day(20, 8)), // September: outside this month
  ],
  deals: [
    deal('d1', { contactId: 'l1', status: 'won', stageId: 'sw', createdAt: day(4), closedAt: day(14), value: 5000 }),
    deal('d2', { contactId: 'l3', ownerId: PRIYA, status: 'won', stageId: 'sw', createdAt: day(9), closedAt: day(13), value: 2000 }),
    deal('d3', { contactId: 'l2', status: 'lost', stageId: 'sl', closedAt: day(15), lostReason: 'Price' }),
    deal('d4', { ownerId: PRIYA, status: 'lost', stageId: 'sl', closedAt: day(16), lostReason: '  ' }),
    deal('d5', { status: 'open', stageId: 's1', value: 3000 }),
    deal('d6', { ownerId: PRIYA, status: 'open', stageId: 's2', value: 7000 }),
    deal('d7', { contactId: 'old', status: 'won', stageId: 'sw', createdAt: day(1, 8), closedAt: day(28, 8), value: 9000 }), // won in September
  ],
  activities: [
    { userId: SAM, type: 'call', createdAt: day(6) },
    { userId: SAM, type: 'call', createdAt: day(7) },
    { userId: SAM, type: 'email', createdAt: day(7) },
    { userId: PRIYA, type: 'meeting', createdAt: day(10) },
    { userId: PRIYA, type: 'note', createdAt: day(10) },
    { userId: SAM, type: 'call', createdAt: day(2, 8) }, // September
    { userId: null, type: 'email', createdAt: day(11) }, // sent by the system
  ],
};

describe('report periods', () => {
  it('start and end where the name says, and never end after now', () => {
    expect(periodRange('this_month', now)).toEqual({ from: new Date(2026, 10, 1), to: now });
    const last = periodRange('last_month', now);
    expect(last.from).toEqual(new Date(2026, 9, 1));
    expect(last.to.getMonth()).toBe(9);
    expect(last.to.getDate()).toBe(31);
    expect(periodRange('this_year', now).from).toEqual(new Date(2026, 0, 1));
    expect(periodRange('all_time', now).from).toBeNull();
    expect(Math.round((now.getTime() - (periodRange('last_90_days', now).from as Date).getTime()) / 86_400_000)).toBe(90);
  });
});

describe('sales report', () => {
  const month = periodRange('this_month', now);

  it('adds up the month for everyone', () => {
    const r = salesReport(data, month, null);
    expect(r).toMatchObject({
      leadsAdded: 4, becameDeal: 3, leadToDealPercent: 75,
      dealsWon: 2, wonValue: 7000, dealsLost: 2, winRatePercent: 50,
      // (10 days + 4 days) / 2
      daysToWin: 7,
      openDeals: 2, openValue: 10000,
    });
  });

  it('lists the open pipeline by stage, in stage order, as it stands today', () => {
    const r = salesReport(data, periodRange('last_month', now), null);
    expect(r.byStage).toEqual([
      { stageId: 's1', name: 'New', deals: 1, value: 3000 },
      { stageId: 's2', name: 'Qualified', deals: 1, value: 7000 },
    ]);
    // Nothing closed in October.
    expect(r).toMatchObject({ dealsWon: 0, winRatePercent: null, daysToWin: null, leadToDealPercent: null });
  });

  it('shows each person their own leads, deals and what they logged', () => {
    const r = salesReport(data, month, null);
    expect(r.byPerson).toEqual([
      { userId: SAM, name: 'Sam', leadsAdded: 2, dealsWon: 1, wonValue: 5000, dealsLost: 1, calls: 2, emails: 1, meetings: 0, notes: 0 },
      { userId: PRIYA, name: 'Priya', leadsAdded: 1, dealsWon: 1, wonValue: 2000, dealsLost: 1, calls: 0, emails: 0, meetings: 1, notes: 1 },
      // The lead nobody owns and the email the system sent are not lost: they show under "Nobody".
      { userId: null, name: 'Nobody', leadsAdded: 1, dealsWon: 0, wonValue: 0, dealsLost: 0, calls: 0, emails: 1, meetings: 0, notes: 0 },
    ]);
  });

  it('narrows every figure to one person', () => {
    const r = salesReport(data, month, PRIYA);
    expect(r).toMatchObject({ leadsAdded: 1, becameDeal: 1, dealsWon: 1, wonValue: 2000, dealsLost: 1, winRatePercent: 50, daysToWin: 4, openDeals: 1, openValue: 7000 });
    expect(r.byPerson.map((p) => p.name)).toEqual(['Priya']);
    expect(r.lostReasons).toEqual([{ reason: 'No reason given', deals: 1 }]);
  });

  it('says where the leads came from and how far each source got', () => {
    expect(salesReport(data, month, null).bySource).toEqual([
      { source: 'Website form', leads: 2, becameDeal: 2, won: 1 },
      { source: 'No source', leads: 1, becameDeal: 0, won: 0 },
      { source: 'Referral', leads: 1, becameDeal: 1, won: 1 },
    ]);
  });

  it('counts why deals were lost, most common first', () => {
    expect(salesReport(data, month, null).lostReasons).toEqual([{ reason: 'No reason given', deals: 1 }, { reason: 'Price', deals: 1 }]);
  });

  it('covers everything for "all time"', () => {
    const r = salesReport(data, periodRange('all_time', now), null);
    expect(r).toMatchObject({ leadsAdded: 5, dealsWon: 3, wonValue: 16000 });
    expect(r.byPerson[0]).toMatchObject({ name: 'Sam', calls: 3, wonValue: 14000 });
  });

  it('is all zeros, not an error, for an empty CRM', () => {
    const r = salesReport({ leads: [], deals: [], activities: [], stages: [], people: [] }, month, null);
    expect(r).toMatchObject({ leadsAdded: 0, leadToDealPercent: null, winRatePercent: null, daysToWin: null, openValue: 0 });
    expect([r.byPerson, r.bySource, r.byStage, r.lostReasons]).toEqual([[], [], [], []]);
  });
});

describe('report as a file', () => {
  it('writes the totals and each table, and protects commas and quotes', () => {
    const withComma = { ...data, deals: [...data.deals, deal('d8', { status: 'lost', stageId: 'sl', closedAt: day(17), lostReason: 'Too "slow", they said' })] };
    const csv = reportCsv(salesReport(withComma, periodRange('this_month', now), null), 'This month', 'Everyone');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('CRM report,This month,Everyone');
    expect(lines).toContain('Leads added,4');
    expect(lines).toContain('Won value,7000');
    expect(lines).toContain('Sam,2,1,5000,2,2,1,0,0');
    expect(lines).toContain('Website form,2,2,1');
    expect(lines).toContain('New,1,3000');
    expect(lines).toContain('"Too ""slow"", they said",1');
  });
});
