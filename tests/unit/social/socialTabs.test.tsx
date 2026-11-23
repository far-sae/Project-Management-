// The Calendar, Campaigns and Analytics tabs of the Social page, as a person
// uses them.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SocialAccount, SocialCampaign, SocialContent, SocialMetric } from '@/types/social';
import { SocialCalendar } from '@/components/social/SocialCalendar';
import { CampaignsTable } from '@/components/social/CampaignsTable';
import { SocialAnalytics } from '@/components/social/SocialAnalytics';

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

const NOW = new Date('2026-11-23T15:30:00');
const ACCOUNTS = [account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio')];
const CAMPAIGNS = [campaign('c1', 'Winter offer', { projectId: 'p1', objective: 'More bookings in December' }), campaign('c2', 'Open day', { status: 'paused' }), campaign('c3', 'Spring plan', { status: 'draft' })];
const CONTENT: SocialContent[] = [
  post('a', { title: 'Five tips', accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-20T10:05:00') }),
  post('b', { title: 'Five tips', accountId: 'tt', campaignId: 'c1', status: 'failed', scheduledAt: new Date('2026-11-20T10:00:00') }),
  post('c', { title: 'Open day', accountId: 'ig', campaignId: 'c2', status: 'scheduled', scheduledAt: new Date('2026-11-25T18:30:00') }),
  post('d', { title: 'Team photo', accountId: null, status: 'draft', createdAt: new Date('2026-11-12T08:00:00') }),
  post('e', { title: 'Before and after', accountId: 'ig', publishedAt: new Date('2026-11-20T18:00:00') }),
  post('f', { title: 'Meet the team', accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-16T10:30:00') }),
  post('g', { title: 'December hours', accountId: 'yt', status: 'scheduled', scheduledAt: new Date('2026-12-03T09:00:00') }),
];
const METRICS: SocialMetric[] = [
  { contentId: 'a', impressions: 1200, reach: 900, clicks: 40, reactions: 55, comments: 4, shares: 2 },
  { contentId: 'f', impressions: 300, reach: 0, clicks: 5, reactions: 9, comments: 0, shares: 0 },
];

afterEach(cleanup);

describe('the calendar', () => {
  const fns = { onNewPost: vi.fn(), onSeeDrafts: vi.fn() };
  const show = () => render(<SocialCalendar content={CONTENT} accounts={ACCOUNTS} campaigns={CAMPAIGNS} now={() => NOW} {...fns} />);
  const day = (name: RegExp) => screen.getByRole('button', { name });
  beforeEach(() => { fns.onNewPost.mockClear(); fns.onSeeDrafts.mockClear(); });

  it('opens on this month, with each post on its day and today picked', () => {
    show();
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeTruthy();
    expect(day(/20 November: 3 posts/).textContent).toContain('YouTube: Five tips');
    expect(day(/25 November: 1 post$/).textContent).toContain('Instagram: Open day');
    expect(day(/19 November: no posts/)).toBeTruthy();
    expect(day(/23 November: no posts/).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Nothing on this day.')).toBeTruthy();
  });

  it('lists the posts of the day that is pressed, earliest first, with how each went', () => {
    show();
    fireEvent.click(day(/20 November: 3 posts/));
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('aria-label')?.replace(/^\S+ /, ''))).toEqual(['TikTok: Five tips', 'YouTube: Five tips', 'Instagram: Before and after']);
    expect(within(items[0]).getByText('Not posted')).toBeTruthy();
    expect(within(items[1]).getByText('Posted')).toBeTruthy();
  });

  it('moves a month at a time, and comes back to today', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'December 2026' })).toBeTruthy();
    expect(day(/3 December: 1 post$/).textContent).toContain('December hours');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeTruthy();
  });

  it('shows one week with every post of each day', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('heading', { name: '23 – 29 November 2026' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /November: / })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { name: '16 – 22 November 2026' })).toBeTruthy();
    expect(day(/20 November: 3 posts/).textContent).toContain('Instagram: Before and after');
  });

  it('can show one platform only', () => {
    show();
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'instagram' } });
    expect(day(/20 November: 1 post$/).textContent).not.toContain('YouTube');
  });

  it('says which posts are on no day yet, with a way to them', () => {
    show();
    expect(screen.getByText(/1 post has no date yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See it' }));
    expect(fns.onSeeDrafts).toHaveBeenCalled();
  });
});

