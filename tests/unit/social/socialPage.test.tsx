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
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'org-1' } }) }));
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
  createSocialAccount: vi.fn(), createSocialCampaign: vi.fn(), createSocialContent: vi.fn(), saveSocialAccountToken: vi.fn(), updateSocialCampaignStatus: vi.fn(),
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
    expect(await screen.findByText('connect again')).toBeTruthy();
    expect(screen.getByText('YouTube did not accept the connection. Connect the YouTube account again.')).toBeTruthy();
  });
});
