// What the Calendar, Campaigns and Analytics tabs of the Social page are
// worked out from. Plain logic over the rows of the posts table (socialPosts):
// the days of a month, the posts of a day, a campaign's counts, and the
// figures for a span of days.
import type { SocialCampaign, SocialContent, SocialMetric } from '@/types/social';
import { tabOf, type PostRow } from '@/lib/socialPosts';
import { PLATFORMS, PLATFORM_NAME, isPlatform } from '../../api/_social/shared/platforms';

const two = (n: number): string => String(n).padStart(2, '0');

/** A day as "2026-11-20", in the person's own time. */
export const dayKey = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday = 0 ... Sunday = 6. */
const weekdayOf = (d: Date): number => (d.getDay() + 6) % 7;
const atNoon = (year: number, month: number, day: number): Date => new Date(year, month, day, 12);

// ── Calendar ─────────────────────────────────────────────────────────────────

/** The weeks of a month, Monday to Sunday, with the days of the months around it that fill the first and last week. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = atNoon(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const start = 1 - weekdayOf(first);
  const weeks: Date[][] = [];
  for (let day = start; day <= lastDay; day += 7) {
    weeks.push(Array.from({ length: 7 }, (_, i) => atNoon(year, month, day + i)));
  }
  return weeks;
}

/** The seven days, Monday to Sunday, of the week a day is in. */
export function weekDays(day: Date): Date[] {
  const monday = day.getDate() - weekdayOf(day);
  return Array.from({ length: 7 }, (_, i) => atNoon(day.getFullYear(), day.getMonth(), monday + i));
}

export const monthTitle = (year: number, month: number): string => `${MONTHS[month]} ${year}`;