describe('the campaigns table', () => {
  const fns = { onNew: vi.fn(), onSetStatus: vi.fn(), onSeePosts: vi.fn() };
  const show = (campaigns = CAMPAIGNS) =>
    render(<CampaignsTable campaigns={campaigns} content={CONTENT} metrics={METRICS} accounts={ACCOUNTS} {...fns} />);
  const row = (name: string) => screen.getByRole('row', { name });
  const cells = (name: string) => within(row(name)).getAllByRole('cell').map((c) => c.textContent);
  beforeEach(() => { for (const fn of Object.values(fns)) fn.mockClear(); });

  it('shows each campaign with its posts counted by how they went, and what they brought', () => {
    show();
    const c = cells('Winter offer');
    expect(c[0]).toContain('More bookings in December');
    expect(c.slice(1, 10)).toEqual(['Running', 'YouTube, TikTok', '3', '2', '1', '0', '1,500', '45', '64']);
    expect(cells('Open day').slice(1, 7)).toEqual(['Paused', 'Instagram', '1', '0', '0', '1']);
    // Social media only: no project column.
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Platforms' })).toBeTruthy();
  });

  it('starts, pauses and finishes a campaign', () => {
    show();
    fireEvent.click(within(row('Winter offer')).getByRole('button', { name: 'Pause' }));
    expect(fns.onSetStatus).toHaveBeenLastCalledWith(CAMPAIGNS[0], 'paused');
    fireEvent.click(within(row('Open day')).getByRole('button', { name: 'Go on' }));
    expect(fns.onSetStatus).toHaveBeenLastCalledWith(CAMPAIGNS[1], 'active');
    fireEvent.click(within(row('Spring plan')).getByRole('button', { name: 'Start' }));
    expect(fns.onSetStatus).toHaveBeenLastCalledWith(CAMPAIGNS[2], 'active');
    fireEvent.click(within(row('Winter offer')).getByRole('button', { name: 'Finish' }));
    expect(fns.onSetStatus).toHaveBeenLastCalledWith(CAMPAIGNS[0], 'finished');
    // A campaign that has not started cannot be finished.
    expect(within(row('Spring plan')).queryByRole('button', { name: 'Finish' })).toBeNull();
  });

  it('opens a campaign\'s posts, when it has any', () => {
    show();
    fireEvent.click(within(row('Winter offer')).getByRole('button', { name: 'See posts' }));
    expect(fns.onSeePosts).toHaveBeenCalledWith('c1');
    expect((within(row('Spring plan')).getByRole('button', { name: 'See posts' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('searches and filters by state', () => {
    show();
    fireEvent.change(screen.getByLabelText('Search campaigns'), { target: { value: 'bookings' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Search campaigns'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'paused' } });
    expect(screen.getByRole('row', { name: 'Open day' })).toBeTruthy();
    expect(screen.queryByRole('row', { name: 'Winter offer' })).toBeNull();
  });

  it('starts empty with what a campaign is for', () => {
    show([]);
    expect(screen.getByText(/A campaign groups the social media posts of one goal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New campaign' }));
    expect(fns.onNew).toHaveBeenCalled();
  });
});

describe('analytics', () => {
  const show = (metrics = METRICS) => render(<SocialAnalytics content={CONTENT} accounts={ACCOUNTS} campaigns={CAMPAIGNS} metrics={metrics} now={() => NOW} />);
  const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement?.querySelector('dd')?.textContent;

  it('opens on the last 30 days with the headline figures', () => {
    show();
    expect((screen.getByLabelText('When') as HTMLSelectElement).value).toBe('last30');
    expect(figure('Posted')).toBe('3');
    expect(figure('Not posted')).toBe('1');
    expect(figure('Posted, of those tried')).toBe('75%');
    // The two planned posts are after today, so outside the last 30 days.
    expect(figure('Waiting to go out')).toBe('0');
  });

  it('has a bar for each day, which says its count', () => {
    show();
    const bars = within(screen.getByRole('list', { name: 'Posts over time' })).getAllByRole('listitem');
    expect(bars).toHaveLength(30);
    expect(bars.map((b) => b.getAttribute('aria-label'))).toContain('20 Nov: 2 posted, 1 not posted');
    expect(bars.map((b) => b.getAttribute('aria-label'))).toContain('19 Nov: 0 posted');
  });

  it('splits the posts by platform', () => {
    show();
    const cells = (name: string) => within(screen.getByRole('row', { name })).getAllByRole('cell').slice(1).map((c) => c.textContent);
    expect(cells('YouTube')).toEqual(['2', '0', '0']);
    expect(cells('TikTok')).toEqual(['0', '1', '0']);
  });

  it('says on which day and at which hour most posts went out', () => {
    show();
    expect(screen.getByRole('heading', { name: /Days you post on\s*·\s*most on Fri/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Time of day\s*·\s*most at 10:00/ })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Time of day' })).getAllByRole('listitem')).toHaveLength(24);
  });

  it('shows what the posts brought, and the ones with the most views', () => {
    show();
    expect(figure('Views')).toBe('1,500');
    expect(figure('Reactions')).toBe('64');
    const top = within(screen.getByRole('list', { name: 'Posts with the most views' })).getAllByRole('listitem');
    expect(top[0].textContent).toContain('Five tips');
    expect(top[0].textContent).toContain('1,200 views');
  });

  it('says plainly when no platform has reported any results', () => {
    show([]);
    expect(screen.getByText('No views, clicks or reactions have been reported for these posts yet.')).toBeTruthy();
    expect(screen.queryByText('Views', { selector: 'dt' })).toBeNull();
  });

  it('follows the dates and the platform that are chosen', () => {
    show();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-25T00:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-05T23:59' } });
    expect(figure('Waiting to go out')).toBe('2');
    expect(figure('Posted, of those tried')).toBe('—');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'tiktok' } });
    expect(screen.getByText('No posts in these days. Choose other dates, or make a post.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'last7' } });
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-11-17T00:00');
  });
});
