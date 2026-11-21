/**
 * The CRM's reports: what happened in a period, for everyone or one person.
 * Pure functions only, so every number can be tested on its own.
 *
 * What each figure means:
 *   leads added     leads created in the period
 *   became a deal   of those, the ones that have at least one deal
 *   deals won/lost  deals whose close date falls in the period
 *   win rate        won / (won + lost), of the deals closed in the period
 *   days to win     from the day a won deal was created to the day it closed
 *   open pipeline   open deals as they stand today (not tied to the period)
 * A person's figures are for the leads and deals they own, and for what they
 * logged themselves.
 */

export type PeriodKey = 'this_month' | 'last_month' | 'last_90_days' | 'this_year' | 'all_time';

export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'this_year', label: 'This year' },
  { key: 'all_time', label: 'All time' },
];

export interface Period { from: Date | null; to: Date }

/** The start and end of a period, in the person's own time zone. `to` is never after now. */
export function periodRange(key: PeriodKey, now: Date): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'this_month': return { from: new Date(y, m, 1), to: now };
    case 'last_month': return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1, 0, 0, 0, -1) };
    case 'last_90_days': return { from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), to: now };
    case 'this_year': return { from: new Date(y, 0, 1), to: now };
    case 'all_time': return { from: null, to: now };
  }
}

const inPeriod = (date: Date | null | undefined, period: Period): boolean =>
  !!date && (period.from === null || date.getTime() >= period.from.getTime()) && date.getTime() <= period.to.getTime();

export interface ReportLead { id: string; ownerId: string | null; source: string | null; createdAt: Date }
export interface ReportDeal {
  id: string;
  ownerId: string | null;
  contactId: string | null;
  stageId: string;
  status: 'open' | 'won' | 'lost';
  lostReason: string | null;
  createdAt: Date;
  closedAt: Date | null;
  /** The deal's value in the company's own currency. */
  value: number;
}
export interface ReportActivity { userId: string | null; type: string; createdAt: Date }
export interface ReportStage { id: string; name: string; sortOrder: number; status: 'open' | 'won' | 'lost' }
export interface ReportPerson { userId: string; name: string }

export interface PersonRow {
  userId: string | null;
  name: string;
  leadsAdded: number;
  dealsWon: number;
  wonValue: number;
  dealsLost: number;
  calls: number;
  emails: number;
  meetings: number;
  notes: number;
}

export interface SourceRow { source: string; leads: number; becameDeal: number; won: number }

export interface SalesReport {
  leadsAdded: number;
  becameDeal: number;
  /** becameDeal / leadsAdded as a whole percentage, or null with no leads. */
  leadToDealPercent: number | null;
  dealsWon: number;
  wonValue: number;
  dealsLost: number;
  /** won / (won + lost) as a whole percentage, or null when nothing closed. */
  winRatePercent: number | null;
  /** Average whole days from created to won, or null when nothing was won. */
  daysToWin: number | null;
  openDeals: number;
  openValue: number;
  byStage: Array<{ stageId: string; name: string; deals: number; value: number }>;
  byPerson: PersonRow[];
  bySource: SourceRow[];
  lostReasons: Array<{ reason: string; deals: number }>;
}

const NO_SOURCE = 'No source';
const NO_REASON = 'No reason given';
const NOBODY = 'Nobody';
const DAY_MS = 24 * 60 * 60 * 1000;

const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

