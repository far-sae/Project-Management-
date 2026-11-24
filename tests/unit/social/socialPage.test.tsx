// The Social page: the posts of one press are shown together, with how each
// platform went, and a failed one can be tried again.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SocialAccount, SocialContent } from '@/types/social';

const h = vi.hoisted(() => ({
  data: { accounts: [] as unknown[], campaigns: [] as unknown[], content: [] as unknown[], metrics: [] as unknown[] },
  listSocialData: vi.fn(),
  updateSocialContentStatus: vi.fn(async () => {}),
  runSocialPublish: vi.fn(async () => {}),
  deleteSocialContent: vi.fn(async () => {}),
  setSocialContentCampaign: vi.fn(async () => {}),
  createSocialCampaign: vi.fn(async () => {}),
  syncSocialAccounts: vi.fn(async () => 1),
  foundSocialAccounts: vi.fn(async (): Promise<Array<{ serviceId: string; provider: string; name: string; added: boolean }>> => []),
  chooseSocialAccounts: vi.fn(async (_org: string, _ws: string, add: string[]) => add.length),
  disconnectSocialAccount: vi.fn(async () => undefined),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/social/connect', () => ({
  socialConnectSetup: async () => ({ ready: { youtube: true, meta: true, x: true, tiktok: true, linkedin: true }, callback: null }),
  startSocialConnect: vi.fn(),
  syncSocialAccounts: h.syncSocialAccounts,
  foundSocialAccounts: h.foundSocialAccounts,
  chooseSocialAccounts: h.chooseSocialAccounts,
  disconnectSocialAccount: h.disconnectSocialAccount,
  CONNECT_FAILED_MESSAGE: 'The account could not be connected. Please try again.',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'org-1' }, isAdmin: true }) }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({
  useSelectedWorkspace: () => ({ selected: { workspaceId: 'ws-1', name: 'Northwind Studio' }, isAll: false, isUnassigned: false, select: vi.fn(), workspaces: [{ workspaceId: 'ws-1' }], loading: false }),
}));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: [{ projectId: 'p1', workspaceId: 'ws-1', name: 'Website' }], loading: false }) }));
vi.mock('@/hooks/useAllTasks', () => ({ useAllTasks: () => ({ tasks: [] }) }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ listContacts: async () => [] }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ listCompanies: async () => [] }));
vi.mock('@/services/supabase/social', () => ({
  listSocialData: h.listSocialData,
  updateSocialContentStatus: h.updateSocialContentStatus,
  runSocialPublish: h.runSocialPublish,
  deleteSocialContent: h.deleteSocialContent,
  setSocialContentCampaign: h.setSocialContentCampaign,
  createSocialCampaign: h.createSocialCampaign,
  createSocialAccount: vi.fn(), createSocialContent: vi.fn(), saveSocialAccountToken: vi.fn(), updateSocialCampaignStatus: vi.fn(),
  uploadSocialMedia: vi.fn(), removeSocialMedia: vi.fn(), createSocialPosts: vi.fn(),
}));

import { SocialMedia } from '@/pages/SocialMedia';

const account = (id: string, provider: SocialAccount['provider'], displayName: string, over: Partial<SocialAccount> = {}): SocialAccount => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', provider, displayName, externalAccountId: 'ext', status: 'connected', lastError: null, createdAt: new Date('2026-11-01'), ...over,
});
const post = (id: string, accountId: string, status: SocialContent['status'], over: Partial<SocialContent> = {}): SocialContent => ({
  id, organizationId: 'org-1', workspaceId: 'ws-1', campaignId: null, accountId, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null,
  title: 'Five tips for a brighter smile', body: 'Our dentist explains what works.', status, scheduledAt: new Date('2026-11-20T10:00:00Z'), publishedAt: null,
  lastError: null, createdAt: new Date('2026-11-20T10:00:00Z'), postGroupId: 'g1',
  media: { url: 'https://abc.supabase.co/storage/v1/object/public/social-media/ws-1/clip.mp4', kind: 'video', mime: 'video/mp4', bytes: 1, name: 'clip.mp4' }, options: {}, ...over,
});

