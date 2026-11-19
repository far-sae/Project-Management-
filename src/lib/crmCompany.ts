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

// ── The company record ───────────────────────────────────────────────────────

/** "https://www.northwind.example/about" → "northwind.example". */
export const companyDomain = (website: string | null | undefined): string | null => {
  const raw = (website ?? '').trim().toLowerCase();
  if (!raw) return null;
  const domain = raw.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
  return domain || null;
};

/** A link that opens, whether or not the website was typed with https. */
export const websiteHref = (website: string | null | undefined): string | null => {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};

type Address = {
  address: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null;
};

/** The address as written on a letter: street, then city with region and postcode, then country. */
export const companyAddressLines = (company: Address): string[] => {
  const clean = (v: string | null) => (v ?? '').trim();
  const region = [clean(company.state), clean(company.postalCode)].filter(Boolean).join(' ');
  const cityLine = [clean(company.city), region].filter(Boolean).join(', ');
  return [clean(company.address), cityLine, clean(company.country)].filter(Boolean);
};

/** What a company can be to you. Someone picks one, or it is worked out from the deals. */
export const COMPANY_TYPES = ['Prospect', 'Customer', 'Partner', 'Supplier', 'Reseller', 'Competitor', 'Other'] as const;

const TYPE_TONE: Record<string, StatusTone> = {
  Prospect: 'neutral', Customer: 'success', Partner: 'info', Supplier: 'muted',
  Reseller: 'info', Competitor: 'warning', Other: 'muted',
};

/**
 * The kind of company this is. A chosen type wins. Without one, a company you
 * have won a deal from is a customer and every other company is a prospect.
 */
export const companyRelationship = (
  company: { type: string | null },
  deals: { wonDeals: number; openDeals: number } | undefined,
): { label: string; tone: StatusTone; chosen: boolean } => {
  const typed = (company.type ?? '').trim();
  if (typed) {
    // An imported "customer" is the same thing as "Customer".
    const label = COMPANY_TYPES.find((type) => type.toLowerCase() === typed.toLowerCase()) ?? typed;
    return { label, tone: TYPE_TONE[label] ?? 'neutral', chosen: true };
  }
  const label = (deals?.wonDeals ?? 0) > 0 ? 'Customer' : 'Prospect';
  return { label, tone: TYPE_TONE[label]!, chosen: false };
};

export interface CompanyRollup {
  leads: number;
  openDeals: number;
  openValue: number;
  wonDeals: number;
  wonValue: number;
  /** The latest logged activity or deal change. */
  lastActivityAt: Date | null;
}

/**
 * Per company: how many leads and deals it has, what they are worth, and when
 * something last happened. Deal values must already be in one currency.
 */
export const companyRollups = (data: {
  contacts: ReadonlyArray<{ companyId: string | null }>;
  deals: ReadonlyArray<{ companyId: string | null; status: CrmDeal['status']; value: number; updatedAt: Date }>;
  activities: ReadonlyArray<{ companyId: string | null; createdAt: Date }>;
}): Map<string, CompanyRollup> => {
  const out = new Map<string, CompanyRollup>();
  const of = (companyId: string): CompanyRollup => {
    let rollup = out.get(companyId);
    if (!rollup) {
      rollup = { leads: 0, openDeals: 0, openValue: 0, wonDeals: 0, wonValue: 0, lastActivityAt: null };
      out.set(companyId, rollup);
    }
    return rollup;
  };
  const touch = (rollup: CompanyRollup, at: Date) => {
    if (!rollup.lastActivityAt || at > rollup.lastActivityAt) rollup.lastActivityAt = at;
  };
  for (const contact of data.contacts) {
    if (contact.companyId) of(contact.companyId).leads += 1;
  }
  for (const deal of data.deals) {
    if (!deal.companyId) continue;
    const rollup = of(deal.companyId);
    const value = Number.isFinite(Number(deal.value)) ? Number(deal.value) : 0;
    if (deal.status === 'open') {
      rollup.openDeals += 1;
      rollup.openValue += value;
    } else if (deal.status === 'won') {
      rollup.wonDeals += 1;
      rollup.wonValue += value;
    }
    touch(rollup, deal.updatedAt);
  }
  for (const activity of data.activities) {
    if (activity.companyId) touch(of(activity.companyId), activity.createdAt);
  }
  return out;
};

type Listed = {
  id: string; name: string; website: string | null; industry: string | null; city: string | null;
  type: string | null; ownerId: string | null;
};

export type CompanyOwnerFilter = 'all' | 'mine' | 'none';

/** The companies that match the search box and the two filters. */
export const filterCompanies = <T extends Listed>(
  companies: T[],
  rollups: Map<string, CompanyRollup>,
  filter: { search: string; type: string; owner: CompanyOwnerFilter; meId: string | null },
): T[] => {
  const q = filter.search.trim().toLowerCase();
  return companies.filter((c) => {
    if (filter.owner === 'mine' && (!c.ownerId || c.ownerId !== filter.meId)) return false;
    if (filter.owner === 'none' && c.ownerId) return false;
    if (filter.type !== 'all' && companyRelationship(c, rollups.get(c.id)).label !== filter.type) return false;
    if (!q) return true;
    return [c.name, companyDomain(c.website), c.industry, c.city]
      .some((value) => (value ?? '').toLowerCase().includes(q));
  });
};

export type CompanySort = 'name' | 'activity' | 'pipeline';

/** By name, by what happened most recently, or by the most open pipeline. Ties fall back to the name. */
export const sortCompanies = <T extends { id: string; name: string }>(
  companies: T[],
  rollups: Map<string, CompanyRollup>,
  sort: CompanySort,
): T[] => {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  if (sort === 'name') return [...companies].sort(byName);
  const score = (c: T): number => {
    const rollup = rollups.get(c.id);
    if (sort === 'pipeline') return rollup?.openValue ?? 0;
    return rollup?.lastActivityAt?.getTime() ?? 0;
  };
  return [...companies].sort((a, b) => score(b) - score(a) || byName(a, b));
};