export function salesReport(
  data: { leads: ReportLead[]; deals: ReportDeal[]; activities: ReportActivity[]; stages: ReportStage[]; people: ReportPerson[] },
  period: Period,
  /** One person's figures, or null for everyone's. */
  ownerId: string | null,
): SalesReport {
  const mine = <T extends { ownerId: string | null }>(rows: T[]): T[] => (ownerId === null ? rows : rows.filter((r) => r.ownerId === ownerId));
  const leads = mine(data.leads);
  const deals = mine(data.deals);
  const activities = (ownerId === null ? data.activities : data.activities.filter((a) => a.userId === ownerId)).filter((a) => inPeriod(a.createdAt, period));

  // A lead "became a deal" when any deal names it, whoever owns that deal.
  const leadsWithDeal = new Set(data.deals.map((d) => d.contactId).filter((id): id is string => !!id));
  const leadsWithWonDeal = new Set(data.deals.filter((d) => d.status === 'won').map((d) => d.contactId).filter((id): id is string => !!id));

  const added = leads.filter((l) => inPeriod(l.createdAt, period));
  const becameDeal = added.filter((l) => leadsWithDeal.has(l.id)).length;
  const won = deals.filter((d) => d.status === 'won' && inPeriod(d.closedAt, period));
  const lost = deals.filter((d) => d.status === 'lost' && inPeriod(d.closedAt, period));
  const open = deals.filter((d) => d.status === 'open');

  const cycles = won.filter((d) => d.closedAt).map((d) => Math.max(0, ((d.closedAt as Date).getTime() - d.createdAt.getTime()) / DAY_MS));

  const byStage = data.stages
    .filter((s) => s.status === 'open')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const here = open.filter((d) => d.stageId === s.id);
      return { stageId: s.id, name: s.name, deals: here.length, value: here.reduce((sum, d) => sum + d.value, 0) };
    });

  // People: everyone in the team, plus "Nobody" when something in the period has no owner.
  const personRow = (userId: string | null, name: string): PersonRow => {
    const wonBy = won.filter((d) => d.ownerId === userId);
    const logged = activities.filter((a) => a.userId === userId);
    return {
      userId,
      name,
      leadsAdded: added.filter((l) => l.ownerId === userId).length,
      dealsWon: wonBy.length,
      wonValue: wonBy.reduce((sum, d) => sum + d.value, 0),
      dealsLost: lost.filter((d) => d.ownerId === userId).length,
      calls: logged.filter((a) => a.type === 'call').length,
      emails: logged.filter((a) => a.type === 'email').length,
      meetings: logged.filter((a) => a.type === 'meeting').length,
      notes: logged.filter((a) => a.type === 'note').length,
    };
  };
  const busy = (r: PersonRow) => r.leadsAdded + r.dealsWon + r.dealsLost + r.calls + r.emails + r.meetings + r.notes > 0;
  const people = ownerId === null ? data.people : data.people.filter((p) => p.userId === ownerId);
  const byPerson = [
    ...people.map((p) => personRow(p.userId, p.name)),
    ...(ownerId === null ? [personRow(null, NOBODY)].filter(busy) : []),
  ].sort((a, b) => b.wonValue - a.wonValue || b.dealsWon - a.dealsWon || b.leadsAdded - a.leadsAdded || a.name.localeCompare(b.name));

  const sources = new Map<string, SourceRow>();
  for (const lead of added) {
    const source = lead.source?.trim() || NO_SOURCE;
    const row = sources.get(source) ?? { source, leads: 0, becameDeal: 0, won: 0 };
    row.leads += 1;
    if (leadsWithDeal.has(lead.id)) row.becameDeal += 1;
    if (leadsWithWonDeal.has(lead.id)) row.won += 1;
    sources.set(source, row);
  }

  const reasons = new Map<string, number>();
  for (const deal of lost) {
    const reason = deal.lostReason?.trim() || NO_REASON;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    leadsAdded: added.length,
    becameDeal,
    leadToDealPercent: percent(becameDeal, added.length),
    dealsWon: won.length,
    wonValue: won.reduce((sum, d) => sum + d.value, 0),
    dealsLost: lost.length,
    winRatePercent: percent(won.length, won.length + lost.length),
    daysToWin: cycles.length ? Math.round(cycles.reduce((sum, days) => sum + days, 0) / cycles.length) : null,
    openDeals: open.length,
    openValue: open.reduce((sum, d) => sum + d.value, 0),
    byStage,
    byPerson,
    bySource: [...sources.values()].sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)),
    lostReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, deals: count })).sort((a, b) => b.deals - a.deals || a.reason.localeCompare(b.reason)),
  };
}

const cell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The report as one CSV file: the totals, then each table under its own heading. */
export function reportCsv(report: SalesReport, periodLabel: string, who: string): string {
  const rows: Array<Array<string | number>> = [
    ['CRM report', periodLabel, who],
    [],
    ['Leads added', report.leadsAdded],
    ['Became a deal', report.becameDeal],
    ['Lead to deal %', report.leadToDealPercent ?? ''],
    ['Deals won', report.dealsWon],
    ['Won value', report.wonValue],
    ['Deals lost', report.dealsLost],
    ['Win rate %', report.winRatePercent ?? ''],
    ['Days to win', report.daysToWin ?? ''],
    ['Open deals', report.openDeals],
    ['Open value', report.openValue],
    [],
    ['By person', 'Leads added', 'Deals won', 'Won value', 'Deals lost', 'Calls', 'Emails', 'Meetings', 'Notes'],
    ...report.byPerson.map((p) => [p.name, p.leadsAdded, p.dealsWon, p.wonValue, p.dealsLost, p.calls, p.emails, p.meetings, p.notes]),
    [],
    ['By source', 'Leads', 'Became a deal', 'Won'],
    ...report.bySource.map((s) => [s.source, s.leads, s.becameDeal, s.won]),
    [],
    ['Open pipeline by stage', 'Deals', 'Value'],
    ...report.byStage.map((s) => [s.name, s.deals, s.value]),
    [],
    ['Why deals were lost', 'Deals'],
    ...report.lostReasons.map((r) => [r.reason, r.deals]),
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}