const show = async () => {
  render(<SocialMedia />);
  await screen.findByRole('heading', { name: 'Posts' });
};

beforeEach(() => {
  h.listSocialData.mockReset().mockImplementation(async () => h.data);
  h.updateSocialContentStatus.mockClear();
  h.runSocialPublish.mockClear();
  h.toast.error.mockReset();
  h.data = {
    accounts: [account('yt', 'youtube', 'Northwind channel'), account('tt', 'tiktok', '@northwind'), account('ig', 'instagram', '@northwind.studio')],
    campaigns: [], metrics: [],
    content: [
      post('1', 'yt', 'published'),
      post('2', 'tt', 'failed', { lastError: 'TikTok did not accept the post: Daily post cap reached' }),
      post('3', 'ig', 'published'),
    ],
  };
});
afterEach(cleanup);

describe('the posts of one press', () => {
  // The cards are the second way to see the posts; the table is the first.
  beforeEach(() => window.localStorage.setItem('social.postsView', 'cards'));
  afterEach(() => window.localStorage.removeItem('social.postsView'));

  it('are one card, with a line for each platform and how it went', async () => {
    await show();
    expect(screen.getAllByText('Five tips for a brighter smile')).toHaveLength(1);
    expect(screen.getByText('Posted to 2 of 3')).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'YouTube: Posted' }).textContent).toContain('Northwind channel');
    expect(screen.getByRole('listitem', { name: 'Instagram: Posted' })).toBeTruthy();
    const failed = screen.getByRole('listitem', { name: 'TikTok: Not posted' });
    expect(failed.textContent).toContain('TikTok did not accept the post: Daily post cap reached');
  });

  it('can be tried again for the platform that failed, straight away', async () => {
    await show();
    fireEvent.click(within(screen.getByRole('listitem', { name: 'TikTok: Not posted' })).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(h.updateSocialContentStatus).toHaveBeenCalledTimes(1));
    const [id, status, by, when] = h.updateSocialContentStatus.mock.calls[0] as unknown as [string, string, string, Date];
    expect([id, status, by]).toEqual(['2', 'scheduled', 'u1']);
    expect(Math.abs(when.getTime() - Date.now())).toBeLessThan(5000);
    await waitFor(() => expect(h.runSocialPublish).toHaveBeenCalledTimes(1));
    // The platforms that already have the post are not sent it again.
    expect(screen.getByRole('listitem', { name: 'YouTube: Posted' }).querySelector('button')).toBeNull();
  });

  it('never shows a technical reason as it came', async () => {
    h.data = { ...h.data, content: [post('2', 'tt', 'failed', { lastError: 'relation "social_account_secrets" does not exist' })] };
    await show();
    const failed = screen.getByRole('listitem', { name: 'TikTok: Not posted' });
    expect(failed.textContent).not.toMatch(/relation|social_account_secrets/);
    expect(failed.textContent).toContain('The post was not accepted. Try again.');
  });

  it('keeps looking while a post is on its way, so the result shows up by itself', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      h.data = { ...h.data, content: [post('1', 'yt', 'publishing')] };
      render(<SocialMedia />);
      await vi.waitFor(() => expect(h.listSocialData).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(screen.getByText('Posting now', { selector: 'span.shrink-0' })).toBeTruthy());
      h.data = { ...h.data, content: [post('1', 'yt', 'published')] };
      await vi.advanceTimersByTimeAsync(5100);
      await vi.waitFor(() => expect(h.listSocialData).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(screen.getByRole('listitem', { name: 'YouTube: Posted' })).toBeTruthy());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('starting a post', () => {
  it('opens the composer from "New post", with the connected accounts ready', async () => {
    await show();
    fireEvent.click(screen.getAllByRole('button', { name: 'New post' })[0]);
    const dialog = within(await screen.findByRole('dialog', { name: 'New post' }));
    expect(dialog.getByText('1. Your picture or video')).toBeTruthy();
    expect((dialog.getByRole('checkbox', { name: /^Post to YouTube / }) as HTMLInputElement).checked).toBe(true);
  });

  it('says when an account has to be connected again', async () => {
    h.data = { ...h.data, accounts: [account('yt', 'youtube', 'Northwind channel', { status: 'error', lastError: 'YouTube did not accept the connection. Connect the YouTube account again.' })], content: [] };
    await show();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Accounts/ }), { button: 0 });
    expect(await screen.findByText('Connect again')).toBeTruthy();
    expect(screen.getByText('YouTube did not accept the connection. Connect the YouTube account again.')).toBeTruthy();
  });
});

