/**
 * The figures on the CRM dashboard. Pure functions only: the page passes in
 * what it loaded and the current time, and renders what comes back.
 */
import { dealNeedsHandoff, weightedDealValue, type FlowDealStatus, type FlowStage } from '@/lib/crmFlow';
import { followUpBucket, localYmd } from '@/lib/crmFollowUps';
import type { CrmTask } from '@/types/crmHub';

/** The parts of a deal the dashboard reads. A `CrmDeal` fits as it is. */
export interface DashboardDeal {
  id: string;
  name: string;
  status: FlowDealStatus;
  stageId: string;
  value: number;
  /** The deal's own chance of winning, 0–100. 0 means "follow the stage". */
  probability: number;
  projectId: string | null;
  closedAt: Date | null;
  lostReason: string | null;
  updatedAt: Date;
}

type StageChance = Pick<FlowStage, 'probability'>;

/** When a deal was closed; deals closed before close dates were stored use their last update. */
const closedOn = (deal: Pick<DashboardDeal, 'closedAt' | 'updatedAt'>): Date => deal.closedAt ?? deal.updatedAt;

const sameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// ── Headline figures ────────────────────────────────────────────────────

export interface PipelineStats {
  openCount: number;
  /** Sum of every open deal's value. */
  openValue: number;
  /** Open value weighted by each deal's chance of winning. */
  forecast: number;
  wonCount: number;
  lostCount: number;
  wonThisMonthCount: number;
  wonThisMonthValue: number;
  /** Won ÷ (won + lost) as a whole percentage; null when nothing has closed. */
  winRate: number | null;
}

export function pipelineStats(
  deals: Pick<DashboardDeal, 'status' | 'stageId' | 'value' | 'probability' | 'closedAt' | 'updatedAt'>[],
  stagesById: Map<string, StageChance>,
  now: Date,
): PipelineStats {
  const stats: PipelineStats = {
    openCount: 0,
    openValue: 0,
    forecast: 0,
    wonCount: 0,
    lostCount: 0,
    wonThisMonthCount: 0,
    wonThisMonthValue: 0,
    winRate: null,
  };
  for (const deal of deals) {
    if (deal.status === 'open') {
      stats.openCount += 1;
      stats.openValue += deal.value;
      stats.forecast += weightedDealValue(deal, stagesById);
    } else if (deal.status === 'won') {
      stats.wonCount += 1;
      if (sameMonth(closedOn(deal), now)) {
        stats.wonThisMonthCount += 1;
        stats.wonThisMonthValue += deal.value;
      }
    } else {
      stats.lostCount += 1;
    }
  }
  const closed = stats.wonCount + stats.lostCount;
  stats.winRate = closed === 0 ? null : Math.round((stats.wonCount / closed) * 100);
  return stats;
}

// ── Flow: lead → deal → won → delivery ──────────────────────────────────

export interface FlowCounts {
  /** People still at the lead stage. */
  leads: number;
  openDeals: number;
  won: number;
  /** Won deals that have been handed off into a project. */
  inDelivery: number;
}

export function flowCounts(
  contacts: { lifecycleStage: string }[],
  deals: Pick<DashboardDeal, 'status' | 'projectId'>[],
): FlowCounts {
  const won = deals.filter((d) => d.status === 'won');
  return {
    leads: contacts.filter((c) => c.lifecycleStage === 'lead').length,
    openDeals: deals.filter((d) => d.status === 'open').length,
    won: won.length,
    inDelivery: won.filter((d) => !dealNeedsHandoff(d)).length,
  };
}

/** Won deals still waiting to be turned into a project, longest wait first. */
export function handoffQueue<T extends Pick<DashboardDeal, 'status' | 'projectId' | 'closedAt' | 'updatedAt'>>(
  deals: T[],
): T[] {
  return deals
    .filter((d) => dealNeedsHandoff(d))
    .sort((a, b) => closedOn(a).getTime() - closedOn(b).getTime());
}

// ── Pipeline by stage ───────────────────────────────────────────────────

export interface StageRow {
  stageId: string;
  name: string;
  /** The stage's chance of winning, 0–100. */
  probability: number;
  /** Open deals in the stage. */
  count: number;
  value: number;
  /** Value weighted by each deal's chance of winning. */
  weighted: number;
  /** The stage's share of all open value shown, 0–1. */
  share: number;
}

/** One row per open stage, in pipeline order, counting open deals only. */
export function stageBreakdown(
  deals: Pick<DashboardDeal, 'status' | 'stageId' | 'value' | 'probability'>[],
  stages: FlowStage[],
): StageRow[] {
  const openStages = stages.filter((s) => s.status === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const stagesById = new Map(openStages.map((s) => [s.id, s]));
  const rows = new Map<string, StageRow>(
    openStages.map((s) => [
      s.id,
      { stageId: s.id, name: s.name, probability: s.probability, count: 0, value: 0, weighted: 0, share: 0 },
    ]),
  );
  let total = 0;
  for (const deal of deals) {
    const row = deal.status === 'open' ? rows.get(deal.stageId) : undefined;
    if (!row) continue;
    row.count += 1;
    row.value += deal.value;
    row.weighted += weightedDealValue(deal, stagesById);
    total += deal.value;
  }
  return [...rows.values()].map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 }));
}

// ── Lost reasons ────────────────────────────────────────────────────────

export interface LostReasonCount {
  /** As first typed, trimmed. */
  reason: string;
  count: number;
}

/**
 * The most common reasons deals were lost. Blank reasons are left out, and
 * the same reason typed in a different case or with stray spaces is counted
 * as one.
 */
export function lostReasonCounts(
  deals: Pick<DashboardDeal, 'status' | 'lostReason'>[],
  limit = 5,
): LostReasonCount[] {
  const byKey = new Map<string, LostReasonCount>();
  for (const deal of deals) {
    if (deal.status !== 'lost') continue;
    const reason = deal.lostReason?.trim().replace(/\s+/g, ' ') ?? '';
    if (!reason) continue;
    const key = reason.toLowerCase();
    const found = byKey.get(key);
    if (found) found.count += 1;
    else byKey.set(key, { reason, count: 1 });
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

// ── Follow-ups ──────────────────────────────────────────────────────────

export interface FollowUpsDue<T> {
  /** Soonest first, cut to the limit. */
  items: { task: T; overdue: boolean }[];
  /** Every follow-up that is overdue or due in the window, before the limit. */
  total: number;
  /** How many of `total` are already overdue. */
  overdue: number;
}

/**
 * Unfinished follow-ups that are overdue or due within the next `days` days.
 * Days are compared, not hours, with the same rule as the Follow-ups page:
 * something due earlier today only becomes overdue tomorrow.
 */
export function followUpsDue<T extends Pick<CrmTask, 'status' | 'dueDate'>>(
  tasks: T[],
  now: Date,
  days = 7,
  limit = 8,
): FollowUpsDue<T> {
  const today = localYmd(now);
  const lastDay = localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const due = tasks
    .filter(
      (t): t is T & { dueDate: Date } =>
        t.status !== 'completed' && t.dueDate != null && localYmd(t.dueDate) <= lastDay,
    )
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((task) => ({ task: task as T, overdue: followUpBucket(task, today) === 'overdue' }));
  return {
    items: due.slice(0, limit),
    total: due.length,
    overdue: due.filter((d) => d.overdue).length,
  };
}
