// The posts table on the Social page, as a person uses it: tabs, search,
// filters by platform, account and date and time, sorting, pages, picking
// several posts, trying failed ones again, deleting, and the export.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SocialAccount, SocialCampaign, SocialContent } from '@/types/social';

const h = vi.hoisted(() => ({ saveTextFile: vi.fn() }));
vi.mock('@/lib/signroom/billingCsv', async (actual) => ({ ...(await actual<typeof import('@/lib/signroom/billingCsv')>()), saveTextFile: h.saveTextFile }));

import { PostsTable } from '@/components/social/PostsTable';
import { PAGE_SIZE } from '@/lib/socialPosts';

const account = (id: string, provider: SocialAccount['provider'], displayName: string): SocialAccount => ({
  id, organizationId: 'org', workspaceId: 'ws', provider, displayName, externalAccountId: 'ext', status: 'connected', lastError: null, createdAt: new Date('2026-11-01'),
});
const post = (id: string, over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: 'org', workspaceId: 'ws', campaignId: null, accountId: 'yt', crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: `Post ${id}`, body: '', status: 'published', scheduledAt: null, publishedAt: null, lastError: null, createdAt: new Date('2026-11-10T09:00:00'),
  postGroupId: null, media: null, options: {}, externalPostId: null, ...over,
});

const ACCOUNTS = [account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio')];
const CAMPAIGNS: SocialCampaign[] = [{ id: 'c1', organizationId: 'org', workspaceId: 'ws', name: 'Winter offer', objective: null, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null, status: 'active', createdAt: new Date('2026-11-01') }];
const CONTENT: SocialContent[] = [
  post('a', { title: 'Five tips for a brighter smile', body: 'Our dentist explains.', accountId: 'yt', campaignId: 'c1', publishedAt: new Date('2026-11-20T10:05:00'), externalPostId: 'https://youtu.be/abc' }),
  post('b', { title: 'Five tips for a brighter smile', status: 'failed', accountId: 'tt', scheduledAt: new Date('2026-11-20T10:00:00'), lastError: 'TikTok did not accept the post: Video is too long.' }),
  post('c', { title: 'Open day', status: 'scheduled', accountId: 'ig', scheduledAt: new Date('2026-11-25T18:30:00') }),
  post('d', { title: 'Team photo', status: 'draft', accountId: null, createdAt: new Date('2026-11-12T08:00:00') }),
  post('e', { title: 'Price list', status: 'in_review', accountId: 'ig', scheduledAt: new Date('2026-11-27T09:00:00') }),
  post('f', { title: 'New clinic', status: 'failed', accountId: 'yt', scheduledAt: new Date('2026-11-21T12:00:00'), lastError: 'relation "social_content" does not exist' }),
];

const NOW = new Date('2026-11-23T15:30:00');
const fns = { onNewPost: vi.fn(), onRetry: vi.fn(), onStatus: vi.fn(), onDelete: vi.fn(async () => {}) };
const show = (content: SocialContent[] = CONTENT) =>
  render(<PostsTable content={content} accounts={ACCOUNTS} campaigns={CAMPAIGNS} now={() => NOW} {...fns} />);

const titles = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => row.getAttribute('aria-label'));
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const rowOf = (label: string) => screen.getByRole('row', { name: label });

beforeEach(() => { for (const fn of Object.values(fns)) fn.mockClear(); h.saveTextFile.mockClear(); });
afterEach(cleanup);

