// CRM dashboard figures: pipeline, flow, stage breakdown, lost reasons, follow-ups.
import { describe, expect, it } from 'vitest';
import {
  flowCounts,
  followUpsDue,
  handoffQueue,
  lostReasonCounts,
  pipelineStats,
  stageBreakdown,
  type DashboardDeal,
} from '@/lib/crmDashboard';

const NOW = new Date(2026, 10, 18, 12, 0, 0); // 18 Nov 2026, midday

let seq = 0;
const deal = (over: Partial<DashboardDeal> = {}): DashboardDeal => ({
  id: `d${++seq}`,
  name: 'Deal',
  status: 'open',
  stageId: 's1',
  value: 1000,
  probability: 0,
  projectId: null,
  closedAt: null,
  lostReason: null,
  updatedAt: new Date(2026, 10, 1),
  ...over,
});

const stage = (
  id: string,
  name: string,
  sortOrder: number,
  probability: number,
  status: 'open' | 'won' | 'lost' = 'open',
) => ({ id, name, sortOrder, probability, status });

const stages = [
  stage('s2', 'Proposal', 1, 60),
  stage('s1', 'Qualified', 0, 25),
  stage('s3', 'Won', 2, 100, 'won'),
  stage('s4', 'Lost', 3, 0, 'lost'),
];
const stagesById = new Map(stages.map((s) => [s.id, s]));

describe('pipelineStats', () => {
  it('adds up open deals only for the open pipeline', () => {
    const stats = pipelineStats(
      [
        deal({ value: 1000 }),
        deal({ value: 500 }),
        deal({ value: 9000, status: 'won', closedAt: NOW }),
        deal({ value: 7000, status: 'lost', closedAt: NOW }),
      ],
      stagesById,
      NOW,
    );
    expect(stats.openCount).toBe(2);
    expect(stats.openValue).toBe(1500);
  });

  it('forecast uses the stage chance when the deal has none of its own', () => {
    const stats = pipelineStats(
      [
        deal({ value: 1000, probability: 0, stageId: 's1' }), // 25% from the stage → 250
        deal({ value: 1000, probability: 80, stageId: 's1' }), // its own 80% → 800
        deal({ value: 2000, probability: 0, stageId: 's2' }), // 60% from the stage → 1200
      ],
      stagesById,
      NOW,
    );
    expect(stats.forecast).toBe(2250);
  });

  it('leaves won and lost deals out of the forecast', () => {
    const stats = pipelineStats(
      [
        deal({ value: 1000, probability: 50 }),
        deal({ value: 4000, status: 'won', probability: 100, closedAt: NOW }),
        deal({ value: 4000, status: 'lost', probability: 0, closedAt: NOW }),
      ],
      stagesById,
      NOW,
    );
    expect(stats.forecast).toBe(500);
  });

  it('has no win rate when nothing has closed', () => {
    expect(pipelineStats([], stagesById, NOW).winRate).toBeNull();
    expect(pipelineStats([deal(), deal()], stagesById, NOW).winRate).toBeNull();
  });

  it('win rate is won ÷ (won + lost), as a whole percentage', () => {
    const stats = pipelineStats(
      [
        deal({ status: 'won', closedAt: NOW }),
        deal({ status: 'lost', closedAt: NOW }),
        deal({ status: 'lost', closedAt: NOW }),
        deal(), // open deals do not count
      ],
      stagesById,
      NOW,
    );
    expect(stats.wonCount).toBe(1);
    expect(stats.lostCount).toBe(2);
    expect(stats.winRate).toBe(33);
  });

  it('won this month runs from the first to the last moment of the month', () => {
    const stats = pipelineStats(
      [
        deal({ status: 'won', value: 100, closedAt: new Date(2026, 10, 1, 0, 0, 0, 0) }), // first moment: in
        deal({ status: 'won', value: 200, closedAt: new Date(2026, 10, 30, 23, 59, 59, 999) }), // last moment: in
        deal({ status: 'won', value: 400, closedAt: new Date(2026, 9, 31, 23, 59, 59, 999) }), // October: out
        deal({ status: 'won', value: 800, closedAt: new Date(2026, 11, 1, 0, 0, 0, 0) }), // December: out
        deal({ status: 'won', value: 1600, closedAt: new Date(2025, 10, 18) }), // November last year: out
      ],
      stagesById,
      NOW,
    );
    expect(stats.wonThisMonthCount).toBe(2);
    expect(stats.wonThisMonthValue).toBe(300);
  });

  it('falls back to the last update when a won deal has no close date', () => {
    const stats = pipelineStats(
      [
        deal({ status: 'won', value: 100, closedAt: null, updatedAt: new Date(2026, 10, 5) }), // in
        deal({ status: 'won', value: 200, closedAt: null, updatedAt: new Date(2026, 9, 5) }), // out
        // The close date wins over a later edit.
        deal({ status: 'won', value: 400, closedAt: new Date(2026, 9, 20), updatedAt: new Date(2026, 10, 10) }),
      ],
      stagesById,
      NOW,
    );
    expect(stats.wonThisMonthValue).toBe(100);
  });

  it('does not count open or lost deals as won this month', () => {
    const stats = pipelineStats(
      [deal({ status: 'lost', closedAt: NOW }), deal({ updatedAt: NOW })],
      stagesById,
      NOW,
    );
    expect(stats.wonThisMonthCount).toBe(0);
    expect(stats.wonThisMonthValue).toBe(0);
  });
});

