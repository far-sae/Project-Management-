// What the Calendar, Campaigns and Analytics tabs of the Social page are
// worked out from: the days of a month, the posts of a day, a campaign's
// counts, and the figures for a span of days.
import { describe, expect, it } from 'vitest';
import type { SocialAccount, SocialCampaign, SocialContent, SocialMetric } from '@/types/social';
import { postRows } from '@/lib/socialPosts';
import {
  campaignRows, dayKey, insights, monthGrid, monthTitle, rowsByDay, spanOf, undated, weekDays, weekTitle,
} from '@/lib/socialInsights';

const account = (id: string, provider: SocialAccount['provider'], displayName: string): SocialAccount => ({
  id, organizationId: 'org', workspaceId: 'ws', provider, displayName, externalAccountId: 'ext', status: 'connected', lastError: null, createdAt: new Date('2026-11-01'),
});
const campaign = (id: string, name: string, over: Partial<SocialCampaign> = {}): SocialCampaign => ({
  id, organizationId: 'org', workspaceId: 'ws', name, objective: null, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null, status: 'active', createdAt: new Date('2026-11-01'), ...over,
});
const post = (id: string, over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: 'org', workspaceId: 'ws', campaignId: null, accountId: 'yt', crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: `Post ${id}`, body: '', status: 'published', scheduledAt: null, publishedAt: null, lastError: null, createdAt: new Date('2026-11-10T09:00:00'),
  postGroupId: null, media: null, options: {}, externalPostId: null, ...over,
});
const metric = (contentId: string, over: Partial<SocialMetric> = {}): SocialMetric => ({ contentId, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, ...over });