describe('back from logging in at a platform', () => {
  afterEach(() => { window.history.replaceState(null, '', '/'); });

  it('says the account is connected, shows the accounts, and clears the note from the address', async () => {
    window.history.replaceState(null, '', '/social?connect=done&p=youtube&n=1');
    h.toast.success.mockClear();
    render(<SocialMedia />);
    await screen.findByRole('heading', { name: 'Connected accounts' });
    expect(h.toast.success).toHaveBeenCalledWith('YouTube is connected.');
    expect(screen.getByText('Northwind channel')).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/social');
  });

  it('says plainly when nothing was connected', async () => {
    window.history.replaceState(null, '', '/social?connect=cancelled&p=x');
    render(<SocialMedia />);
    await screen.findByRole('heading', { name: 'Connected accounts' });
    expect(h.toast.error).toHaveBeenCalledWith('Nothing was connected: the log-in was cancelled.');
  });

  it('says nothing on an ordinary visit', async () => {
    h.toast.success.mockClear();
    await show();
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(h.toast.error).not.toHaveBeenCalled();
  });
});

describe('back from the posting service', () => {
  const found = (serviceId: string, name: string, added = false, provider = 'facebook') => ({ serviceId, provider, name, added });
  afterEach(() => { window.history.replaceState(null, '', '/'); });
  beforeEach(() => {
    h.foundSocialAccounts.mockReset().mockResolvedValue([]);
    h.chooseSocialAccounts.mockReset().mockImplementation(async (_org: string, _ws: string, add: string[]) => add.length);
    h.toast.success.mockClear();
    h.toast.error.mockClear();
  });

  it('adds the one account the log-in brought, says so, and clears the note from the address', async () => {
    h.foundSocialAccounts.mockResolvedValue([found('spc_1', 'Northwind channel', false, 'youtube')]);
    window.history.replaceState(null, '', '/social?provider=youtube&projectId=proj_1&isSuccess=true&accountIds=spc_1');
    render(<SocialMedia />);
    await screen.findByRole('heading', { name: 'Connected accounts' });
    await waitFor(() => expect(h.foundSocialAccounts).toHaveBeenCalledWith('org-1', 'ws-1', ['spc_1']));
    await waitFor(() => expect(h.chooseSocialAccounts).toHaveBeenCalledWith('org-1', 'ws-1', ['spc_1'], []));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('The account is connected.'));
    // The list was read again after the account was brought in.
    await waitFor(() => expect(h.listSocialData.mock.calls.length).toBeGreaterThan(1));
    expect(window.location.search).toBe('');
    expect(h.foundSocialAccounts).toHaveBeenCalledTimes(1);
  });

  it('asks which ones to add when the log-in brought several, and adds nothing by itself', async () => {
    h.foundSocialAccounts.mockResolvedValue([found('spc_a', 'Harbour Dental', true), found('spc_b', 'Northwind Studio'), found('spc_c', 'Fieldway Logistics')]);
    window.history.replaceState(null, '', '/social?provider=facebook&isSuccess=true&accountIds=spc_a,spc_b,spc_c');
    render(<SocialMedia />);
    const dialog = await screen.findByRole('dialog', { name: 'Which accounts do you want to add?' });
    expect(h.chooseSocialAccounts).not.toHaveBeenCalled();
    // The one that is in the list already is not asked about again.
    expect(within(dialog).queryByText('Harbour Dental')).toBeNull();
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Northwind Studio/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 account' }));
    // The one that was not ticked is let go.
    await waitFor(() => expect(h.chooseSocialAccounts).toHaveBeenCalledWith('org-1', 'ws-1', ['spc_b'], ['spc_c']));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('The account is connected.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can add none of them', async () => {
    h.foundSocialAccounts.mockResolvedValue([found('spc_b', 'Northwind Studio'), found('spc_c', 'Fieldway Logistics')]);
    window.history.replaceState(null, '', '/social?provider=facebook&isSuccess=true');
    render(<SocialMedia />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add none' }));
    await waitFor(() => expect(h.chooseSocialAccounts).toHaveBeenCalledWith('org-1', 'ws-1', [], ['spc_b', 'spc_c']));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Nothing was added.'));
  });

  it('says plainly when the log-in was cancelled or failed, never the service\'s own words', async () => {
    window.history.replaceState(null, '', '/social?provider=tiktok&isSuccess=false&error=' + encodeURIComponent('OAuth state mismatch {"code":401}'));
    render(<SocialMedia />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Nothing was connected. Press Connect to try again.'));
    expect(JSON.stringify(h.toast.error.mock.calls)).not.toContain('OAuth');
    expect(h.chooseSocialAccounts).not.toHaveBeenCalled();
  });
});

describe('disconnecting an account', () => {
  beforeEach(() => { h.disconnectSocialAccount.mockReset().mockResolvedValue(undefined); h.toast.success.mockClear(); h.toast.error.mockClear(); });
  const openAccounts = async () => {
    await show();
    const tab = screen.getByRole('tab', { name: /Accounts/ });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    return screen.findByRole('list', { name: 'Connected accounts' });
  };

  it('asks first, says what happens to posts that are waiting, then takes it out of the list', async () => {
    const list = await openAccounts();
    const first = within(list).getAllByRole('button', { name: /^Disconnect / })[0];
    const name = (first.getAttribute('aria-label') ?? '').replace('Disconnect ', '');
    fireEvent.click(first);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(`Disconnect ${name}?`);
    expect(dialog.textContent).toContain('Posts that are waiting to go out to this account will not be sent.');
    expect(h.disconnectSocialAccount).not.toHaveBeenCalled();
    const before = h.listSocialData.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(h.disconnectSocialAccount).toHaveBeenCalledTimes(1));
    expect((h.disconnectSocialAccount.mock.calls[0] as unknown as string[]).slice(0, 2)).toEqual(['org-1', 'ws-1']);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(`${name} is disconnected.`));
    await waitFor(() => expect(h.listSocialData.mock.calls.length).toBeGreaterThan(before));
  });

  it('keeps the account and says so in plain words when it could not be disconnected', async () => {
    h.disconnectSocialAccount.mockRejectedValue(new Error('The account could not be disconnected. Please try again.'));
    const list = await openAccounts();
    fireEvent.click(within(list).getAllByRole('button', { name: /^Disconnect / })[0]);
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The account could not be disconnected. Please try again.'));
  });
});

describe('the posts as a table', () => {
  beforeEach(() => { window.localStorage.removeItem('social.postsView'); h.deleteSocialContent.mockClear(); h.toast.success.mockClear(); });

  it('is what the Posts tab opens with: a row for each platform', async () => {
    await show();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('row', { name: 'Five tips for a brighter smile, TikTok' }).textContent).toContain('Daily post cap reached');
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('tries a failed post again from its row, straight away', async () => {
    await show();
    fireEvent.click(within(screen.getByRole('row', { name: 'Five tips for a brighter smile, TikTok' })).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(h.updateSocialContentStatus).toHaveBeenCalledTimes(1));
    expect((h.updateSocialContentStatus.mock.calls[0] as unknown as [string, string])[1]).toBe('scheduled');
    await waitFor(() => expect(h.runSocialPublish).toHaveBeenCalledTimes(1));
  });

  it('deletes a post after asking, then reads the list again', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Five tips for a brighter smile (TikTok)' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.deleteSocialContent).toHaveBeenCalledWith(['2']));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Post deleted'));
    await waitFor(() => expect(h.listSocialData.mock.calls.length).toBeGreaterThan(1));
  });

  it('switches to one card for each press and remembers the choice', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'By post' }));
    expect(screen.getByText('Posted to 2 of 3')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(window.localStorage.getItem('social.postsView')).toBe('cards');
    window.localStorage.removeItem('social.postsView');
  });
});