describe('flowCounts', () => {
  it('counts each step of lead → deal → won → delivery', () => {
    const contacts = [
      { lifecycleStage: 'lead' as const },
      { lifecycleStage: 'lead' as const },
      { lifecycleStage: 'opportunity' as const },
      { lifecycleStage: 'customer' as const },
    ];
    const deals = [
      deal(),
      deal(),
      deal({ status: 'won', projectId: 'p1' }),
      deal({ status: 'won', projectId: null }),
      deal({ status: 'won', projectId: 'p2' }),
      deal({ status: 'lost' }),
      deal({ status: 'open', projectId: 'p3' }), // has a project but is not won
    ];
    expect(flowCounts(contacts, deals)).toEqual({ leads: 2, openDeals: 3, won: 3, inDelivery: 2 });
  });

  it('is all zeros with nothing in the CRM', () => {
    expect(flowCounts([], [])).toEqual({ leads: 0, openDeals: 0, won: 0, inDelivery: 0 });
  });
});

describe('handoffQueue', () => {
  it('lists won deals without a project, longest wait first', () => {
    const queue = handoffQueue([
      deal({ id: 'recent', status: 'won', closedAt: new Date(2026, 10, 15) }),
      deal({ id: 'handed', status: 'won', projectId: 'p1', closedAt: new Date(2026, 10, 1) }),
      deal({ id: 'oldest', status: 'won', closedAt: new Date(2026, 10, 2) }),
      deal({ id: 'open' }),
      deal({ id: 'lost', status: 'lost', closedAt: new Date(2026, 10, 1) }),
      deal({ id: 'no-date', status: 'won', closedAt: null, updatedAt: new Date(2026, 10, 9) }),
    ]);
    expect(queue.map((d) => d.id)).toEqual(['oldest', 'no-date', 'recent']);
  });
});

describe('stageBreakdown', () => {
  it('has one row per open stage, in pipeline order', () => {
    const rows = stageBreakdown([], stages);
    expect(rows.map((r) => r.name)).toEqual(['Qualified', 'Proposal']);
    expect(rows[0]).toMatchObject({ stageId: 's1', probability: 25, count: 0, value: 0, weighted: 0, share: 0 });
  });

  it('totals count, value, weighted value and share of open value', () => {
    const rows = stageBreakdown(
      [
        deal({ stageId: 's1', value: 1000, probability: 0 }), // weighted 250
        deal({ stageId: 's1', value: 2000, probability: 50 }), // weighted 1000
        deal({ stageId: 's2', value: 1000, probability: 0 }), // weighted 600
        deal({ stageId: 's3', value: 5000, status: 'won' }), // not an open stage
        deal({ stageId: 's1', value: 9000, status: 'lost' }), // closed deal left in an open stage
      ],
      stages,
    );
    expect(rows).toEqual([
      { stageId: 's1', name: 'Qualified', probability: 25, count: 2, value: 3000, weighted: 1250, share: 0.75 },
      { stageId: 's2', name: 'Proposal', probability: 60, count: 1, value: 1000, weighted: 600, share: 0.25 },
    ]);
  });

  it('share is 0, not NaN, when the open deals are worth nothing', () => {
    const rows = stageBreakdown([deal({ stageId: 's1', value: 0 })], stages);
    expect(rows.map((r) => r.share)).toEqual([0, 0]);
    expect(rows[0].count).toBe(1);
  });
});