const ACCOUNTS = [account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio')];
const CAMPAIGNS = [campaign('c1', 'Winter offer', { projectId: 'p1' }), campaign('c2', 'Open day', { status: 'paused' })];
const CONTENT: SocialContent[] = [
  post('a', { accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-20T10:05:00') }),             // Friday 10h
  post('b', { accountId: 'tt', campaignId: 'c1', status: 'failed', scheduledAt: new Date('2026-11-20T10:00:00') }),
  post('c', { accountId: 'ig', campaignId: 'c2', status: 'scheduled', scheduledAt: new Date('2026-11-25T18:30:00') }),
  post('d', { accountId: null, status: 'draft', createdAt: new Date('2026-11-12T08:00:00') }),
  post('e', { accountId: 'ig', publishedAt: new Date('2026-11-20T18:00:00') }),                                 // Friday 18h
  post('f', { accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-16T10:30:00') }),             // Monday 10h
  post('g', { accountId: 'yt', publishedAt: new Date('2026-10-02T10:00:00') }),                                 // outside November
];
const METRICS = [metric('a', { impressions: 1200, reach: 900, clicks: 40, reactions: 55, comments: 4, shares: 2 }), metric('f', { impressions: 300, clicks: 5, reactions: 9 }), metric('e')];

const rows = () => postRows(CONTENT, ACCOUNTS, CAMPAIGNS);

describe('the calendar', () => {
  it('lays a month out in whole weeks that start on Monday', () => {
    const grid = monthGrid(2026, 10);   // November 2026 starts on a Sunday
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(dayKey(grid[0][0])).toBe('2026-10-26');
    expect(dayKey(grid[0][6])).toBe('2026-11-01');
    expect(dayKey(grid[grid.length - 1][6])).toBe('2026-12-06');
    expect(grid).toHaveLength(6);
    // A month that fits in fewer weeks takes fewer rows.
    expect(monthGrid(2027, 1)).toHaveLength(4);   // February 2027: Monday the 1st to Sunday the 28th
  });

  it('gives the seven days of the week a day is in', () => {
    const week = weekDays(new Date('2026-11-25T12:00:00'));
    expect(week.map(dayKey)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  });

  it('names the month and the week', () => {
    expect(monthTitle(2026, 10)).toBe('November 2026');
    expect(weekTitle(new Date('2026-11-25T12:00:00'))).toBe('23 – 29 November 2026');
    expect(weekTitle(new Date('2026-12-01T12:00:00'))).toBe('30 November – 6 December 2026');
  });

  it('puts each post on its day, earliest first, and leaves out what has no date yet', () => {
    const days = rowsByDay(rows());
    expect(days.get('2026-11-20')?.map((r) => r.post.id)).toEqual(['b', 'a', 'e']);
    expect(days.get('2026-11-25')?.map((r) => r.post.id)).toEqual(['c']);
    // A draft has no day: it was only made, not planned.
    expect([...days.values()].flat().some((r) => r.post.id === 'd')).toBe(false);
    expect(undated(rows()).map((r) => r.post.id)).toEqual(['d']);
  });
});

describe('the campaigns table', () => {
  it('counts each campaign\'s posts by how they went, with its results and the platforms it posts to', () => {
    const list = campaignRows(CAMPAIGNS, CONTENT, METRICS, ACCOUNTS);
    expect(list[0]).toMatchObject({
      platforms: ['YouTube', 'TikTok'], posts: 3, posted: 2, failed: 1, waiting: 0, impressions: 1500, clicks: 45, reactions: 64,
    });
    expect(list[0].lastPosted).toEqual(new Date('2026-11-20T10:05:00'));
    expect(list[1]).toMatchObject({ platforms: ['Instagram'], posts: 1, posted: 0, failed: 0, waiting: 1, impressions: 0, lastPosted: null });
    // A campaign is about social media only: nothing of a project or a CRM record is on its row.
    expect(Object.keys(list[0])).not.toContain('projectName');
  });
});

describe('the figures for a span of days', () => {
  const november = spanOf('2026-11-01T00:00', '2026-11-30T23:59');

  it('counts what was posted, what was not, and what waits', () => {
    const out = insights(rows(), METRICS, november);
    expect(out.posted).toBe(3);
    expect(out.failed).toBe(1);
    expect(out.waiting).toBe(1);
    // Three out of four tries worked.
    expect(out.successRate).toBe(75);
    // A post outside the span is not counted.
    expect(insights(rows(), METRICS, spanOf('2026-10-01T00:00', '2026-10-31T23:59')).posted).toBe(1);
  });

  it('has no success rate when nothing was tried', () => {
    expect(insights([], [], november).successRate).toBeNull();
  });

  it('splits by platform, the busiest first', () => {
    const out = insights(rows(), METRICS, november);
    expect(out.byPlatform.map((p) => [p.name, p.posted, p.failed, p.waiting])).toEqual([
      ['YouTube', 2, 0, 0], ['Instagram', 1, 0, 1], ['TikTok', 0, 1, 0],
    ]);
  });

  it('has a bar for every day of the span, also the days with nothing', () => {
    const out = insights(rows(), METRICS, spanOf('2026-11-16T00:00', '2026-11-20T23:59'));
    expect(out.byDay.map((d) => [d.key, d.posted, d.failed])).toEqual([
      ['2026-11-16', 1, 0], ['2026-11-17', 0, 0], ['2026-11-18', 0, 0], ['2026-11-19', 0, 0], ['2026-11-20', 2, 1],
    ]);
  });

  it('groups a long span by week, so the bars stay readable', () => {
    const out = insights(rows(), METRICS, spanOf('2026-09-01T00:00', '2026-11-30T23:59'));
    expect(out.byDay.length).toBeLessThanOrEqual(14);
    expect(out.byDay.reduce((sum, d) => sum + d.posted, 0)).toBe(4);
    expect(out.grouped).toBe('week');
  });

  it('says which days of the week and which hours posts went out', () => {
    const out = insights(rows(), METRICS, november);
    expect(out.byWeekday.map((d) => [d.label, d.posted])).toEqual([['Mon', 1], ['Tue', 0], ['Wed', 0], ['Thu', 0], ['Fri', 2], ['Sat', 0], ['Sun', 0]]);
    expect(out.byHour.find((h) => h.hour === 10)?.posted).toBe(2);
    expect(out.byHour.find((h) => h.hour === 18)?.posted).toBe(1);
    expect(out.byHour).toHaveLength(24);
  });

  it('adds up the results the platforms reported, and says when there are none', () => {
    const out = insights(rows(), METRICS, november);
    expect(out.results).toEqual({ impressions: 1500, reach: 900, clicks: 45, reactions: 64, comments: 4, shares: 2, any: true });
    expect(out.top.map((t) => [t.row.post.id, t.impressions])).toEqual([['a', 1200], ['f', 300]]);
    const none = insights(rows(), [], november);
    expect(none.results.any).toBe(false);
    expect(none.top).toEqual([]);
  });

  it('reads the two boxes as a span, whichever way round, and falls back to the last 30 days', () => {
    const now = new Date('2026-11-23T15:30:00');
    expect(spanOf('2026-11-30T23:59', '2026-11-01T00:00')).toEqual(spanOf('2026-11-01T00:00', '2026-11-30T23:59'));
    const fallback = spanOf('', '', now);
    expect(dayKey(fallback.from)).toBe('2026-10-25');
    expect(dayKey(fallback.to)).toBe('2026-11-23');
  });
});