describe('the other tabs', () => {
  const open = (name: string) => {
    const tab = screen.getByRole('tab', { name });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  };
  beforeEach(() => {
    window.localStorage.removeItem('social.postsView');
    h.data = {
      ...h.data,
      campaigns: [{ id: 'c1', organizationId: 'org-1', workspaceId: 'ws-1', name: 'Winter offer', objective: null, crmContactId: null, crmCompanyId: null, projectId: 'p1', taskId: null, status: 'active', createdAt: new Date('2026-11-01') }],
      content: [post('1', 'yt', 'published', { campaignId: 'c1' }), post('2', 'tt', 'failed'), post('3', 'ig', 'published')],
    };
  });

  it('Calendar shows a month with the posts on their days', async () => {
    await show();
    open('Calendar');
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Month or week' })).toBeTruthy();
  });

  it('Campaigns is a table, and "See posts" opens the posts table on that campaign', async () => {
    await show();
    open('Campaigns');
    const row = await screen.findByRole('row', { name: 'Winter offer' });
    expect(within(row).getAllByRole('cell')[2].textContent).toBe('YouTube');
    fireEvent.click(within(row).getByRole('button', { name: 'See posts' }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect((screen.getByLabelText('Campaign') as HTMLSelectElement).value).toBe('c1');
  });

  it('Analytics shows the figures for the last 30 days', async () => {
    await show();
    open('Analytics');
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeTruthy();
    expect((screen.getByLabelText('When') as HTMLSelectElement).value).toBe('last30');
  });
});

describe('social media only', () => {
  const open = (name: string) => {
    const tab = screen.getByRole('tab', { name });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  };
  beforeEach(() => { window.localStorage.removeItem('social.postsView'); h.createSocialCampaign.mockClear(); h.setSocialContentCampaign.mockClear(); });

  it('a new campaign asks for a name and what it is for, and nothing about projects or the CRM', async () => {
    await show();
    open('Campaigns');
    fireEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New social media campaign')).toBeTruthy();
    expect(within(dialog).queryByText(/project|CRM|contact|company|task/i)).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText('Winter offer'), { target: { value: 'Winter offer' } });
    fireEvent.change(within(dialog).getByPlaceholderText('More bookings in December'), { target: { value: 'More bookings' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.createSocialCampaign).toHaveBeenCalledWith({ organizationId: 'org-1', workspaceId: 'ws-1', name: 'Winter offer', objective: 'More bookings', userId: 'u1' }));
  });

  it('puts picked posts in a campaign from the posts table', async () => {
    h.data = { ...h.data, campaigns: [{ id: 'c1', organizationId: 'org-1', workspaceId: 'ws-1', name: 'Winter offer', objective: null, crmContactId: null, crmCompanyId: null, projectId: null, taskId: null, status: 'active', createdAt: new Date('2026-11-01') }] };
    await show();
    fireEvent.click(screen.getByLabelText('Select Five tips for a brighter smile (TikTok)'));
    fireEvent.change(screen.getByLabelText('Put the selected posts in a campaign'), { target: { value: 'c1' } });
    await waitFor(() => expect(h.setSocialContentCampaign).toHaveBeenCalledWith(['2'], 'c1'));
  });
});