describe('lostReasonCounts', () => {
  it('ignores blank reasons', () => {
    const counts = lostReasonCounts([
      deal({ status: 'lost', lostReason: null }),
      deal({ status: 'lost', lostReason: '' }),
      deal({ status: 'lost', lostReason: '   ' }),
    ]);
    expect(counts).toEqual([]);
  });

  it('counts the same reason once whatever its case or spacing', () => {
    const counts = lostReasonCounts([
      deal({ status: 'lost', lostReason: 'Price too high' }),
      deal({ status: 'lost', lostReason: 'price too high' }),
      deal({ status: 'lost', lostReason: '  PRICE TOO HIGH ' }),
      deal({ status: 'lost', lostReason: 'Went with a competitor' }),
    ]);
    expect(counts).toEqual([
      { reason: 'Price too high', count: 3 },
      { reason: 'Went with a competitor', count: 1 },
    ]);
  });

  it('puts the most common first, ties in alphabetical order', () => {
    const counts = lostReasonCounts([
      deal({ status: 'lost', lostReason: 'Timing' }),
      deal({ status: 'lost', lostReason: 'Budget' }),
      deal({ status: 'lost', lostReason: 'No reply' }),
      deal({ status: 'lost', lostReason: 'No reply' }),
    ]);
    expect(counts.map((c) => c.reason)).toEqual(['No reply', 'Budget', 'Timing']);
  });

  it('only counts deals that are lost now', () => {
    const counts = lostReasonCounts([
      deal({ status: 'open', lostReason: 'Budget' }), // reopened, old reason still stored
      deal({ status: 'won', lostReason: 'Budget' }),
      deal({ status: 'lost', lostReason: 'Budget' }),
    ]);
    expect(counts).toEqual([{ reason: 'Budget', count: 1 }]);
  });

  it('keeps to the limit', () => {
    const deals = ['a', 'b', 'c', 'd'].map((r) => deal({ status: 'lost', lostReason: r }));
    expect(lostReasonCounts(deals, 2)).toHaveLength(2);
  });
});

describe('followUpsDue', () => {
  let n = 0;
  const task = (dueDate: Date | null, status: 'pending' | 'in_progress' | 'completed' = 'pending') => ({
    id: `t${++n}`,
    dueDate,
    status,
  });
  const day = (offset: number, hour = 12) => new Date(2026, 10, 18 + offset, hour);

  it('lists overdue ones and the next 7 days, soonest first', () => {
    const late = task(day(-3));
    const soon = task(day(2));
    const edge = task(day(7, 23)); // late on the 7th day ahead: in
    const beyond = task(day(8, 0)); // the first moment of the 8th day: out
    const done = task(day(-1), 'completed');
    const undated = task(null);

    const due = followUpsDue([soon, beyond, undated, edge, done, late], NOW);
    expect(due.items.map((d) => d.task.id)).toEqual([late.id, soon.id, edge.id]);
    expect(due.items.map((d) => d.overdue)).toEqual([true, false, false]);
    expect(due.total).toBe(3);
    expect(due.overdue).toBe(1);
  });

  it('counts days, not hours: due earlier today is not overdue until tomorrow', () => {
    const thisMorning = task(day(0, 9)); // NOW is midday
    const lastNight = task(day(-1, 23));
    const due = followUpsDue([thisMorning, lastNight], NOW);
    expect(due.items.map((d) => [d.task.id, d.overdue])).toEqual([
      [lastNight.id, true],
      [thisMorning.id, false],
    ]);
    expect(due.overdue).toBe(1);
  });

  it('shows at most the limit but still counts them all', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(day(-i - 1)));
    const due = followUpsDue(tasks, NOW);
    expect(due.items).toHaveLength(8);
    expect(due.total).toBe(12);
    expect(due.overdue).toBe(12);
  });

  it('is empty when nothing is due', () => {
    expect(followUpsDue([], NOW)).toEqual({ items: [], total: 0, overdue: 0 });
  });
});