export function weekTitle(day: Date): string {
  const [first, , , , , , last] = weekDays(day);
  const sameMonth = first.getMonth() === last.getMonth();
  return `${first.getDate()}${sameMonth ? '' : ` ${MONTHS[first.getMonth()]}`} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
}

/** A post is on the calendar once it has a real day: it was posted, or it is planned. */
const dated = (row: PostRow): boolean => row.whenLabel !== 'Made';

/** The posts of each day, earliest first. */
export function rowsByDay(rows: PostRow[]): Map<string, PostRow[]> {
  const days = new Map<string, PostRow[]>();
  for (const row of [...rows].filter(dated).sort((a, b) => a.when.getTime() - b.when.getTime())) {
    const key = dayKey(row.when);
    const list = days.get(key);
    if (list) list.push(row); else days.set(key, [row]);
  }
  return days;
}

/** The posts that are on no day yet (drafts that were never given a time). */
export const undated = (rows: PostRow[]): PostRow[] => rows.filter((row) => !dated(row));

// ── Campaigns ────────────────────────────────────────────────────────────────

export type CampaignRow = {
  campaign: SocialCampaign;
  projectName: string;
  posts: number;
  posted: number;
  failed: number;
  /** Planned, going out, waiting for approval or still a draft. */
  waiting: number;
  impressions: number;
  clicks: number;
  reactions: number;
  lastPosted: Date | null;
};

export function campaignRows(
  campaigns: SocialCampaign[],
  content: SocialContent[],
  metrics: SocialMetric[],
  projects: Array<{ projectId: string; name: string }>,
): CampaignRow[] {
  const metricOf = new Map(metrics.map((m) => [m.contentId, m]));
  const projectName = new Map(projects.map((p) => [p.projectId, p.name]));
  return campaigns.map((campaign) => {
    const row: CampaignRow = {
      campaign, projectName: campaign.projectId ? projectName.get(campaign.projectId) ?? '' : '',
      posts: 0, posted: 0, failed: 0, waiting: 0, impressions: 0, clicks: 0, reactions: 0, lastPosted: null,
    };
    for (const post of content) {
      if (post.campaignId !== campaign.id) continue;
      row.posts += 1;
      const tab = tabOf(post.status);
      if (tab === 'posted') {
        row.posted += 1;
        const at = post.publishedAt ?? post.scheduledAt;
        if (at && (!row.lastPosted || at > row.lastPosted)) row.lastPosted = at;
      } else if (tab === 'failed') row.failed += 1;
      else row.waiting += 1;
      const m = metricOf.get(post.id);
      if (m) { row.impressions += m.impressions; row.clicks += m.clicks; row.reactions += m.reactions; }
    }
    return row;
  });
}

// ── Analytics ────────────────────────────────────────────────────────────────

export type Span = { from: Date; to: Date };

/**
 * The span the two date-and-time boxes hold ("2026-11-01T00:00"), whichever
 * way round they were filled in. With a box empty or half-typed: the last 30 days.
 */
export function spanOf(from: string, to: string, now: Date = new Date()): Span {
  const a = from ? new Date(from) : null;
  const b = to ? new Date(to) : null;
  if (!a || !b || !Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0),
      to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59),
    };
  }
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export type Insights = {
  posted: number;
  failed: number;
  waiting: number;
  /** Of the posts that were tried (posted or not), the share that was posted, in whole percent. Null when none was tried. */
  successRate: number | null;
  byPlatform: Array<{ platform: string; name: string; posted: number; failed: number; waiting: number }>;
  /** One bar for each day of the span, or for each week when the span is long. */
  byDay: Array<{ key: string; label: string; posted: number; failed: number }>;
  grouped: 'day' | 'week';
  byWeekday: Array<{ label: string; posted: number }>;
  byHour: Array<{ hour: number; posted: number }>;
  results: { impressions: number; reach: number; clicks: number; reactions: number; comments: number; shares: number; any: boolean };
  /** The posts with the most views, best first. */
  top: Array<{ row: PostRow; impressions: number; clicks: number; reactions: number }>;
};

/** Longest span shown day by day. A longer one is shown week by week. */
export const DAYS_MAX = 45;

export function insights(rows: PostRow[], metrics: SocialMetric[], span: Span): Insights {
  const from = span.from.getTime();
  const to = span.to.getTime() + 60_000;
  const inSpan = rows.filter((row) => row.whenLabel !== 'Made' && row.when.getTime() >= from && row.when.getTime() < to);

  const out: Insights = {
    posted: 0, failed: 0, waiting: 0, successRate: null, byPlatform: [], byDay: [], grouped: 'day',
    byWeekday: WEEKDAYS.map((label) => ({ label, posted: 0 })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, posted: 0 })),
    results: { impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, any: false },
    top: [],
  };

  // The bars: every day of the span, or every week of a long one.
  const firstDay = atNoon(span.from.getFullYear(), span.from.getMonth(), span.from.getDate());
  const lastDay = atNoon(span.to.getFullYear(), span.to.getMonth(), span.to.getDate());
  const days = Math.round((lastDay.getTime() - firstDay.getTime()) / 86_400_000) + 1;
  out.grouped = days > DAYS_MAX ? 'week' : 'day';
  const bucketOf = (d: Date): string => (out.grouped === 'day' ? dayKey(d) : dayKey(weekDays(d)[0]));
  const buckets = new Map<string, { key: string; label: string; posted: number; failed: number }>();
  for (let i = 0; i < Math.min(days, 800); i += 1) {
    const day = atNoon(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + i);
    const key = bucketOf(day);
    if (!buckets.has(key)) {
      const start = out.grouped === 'day' ? day : weekDays(day)[0];
      buckets.set(key, { key, label: `${start.getDate()} ${MONTHS[start.getMonth()].slice(0, 3)}`, posted: 0, failed: 0 });
    }
  }

  const platforms = new Map<string, Insights['byPlatform'][number]>();
  const metricOf = new Map(metrics.map((m) => [m.contentId, m]));
  for (const row of inSpan) {
    const tab = tabOf(row.post.status);
    const kind = tab === 'posted' ? 'posted' : tab === 'failed' ? 'failed' : 'waiting';
    out[kind] += 1;

    const platformKey = row.platform || 'none';
    const platform = platforms.get(platformKey)
      ?? { platform: row.platform, name: row.platform && isPlatform(row.platform) ? PLATFORM_NAME[row.platform] : row.platformName, posted: 0, failed: 0, waiting: 0 };
    platform[kind] += 1;
    platforms.set(platformKey, platform);

    const bucket = buckets.get(bucketOf(row.when));
    if (bucket && kind !== 'waiting') bucket[kind] += 1;

    if (kind === 'posted') {
      out.byWeekday[weekdayOf(row.when)].posted += 1;
      out.byHour[row.when.getHours()].posted += 1;
      const m = metricOf.get(row.post.id);
      if (m) {
        out.results.impressions += m.impressions;
        out.results.reach += m.reach;
        out.results.clicks += m.clicks;
        out.results.reactions += m.reactions;
        out.results.comments += m.comments;
        out.results.shares += m.shares;
        if (m.impressions > 0 || m.clicks > 0 || m.reactions > 0) out.top.push({ row, impressions: m.impressions, clicks: m.clicks, reactions: m.reactions });
      }
    }
  }

  const r = out.results;
  r.any = r.impressions + r.reach + r.clicks + r.reactions + r.comments + r.shares > 0;
  const tried = out.posted + out.failed;
  out.successRate = tried > 0 ? Math.round((out.posted / tried) * 100) : null;
  out.byDay = [...buckets.values()];
  // The busiest platform first; equal ones in the order the app always shows them.
  const order = (key: string): number => { const at = (PLATFORMS as string[]).indexOf(key); return at < 0 ? 99 : at; };
  out.byPlatform = [...platforms.values()].sort((a, b) =>
    (b.posted + b.failed + b.waiting) - (a.posted + a.failed + a.waiting) || b.posted - a.posted || order(a.platform) - order(b.platform));
  out.top.sort((a, b) => b.impressions - a.impressions || b.reactions - a.reactions);
  out.top = out.top.slice(0, 5);
  return out;
}
