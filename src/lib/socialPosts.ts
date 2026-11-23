// The posts table of the Social page.
//
// One row for each platform a post went to (or will go to). Above it: tabs by
// state, a search, filters for the platform, the account, the campaign and a
// span of date and time. Everything here is plain logic, so the table itself
// only draws.
import { publicText } from '@/lib/publicError';
import { csvText } from '@/lib/signroom/billingCsv';
import type { SocialAccount, SocialCampaign, SocialContent, SocialContentStatus } from '@/types/social';
import { PLATFORM_NAME, isPlatform } from '../../api/_social/shared/platforms';

export type PostTab = 'all' | 'scheduled' | 'posted' | 'failed' | 'approval' | 'drafts';

export const POST_TABS: Array<{ id: PostTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'posted', label: 'Posted' },
  { id: 'failed', label: 'Not posted' },
  { id: 'approval', label: 'To approve' },
  { id: 'drafts', label: 'Drafts' },
];

/** The tab a post's state is shown under. A post that is going out right now is still "scheduled". */
export const tabOf = (status: SocialContentStatus): Exclude<PostTab, 'all'> =>
  status === 'published' ? 'posted'
    : status === 'failed' ? 'failed'
      : status === 'draft' ? 'drafts'
        : status === 'in_review' || status === 'approved' ? 'approval'
          : 'scheduled';

/** The state of a post in a word or two. */
export const STATE_LABEL: Record<SocialContentStatus, string> = {
  draft: 'Draft',
  in_review: 'Waiting for approval',
  approved: 'Approved',
  scheduled: 'Waiting to go out',
  publishing: 'Posting now',
  published: 'Posted',
  failed: 'Not posted',
};

export type PostRow = {
  post: SocialContent;
  /** "youtube", "tiktok", ... or "" when the post has no account (yet), or the account is gone. */
  platform: string;
  platformName: string;
  accountName: string;
  campaignName: string;
  /** The one date and time of the row: posted, planned, or made. */
  when: Date;
  whenLabel: 'Posted' | 'Planned' | 'Made';
  /** The address of the published post, when the platform gave one. */
  link: string | null;
};

const linkOf = (post: SocialContent): string | null =>
  post.status === 'published' && /^https:\/\/[^\s]+$/.test(post.externalPostId ?? '') ? (post.externalPostId as string) : null;

export function postRows(content: SocialContent[], accounts: SocialAccount[], campaigns: SocialCampaign[]): PostRow[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  return content.map((post) => {
    const account = post.accountId ? accountById.get(post.accountId) : undefined;
    const platform = account && isPlatform(account.provider) ? account.provider : '';
    const posted = post.status === 'published';
    const when = (posted ? post.publishedAt : null) ?? post.scheduledAt ?? post.createdAt;
    return {
      post,
      platform,
      platformName: account ? (isPlatform(account.provider) ? PLATFORM_NAME[account.provider] : 'Other') : post.accountId ? 'Account removed' : 'No account',
      accountName: account?.displayName ?? '',
      campaignName: post.campaignId ? campaignById.get(post.campaignId)?.name ?? '' : '',
      when,
      whenLabel: posted ? 'Posted' : post.scheduledAt ? 'Planned' : 'Made',
      link: linkOf(post),
    };
  });
}

export type PostFilters = {
  tab: PostTab;
  search: string;
  /** A platform ("youtube"), or "" for every platform. */
  platform: string;
  accountId: string;
  campaignId: string;
  /** From and to, as the date-and-time box writes them ("2026-11-20T10:00"), or "". */
  from: string;
  to: string;
};

export const NO_FILTERS: PostFilters = { tab: 'all', search: '', platform: '', accountId: '', campaignId: '', from: '', to: '' };

/** A date-and-time box's text as a moment, or null when it is empty or half-typed. */
const moment = (value: string): number | null => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
};

function matches(row: PostRow, f: PostFilters, withTab: boolean): boolean {
  if (withTab && f.tab !== 'all' && tabOf(row.post.status) !== f.tab) return false;
  if (f.platform && row.platform !== f.platform) return false;
  if (f.accountId && row.post.accountId !== f.accountId) return false;
  if (f.campaignId && row.post.campaignId !== f.campaignId) return false;

  // Typed the wrong way round, the two are simply taken as earliest and latest.
  const a = moment(f.from);
  const b = moment(f.to);
  const from = a !== null && b !== null ? Math.min(a, b) : a;
  // "To 10:00" means up to the end of that minute.
  const to = a !== null && b !== null ? Math.max(a, b) : b;
  const at = row.when.getTime();
  if (from !== null && at < from) return false;
  if (to !== null && at >= to + 60_000) return false;

  const word = f.search.trim().toLowerCase();
  if (word) {
    const hay = `${row.post.title}\n${row.post.body}\n${row.accountName}\n${row.platformName}\n${row.campaignName}`.toLowerCase();
    if (!hay.includes(word)) return false;
  }
  return true;
}

