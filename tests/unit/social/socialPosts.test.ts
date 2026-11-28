// The posts table of the Social page: one row for each platform a post went
// to, with tabs by state, filters (also by date and time), sorting, pages and
// an export.
import { describe, expect, it } from 'vitest';
import type { SocialAccount, SocialContent } from '@/types/social';
import {
  NO_FILTERS, PAGE_SIZE, POST_TABS, activeFilters, filterRows, pageOf, postRows, quickRange, rowsCsv, sortRows, tabCounts, tabOf, toLocalInput,
  type PostFilters,
} from '@/lib/socialPosts';

const account = (id: string, provider: SocialAccount['provider'], displayName: string): SocialAccount => ({
  id, organizationId: 'org', workspaceId: 'ws', provider, displayName, externalAccountId: 'ext', status: 'connected', lastError: null, createdAt: new Date('2026-11-01'),
});
const post = (id: string, over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: 'org', workspaceId: 'ws', campaignId: null, accountId: 'yt', crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: `Post ${id}`, body: '', status: 'published', scheduledAt: null, publishedAt: null, lastError: null, createdAt: new Date('2026-11-10T09:00:00'),
  postGroupId: null, media: null, options: {}, externalPostId: null, ...over,
});

const ACCOUNTS = [account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio')];

const CONTENT: SocialContent[] = [
  post('a', { title: 'Five tips for a brighter smile', body: 'Our dentist explains.', status: 'published', accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-20T10:05:00'), scheduledAt: new Date('2026-11-20T10:00:00'), externalPostId: 'https://youtu.be/abc' }),
  post('b', { title: 'Five tips for a brighter smile', status: 'failed', accountId: 'tt', scheduledAt: new Date('2026-11-20T10:00:00'), lastError: 'TikTok did not accept the post: Video is too long.' }),
  post('c', { title: 'Open day', status: 'scheduled', accountId: 'ig', scheduledAt: new Date('2026-11-25T18:30:00') }),
  post('d', { title: 'Team photo', status: 'draft', accountId: null, createdAt: new Date('2026-11-12T08:00:00') }),
  post('e', { title: 'Price list', status: 'in_review', accountId: 'ig', scheduledAt: new Date('2026-11-27T09:00:00') }),
  post('f', { title: 'New clinic', status: 'publishing', accountId: 'yt', scheduledAt: new Date('2026-11-21T12:00:00'), externalPostId: 'pfm:sp_1:1700000000000' }),
];

const rows = () => postRows(CONTENT, ACCOUNTS);
const ids = (list: ReturnType<typeof rows>) => list.map((r) => r.post.id);
const filters = (over: Partial<PostFilters> = {}): PostFilters => ({ ...NO_FILTERS, ...over });

describe('a row of the posts table', () => {
  it('names the platform and the account, and nothing about a campaign', () => {
    const a = rows().find((r) => r.post.id === 'a')!;
    expect(a).toMatchObject({ platformName: 'YouTube', accountName: 'Northwind channel' });
    expect(Object.keys(a)).not.toContain('campaignName');
    const d = rows().find((r) => r.post.id === 'd')!;
    expect(d).toMatchObject({ platformName: 'No account', accountName: '' });
    // An account that was removed since.
    expect(postRows([post('z', { accountId: 'gone' })], ACCOUNTS)[0].platformName).toBe('Account removed');
  });

  it('has one date and time: when it was posted, when it is planned, or when it was made', () => {
    const by = Object.fromEntries(rows().map((r) => [r.post.id, r]));
    expect(by.a.when).toEqual(new Date('2026-11-20T10:05:00'));
    expect(by.a.whenLabel).toBe('Posted');
    expect(by.c.when).toEqual(new Date('2026-11-25T18:30:00'));
    expect(by.c.whenLabel).toBe('Planned');
    expect(by.b.whenLabel).toBe('Planned');
    expect(by.d.when).toEqual(new Date('2026-11-12T08:00:00'));
    expect(by.d.whenLabel).toBe('Made');
  });

  it('links to the published post only when there is a real address', () => {
    const by = Object.fromEntries(rows().map((r) => [r.post.id, r]));
    expect(by.a.link).toBe('https://youtu.be/abc');
    // A post still on its way carries a note of ours, not an address.
    expect(by.f.link).toBeNull();
    expect(postRows([post('x', { status: 'published', externalPostId: 'javascript:alert(1)' })], ACCOUNTS)[0].link).toBeNull();
    expect(postRows([post('y', { status: 'published', externalPostId: 'tweet-123' })], ACCOUNTS)[0].link).toBeNull();
  });
});

describe('the tabs', () => {
  it('put every state under one tab', () => {
    expect(tabOf('draft')).toBe('drafts');
    expect(tabOf('in_review')).toBe('approval');
    expect(tabOf('approved')).toBe('approval');
    expect(tabOf('scheduled')).toBe('scheduled');
    expect(tabOf('publishing')).toBe('scheduled');
    expect(tabOf('published')).toBe('posted');
    expect(tabOf('failed')).toBe('failed');
    expect(POST_TABS.map((t) => t.id)).toEqual(['all', 'scheduled', 'posted', 'failed', 'approval', 'drafts']);
  });

  it('count what each tab would show with the other filters as they are', () => {
    expect(tabCounts(rows(), NO_FILTERS)).toEqual({ all: 6, scheduled: 2, posted: 1, failed: 1, approval: 1, drafts: 1 });
    // The tab that is open does not change the counts of the others.
    expect(tabCounts(rows(), filters({ tab: 'failed' })).posted).toBe(1);
    expect(tabCounts(rows(), filters({ platform: 'youtube' }))).toEqual({ all: 2, scheduled: 1, posted: 1, failed: 0, approval: 0, drafts: 0 });
  });
});

describe('filters', () => {
  it('show one tab', () => {
    expect(ids(filterRows(rows(), filters({ tab: 'scheduled' }))).sort()).toEqual(['c', 'f']);
    expect(ids(filterRows(rows(), filters({ tab: 'all' })))).toHaveLength(6);
  });

  it('find a word in the title, the text or the account, whatever the capitals', () => {
    expect(ids(filterRows(rows(), filters({ search: 'BRIGHTER' }))).sort()).toEqual(['a', 'b']);
    expect(ids(filterRows(rows(), filters({ search: 'dentist' })))).toEqual(['a']);
    expect(ids(filterRows(rows(), filters({ search: 'northwind.studio' }))).sort()).toEqual(['c', 'e']);
    expect(ids(filterRows(rows(), filters({ search: '   ' })))).toHaveLength(6);
  });

  it('narrow to a platform or an account', () => {
    expect(ids(filterRows(rows(), filters({ platform: 'instagram' }))).sort()).toEqual(['c', 'e']);
    expect(ids(filterRows(rows(), filters({ accountId: 'tt' })))).toEqual(['b']);
  });

  it('keep the posts between a date and time and another, both included', () => {
    expect(ids(filterRows(rows(), filters({ from: '2026-11-20T10:00', to: '2026-11-21T12:00' }))).sort()).toEqual(['a', 'b', 'f']);
    // The time of day counts, not only the day.
    expect(ids(filterRows(rows(), filters({ from: '2026-11-20T10:01' }))).sort()).toEqual(['a', 'c', 'e', 'f']);
    expect(ids(filterRows(rows(), filters({ to: '2026-11-12T08:00' })))).toEqual(['d']);
    // A date typed half-way, or the wrong way round, hides nothing by mistake.
    expect(ids(filterRows(rows(), filters({ from: 'not a date' })))).toHaveLength(6);
    expect(ids(filterRows(rows(), filters({ from: '2026-11-21T12:00', to: '2026-11-20T10:00' }))).sort()).toEqual(['a', 'b', 'f']);
  });

  it('work together', () => {
    expect(ids(filterRows(rows(), filters({ tab: 'failed', platform: 'tiktok', from: '2026-11-20T00:00', search: 'smile' })))).toEqual(['b']);
    expect(filterRows(rows(), filters({ tab: 'posted', platform: 'tiktok' }))).toEqual([]);
  });

  it('say how many are switched on, not counting the tab', () => {
    expect(activeFilters(NO_FILTERS)).toBe(0);
    expect(activeFilters(filters({ tab: 'failed' }))).toBe(0);
    expect(activeFilters(filters({ search: 'x', platform: 'youtube', from: '2026-11-01T00:00', to: '2026-11-02T00:00' }))).toBe(3);
  });
});

describe('quick date ranges', () => {
  const now = new Date('2026-11-23T15:30:00');
  it('give the from and to of a range, to the minute', () => {
    expect(quickRange('today', now)).toEqual({ from: '2026-11-23T00:00', to: '2026-11-23T23:59' });
    expect(quickRange('last7', now)).toEqual({ from: '2026-11-17T00:00', to: '2026-11-23T23:59' });
    expect(quickRange('last30', now)).toEqual({ from: '2026-10-25T00:00', to: '2026-11-23T23:59' });
    expect(quickRange('thisMonth', now)).toEqual({ from: '2026-11-01T00:00', to: '2026-11-30T23:59' });
    expect(quickRange('next7', now)).toEqual({ from: '2026-11-23T15:30', to: '2026-11-30T23:59' });
    expect(quickRange('any', now)).toEqual({ from: '', to: '' });
  });

  it('write a date the way the date-and-time box reads it', () => {
    expect(toLocalInput(new Date('2026-03-05T07:04:59'))).toBe('2026-03-05T07:04');
  });
});

describe('sorting and pages', () => {
  it('sorts by date and time, newest first to start with', () => {
    expect(ids(sortRows(rows(), { by: 'when', dir: 'desc' }))).toEqual(['e', 'c', 'f', 'a', 'b', 'd']);
    expect(ids(sortRows(rows(), { by: 'when', dir: 'asc' }))[0]).toBe('d');
  });

  it('sorts by post, platform and state, keeping the newest first among equals', () => {
    expect(ids(sortRows(rows(), { by: 'title', dir: 'asc' })).slice(0, 2)).toEqual(['a', 'b']);
    expect(sortRows(rows(), { by: 'platform', dir: 'asc' }).map((r) => r.platformName)).toEqual(['Instagram', 'Instagram', 'No account', 'TikTok', 'YouTube', 'YouTube']);
    expect(sortRows(rows(), { by: 'status', dir: 'asc' }).map((r) => r.post.status)[0]).toBe('draft');
    // Sorting does not change the list it was given.
    const before = ids(rows());
    const list = rows();
    sortRows(list, { by: 'title', dir: 'desc' });
    expect(ids(list)).toEqual(before);
  });

  it('cuts the list into pages, and never shows a page that is not there', () => {
    const many = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => rows()[i % 6]);
    expect(pageOf(many, 1)).toMatchObject({ page: 1, pages: 3, from: 1, to: PAGE_SIZE, total: many.length });
    expect(pageOf(many, 3).rows).toHaveLength(3);
    expect(pageOf(many, 99).page).toBe(3);
    expect(pageOf(many, 0).page).toBe(1);
    expect(pageOf([], 1)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, total: 0, rows: [] });
  });
});

describe('the export', () => {
  it('has a heading row and one row for each post shown', () => {
    const csv = rowsCsv(sortRows(filterRows(rows(), filters({ search: 'smile' })), { by: 'when', dir: 'desc' }));
    const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('"Post","Text","Platform","Account","State","Date and time","Link","Problem"');
    expect(lines[1]).toContain('"Five tips for a brighter smile","Our dentist explains.","YouTube","Northwind channel","Posted","2026-11-20 10:05","https://youtu.be/abc",""');
    expect(lines[2]).toContain('"TikTok did not accept the post: Video is too long."');
  });

  it('cannot be made to run a formula in a spreadsheet', () => {
    const csv = rowsCsv(postRows([post('x', { title: '=HYPERLINK("http://evil","x")' })], ACCOUNTS));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});