describe('the posts table', () => {
  it('shows a row for each platform a post went to, newest first, with its state and its date and time', () => {
    show();
    expect(titles()).toEqual([
      'Price list, Instagram', 'Open day, Instagram', 'New clinic, YouTube', 'Five tips for a brighter smile, YouTube', 'Five tips for a brighter smile, TikTok', 'Team photo, No account',
    ]);
    const posted = rowOf('Five tips for a brighter smile, YouTube');
    expect(within(posted).getByText('Posted', { selector: '[data-tone]' })).toBeTruthy();
    expect(within(posted).getByText('Northwind channel')).toBeTruthy();
    expect(within(posted).getByText('Winter offer')).toBeTruthy();
    expect(posted.querySelector('time')?.getAttribute('datetime')).toBe(new Date('2026-11-20T10:05:00').toISOString());
    expect(within(posted).getByRole('link', { name: 'View post' }).getAttribute('href')).toBe('https://youtu.be/abc');
    expect(screen.getByText('1–6 of 6')).toBeTruthy();
  });

  it('says why a post was not posted, in plain words only', () => {
    show();
    expect(within(rowOf('Five tips for a brighter smile, TikTok')).getByText('TikTok did not accept the post: Video is too long.')).toBeTruthy();
    // The inside of a failure never reaches the screen.
    expect(screen.queryByText(/relation/)).toBeNull();
    expect(within(rowOf('New clinic, YouTube')).getByText('The post was not accepted. Try again.')).toBeTruthy();
  });

  it('has a tab for each state, with how many posts are in it', () => {
    show();
    expect(tab(/^All/).textContent).toBe('All6');
    expect(tab(/^Not posted/).textContent).toBe('Not posted2');
    fireEvent.click(tab(/^Not posted/));
    expect(titles()).toEqual(['New clinic, YouTube', 'Five tips for a brighter smile, TikTok']);
    expect(tab(/^Not posted/).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab(/^Drafts/));
    expect(titles()).toEqual(['Team photo, No account']);
  });

  it('searches as you type', () => {
    show();
    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: 'smile' } });
    expect(titles()).toEqual(['Five tips for a brighter smile, YouTube', 'Five tips for a brighter smile, TikTok']);
    // The tabs count what the search leaves.
    expect(tab(/^All/).textContent).toBe('All2');
  });

  it('filters by platform, account and campaign', () => {
    show();
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'instagram' } });
    expect(titles()).toEqual(['Price list, Instagram', 'Open day, Instagram']);
    // Only that platform's accounts are offered next.
    expect(within(screen.getByLabelText('Account')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All accounts', '@northwind.studio']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(screen.getByLabelText('Campaign'), { target: { value: 'c1' } });
    expect(titles()).toEqual(['Five tips for a brighter smile, YouTube']);
  });

  it('filters by date and time, from and to', () => {
    show();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-20T10:01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-25T18:30' } });
    expect(titles()).toEqual(['Open day, Instagram', 'New clinic, YouTube', 'Five tips for a brighter smile, YouTube']);
    expect((screen.getByLabelText('When') as HTMLSelectElement).value).toBe('custom');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toHaveLength(6);
  });

  it('has ready-made spans that fill the two boxes', () => {
    show();
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'last7' } });
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-11-17T00:00');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-11-23T23:59');
    expect(titles()).toEqual(['New clinic, YouTube', 'Five tips for a brighter smile, YouTube', 'Five tips for a brighter smile, TikTok']);
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'any' } });
    expect(titles()).toHaveLength(6);
  });

  it('says so when nothing matches, with a way back', () => {
    show();
    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No post matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all posts' }));
    expect(titles()).toHaveLength(6);
  });

  it('sorts by a column, and the other way on a second press', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by post' }));
    expect(titles()?.[0]).toBe('Five tips for a brighter smile, YouTube');
    expect(screen.getByRole('columnheader', { name: /Post/ }).getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by post' }));
    expect(titles()?.[0]).toBe('Team photo, No account');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by date and time' }));
    expect(titles()?.[0]).toBe('Price list, Instagram');
  });

  it('shows a page at a time', () => {
    const many = Array.from({ length: PAGE_SIZE + 4 }, (_, i) => post(`p${i}`, { title: `Post ${String(i).padStart(2, '0')}`, publishedAt: new Date(2026, 10, 1, 9, i) }));
    show(many);
    expect(titles()).toHaveLength(PAGE_SIZE);
    expect(screen.getByText(`1–${PAGE_SIZE} of ${PAGE_SIZE + 4}`)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(titles()).toHaveLength(4);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    // A new filter starts from the first page again.
    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: 'Post 0' } });
    expect(screen.getByText('1–10 of 10')).toBeTruthy();
  });

  it('starts empty with a way to make the first post', () => {
    show([]);
    expect(screen.getByText('No posts yet. Press New post to upload once and post everywhere.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    expect(fns.onNewPost).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('what can be done in a row', () => {
  it('tries a failed post again', () => {
    show();
    fireEvent.click(within(rowOf('Five tips for a brighter smile, TikTok')).getByRole('button', { name: 'Try again' }));
    expect(fns.onRetry).toHaveBeenCalledWith([CONTENT[1]]);
  });

  it('moves a post on: ask for approval, then approve', () => {
    show();
    fireEvent.click(within(rowOf('Team photo, No account')).getByRole('button', { name: 'Ask for approval' }));
    expect(fns.onStatus).toHaveBeenCalledWith(CONTENT[3], 'in_review');
    fireEvent.click(within(rowOf('Price list, Instagram')).getByRole('button', { name: 'Approve' }));
    // It has a time already, so approving puts it in the queue.
    expect(fns.onStatus).toHaveBeenLastCalledWith(CONTENT[4], 'scheduled');
  });

  it('deletes a post only after asking, and says a published post stays on its platform', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Open day (Instagram)' }));
    expect(fns.onDelete).not.toHaveBeenCalled();
    const ask = await screen.findByRole('alertdialog');
    expect(within(ask).getByText('Delete this post?')).toBeTruthy();
    expect(within(ask).getByText(/already on a platform stays there/)).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fns.onDelete).toHaveBeenCalledWith([CONTENT[2]]));
  });

  it('does not let a post be deleted while it is going out', () => {
    show([post('x', { title: 'Going out', status: 'publishing', scheduledAt: NOW })]);
    expect((screen.getByRole('button', { name: 'Delete Going out (YouTube)' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('several posts at once', () => {
  it('tries the failed ones among the picked posts again', () => {
    show();
    fireEvent.click(screen.getByLabelText('Select every post on this page'));
    expect(screen.getByRole('status').textContent).toContain('6 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Try 2 again' }));
    expect(fns.onRetry).toHaveBeenCalledWith([CONTENT[1], CONTENT[5]]);
  });

  it('deletes the picked posts after asking, and forgets what is gone', async () => {
    const view = show();
    fireEvent.click(screen.getByLabelText('Select Open day (Instagram)'));
    fireEvent.click(screen.getByLabelText('Select Team photo (No account)'));
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Delete' }));
    const ask = await screen.findByRole('alertdialog');
    expect(within(ask).getByText('Delete 2 posts?')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fns.onDelete).toHaveBeenCalledWith([CONTENT[2], CONTENT[3]]));
    view.rerender(<PostsTable content={CONTENT.filter((p) => !['c', 'd'].includes(p.id))} accounts={ACCOUNTS} campaigns={CAMPAIGNS} now={() => NOW} {...fns} />);
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
  });

  it('saves what is shown as a file for a spreadsheet', () => {
    show();
    fireEvent.click(tab(/^Not posted/));
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const [name, text] = h.saveTextFile.mock.calls[0] as [string, string];
    expect(name).toBe('social-posts-2026-11-23.csv');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"New clinic"');
    // The same plain words as on screen.
    expect(text).not.toContain('relation');
  });
});