export const filterRows = (rows: PostRow[], filters: PostFilters): PostRow[] => rows.filter((row) => matches(row, filters, true));

/** How many posts each tab would show, with the other filters as they are. */
export function tabCounts(rows: PostRow[], filters: PostFilters): Record<PostTab, number> {
  const counts: Record<PostTab, number> = { all: 0, scheduled: 0, posted: 0, failed: 0, approval: 0, drafts: 0 };
  for (const row of rows) {
    if (!matches(row, filters, false)) continue;
    counts.all += 1;
    counts[tabOf(row.post.status)] += 1;
  }
  return counts;
}

/** How many filters are switched on. The tab is not one: it is always in view. */
export const activeFilters = (f: PostFilters): number =>
  [f.search.trim(), f.platform, f.accountId, f.campaignId, f.from || f.to].filter(Boolean).length;

// ── Date and time ────────────────────────────────────────────────────────────

const two = (n: number): string => String(n).padStart(2, '0');

/** A moment the way a date-and-time box reads it: "2026-03-05T07:04", in the person's own time. */
export const toLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;

export type QuickRange = 'any' | 'today' | 'last7' | 'last30' | 'thisMonth' | 'next7';

export const QUICK_RANGES: Array<{ id: QuickRange; label: string }> = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'next7', label: 'Next 7 days' },
];

/** The from and to of a ready-made span, as the date-and-time boxes read them. */
export function quickRange(kind: QuickRange, now: Date = new Date()): { from: string; to: string } {
  if (kind === 'any') return { from: '', to: '' };
  const day = (offset: number, endOfDay: boolean): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, endOfDay ? 23 : 0, endOfDay ? 59 : 0);
  switch (kind) {
    case 'today': return { from: toLocalInput(day(0, false)), to: toLocalInput(day(0, true)) };
    case 'last7': return { from: toLocalInput(day(-6, false)), to: toLocalInput(day(0, true)) };
    case 'last30': return { from: toLocalInput(day(-29, false)), to: toLocalInput(day(0, true)) };
    case 'thisMonth':
      return {
        from: toLocalInput(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0)),
        to: toLocalInput(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59)),
      };
    case 'next7': return { from: toLocalInput(now), to: toLocalInput(day(7, true)) };
  }
}

/** Which ready-made span the two boxes hold right now, so the list can show it as chosen. */
export function quickRangeOf(from: string, to: string, now: Date = new Date()): QuickRange | 'custom' {
  if (!from && !to) return 'any';
  for (const { id } of QUICK_RANGES) {
    if (id === 'any' || id === 'next7') continue;
    const span = quickRange(id, now);
    if (span.from === from && span.to === to) return id;
  }
  return 'custom';
}

// ── Sorting and pages ────────────────────────────────────────────────────────

export type PostSort = { by: 'when' | 'title' | 'platform' | 'status'; dir: 'asc' | 'desc' };
export const FIRST_SORT: PostSort = { by: 'when', dir: 'desc' };

const STATE_ORDER: SocialContentStatus[] = ['draft', 'in_review', 'approved', 'scheduled', 'publishing', 'published', 'failed'];

export function sortRows(rows: PostRow[], sort: PostSort): PostRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = (row: PostRow): string | number =>
    sort.by === 'when' ? row.when.getTime()
      : sort.by === 'title' ? row.post.title.toLowerCase()
        : sort.by === 'platform' ? row.platformName.toLowerCase()
          : STATE_ORDER.indexOf(row.post.status);
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    // Equal: the newest first, whichever way the column is sorted.
    return b.when.getTime() - a.when.getTime();
  });
}

export const PAGE_SIZE = 25;

export function pageOf(rows: PostRow[], page: number, size: number = PAGE_SIZE): { rows: PostRow[]; page: number; pages: number; from: number; to: number; total: number } {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (at - 1) * size;
  const shown = rows.slice(start, start + size);
  return { rows: shown, page: at, pages, from: total ? start + 1 : 0, to: start + shown.length, total };
}

// ── Export ───────────────────────────────────────────────────────────────────

/** "2026-11-20 10:05": a date and time a spreadsheet can sort. */
const stamp = (d: Date): string => toLocalInput(d).replace('T', ' ');

/** The rows shown, as a file for a spreadsheet. */
export function rowsCsv(rows: PostRow[]): string {
  return csvText([
    ['Post', 'Text', 'Platform', 'Account', 'State', 'Date and time', 'Campaign', 'Link', 'Problem'],
    ...rows.map((row) => [
      row.post.title,
      row.post.body,
      row.platformName,
      row.accountName,
      STATE_LABEL[row.post.status],
      stamp(row.when),
      row.campaignName,
      row.link ?? '',
      row.post.status === 'failed' && row.post.lastError ? publicText(row.post.lastError, 'The post was not accepted.') : '',
    ]),
  ]);
}
