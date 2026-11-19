import type { StatusTone } from '@/components/common/StatusPill';
import type { CrmDeal } from '@/types/crmHub';

/** The deal fields the company page reads. */
type DealLike = Pick<CrmDeal, 'status' | 'value' | 'projectId'>;

export interface CompanyDealSummary {
  /** Number of deals still open. */
  open: number;
  /** Number of deals won. */
  won: number;
  /** Number of deals lost. */
  lost: number;
  /** Total value of the open deals. */
  openValue: number;
  /** Total value of the won deals. */
  wonValue: number;
  /** Number of different projects these deals were handed off to. */
  projects: number;
  /** Won deals that have no project yet. */
  awaitingHandoff: number;
}

const valueOf = (deal: DealLike): number => {
  const value = Number(deal.value);
  return Number.isFinite(value) ? value : 0;
};

/** Counts and totals for one company's deals. */
export const companyDealSummary = (deals: DealLike[]): CompanyDealSummary => {
  const summary: CompanyDealSummary = {
    open: 0, won: 0, lost: 0, openValue: 0, wonValue: 0, projects: 0, awaitingHandoff: 0,
  };
  const projectIds = new Set<string>();
  for (const deal of deals) {
    if (deal.projectId) projectIds.add(deal.projectId);
    if (deal.status === 'open') {
      summary.open += 1;
      summary.openValue += valueOf(deal);
    } else if (deal.status === 'won') {
      summary.won += 1;
      summary.wonValue += valueOf(deal);
      if (!deal.projectId) summary.awaitingHandoff += 1;
    } else {
      summary.lost += 1;
    }
  }
  summary.projects = projectIds.size;
  return summary;
};

const STATUS_PILL: Record<CrmDeal['status'], { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'info' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
};

/** Label and colour of the status pill shown for a deal. */
export const dealStatusPill = (deal: Pick<CrmDeal, 'status'>): { label: string; tone: StatusTone } =>
  STATUS_PILL[deal.status];

/**
 * Where a deal stands on handoff to project management:
 * `project` it has a project, `awaiting` it is won but has none yet,
 * `none` there is nothing to hand off.
 */
export type DealHandoffState = 'project' | 'awaiting' | 'none';

export const dealHandoffState = (deal: Pick<CrmDeal, 'status' | 'projectId'>): DealHandoffState => {
  if (deal.projectId) return 'project';
  return deal.status === 'won' ? 'awaiting' : 'none';
};
