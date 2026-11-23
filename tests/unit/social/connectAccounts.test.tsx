// The Accounts tab of the Social page: a "Connect" button per platform. The
// person presses it, logs in at the platform, and comes back connected: no key
// is copied or pasted by hand.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setInternalsVisible } from '@/lib/publicError';
import type { ConnectSetup } from '../../../api/_social/shared/connect';

const h = vi.hoisted(() => ({
  socialConnectSetup: vi.fn(),
  startSocialConnect: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/social/connect', () => ({
  socialConnectSetup: h.socialConnectSetup,
  startSocialConnect: h.startSocialConnect,
  CONNECT_FAILED_MESSAGE: 'The account could not be connected. Please try again.',
}));

import { ConnectAccounts } from '@/components/social/ConnectAccounts';
import { connectReturnMessage, readConnectReturn } from '@/lib/socialConnect';

const CALLBACK = 'https://app.example.com/api/social/connect/callback';
const allReady: ConnectSetup = {
  ready: { youtube: true, meta: true, x: true, tiktok: true, linkedin: true },
  needs: { youtube: [], meta: [], x: [], tiktok: [], linkedin: [] },
  callback: CALLBACK,
};

const go = vi.fn();
const show = async (over: { canConnect?: boolean } = {}) => {
  render(<ConnectAccounts organizationId="org-1" workspaceId="ws-1" canConnect={over.canConnect ?? true} go={go} />);
  await waitFor(() => expect(h.socialConnectSetup).toHaveBeenCalled());
  await screen.findByRole('heading', { name: 'Connect an account' });
};
const row = (name: string) => screen.getByRole('listitem', { name });

beforeEach(() => {
  setInternalsVisible(true);
  go.mockReset();
  h.toast.error.mockReset();
  h.socialConnectSetup.mockReset().mockResolvedValue(allReady);
  h.startSocialConnect.mockReset().mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?state=abc');
});
afterEach(cleanup);

describe('Connect an account', () => {
  it('offers each platform with a Connect button and one line on what it brings', async () => {
    await show();
    for (const name of ['YouTube', 'Facebook and Instagram', 'X', 'TikTok', 'LinkedIn']) {
      await waitFor(() => expect((within(row(name)).getByRole('button', { name: `Connect ${name}` }) as HTMLButtonElement).disabled).toBe(false));
    }
    expect(within(row('Facebook and Instagram')).getByText(/Facebook Pages, and the Instagram business accounts/)).toBeTruthy();
    // Nobody is asked for a key here.
    expect(screen.queryByText(/token/i)).toBeNull();
  });

  it('sends the person to the platform to log in when they press Connect', async () => {
    await show();
    const button = await within(row('YouTube')).findByRole('button', { name: 'Connect YouTube' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=abc'));
    expect(h.startSocialConnect).toHaveBeenCalledWith('youtube', 'org-1', 'ws-1');
  });

  it('says the server\'s own sentence when it refuses, and lets the person try again', async () => {
    h.startSocialConnect.mockRejectedValueOnce(new Error('Only an owner or admin can connect a social account.'));
    await show();
    const button = await within(row('X')).findByRole('button', { name: 'Connect X' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Only an owner or admin can connect a social account.'));
    expect(go).not.toHaveBeenCalled();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });

  it('never shows a raw error', async () => {
    h.startSocialConnect.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await show();
    const button = await within(row('TikTok')).findByRole('button', { name: 'Connect TikTok' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled());
    expect(String(h.toast.error.mock.calls[0][0])).not.toMatch(/fetch/i);
  });

  it('tells the person who sets the site up what a platform still needs, with the return address', async () => {
    h.socialConnectSetup.mockResolvedValue({
      ...allReady, ready: { ...allReady.ready, tiktok: false, x: false },
      needs: { ...allReady.needs, tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], x: ['X_CLIENT_SECRET'] },
    });
    await show();
    const tiktok = row('TikTok');
    await within(tiktok).findByText(/TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET/);
    expect((within(tiktok).getByRole('button', { name: 'Connect TikTok' }) as HTMLButtonElement).disabled).toBe(true);
    // Only what is still missing is named.
    expect(within(row('X')).getByText('Needs X_CLIENT_SECRET in the server settings.')).toBeTruthy();
    expect(screen.getByText(CALLBACK)).toBeTruthy();
    // The platforms that are ready stay usable.
    expect((within(row('YouTube')).getByRole('button', { name: 'Connect YouTube' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('tells everybody else only that it is not switched on yet', async () => {
    setInternalsVisible(false);
    h.socialConnectSetup.mockResolvedValue({ ...allReady, ready: { ...allReady.ready, tiktok: false } });
    await show();
    const tiktok = row('TikTok');
    await waitFor(() => expect((within(tiktok).getByRole('button', { name: 'Connect TikTok' }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(tiktok).getByText('Not switched on yet.')).toBeTruthy();
    expect(screen.queryByText(/TIKTOK_CLIENT_KEY/)).toBeNull();
    expect(screen.queryByText(CALLBACK)).toBeNull();
  });

  it('keeps the buttons away from somebody who may not connect accounts', async () => {
    render(<ConnectAccounts organizationId="org-1" workspaceId="ws-1" canConnect={false} go={go} />);
    expect(screen.getByText('Only an owner or admin can connect accounts.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(h.socialConnectSetup).not.toHaveBeenCalled();
  });

  it('says so plainly when it cannot tell which platforms are ready', async () => {
    h.socialConnectSetup.mockRejectedValue(new TypeError('Failed to fetch'));
    await show();
    await screen.findByText('Connecting could not be checked just now. Reload the page to try again.');
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('coming back from a platform', () => {
  it('reads how it ended from the page address', () => {
    expect(readConnectReturn('?connect=done&p=youtube&n=1')).toEqual({ outcome: 'done', kind: 'youtube', count: 1 });
    expect(readConnectReturn('?connect=expired')).toEqual({ outcome: 'expired', kind: null, count: 0 });
    expect(readConnectReturn('?tab=accounts')).toBeNull();
    // Anything else in the address is not taken as an outcome, and never reaches the screen.
    expect(readConnectReturn('?connect=<script>')).toBeNull();
    expect(readConnectReturn('?connect=done&p=<b>&n=1e9')).toEqual({ outcome: 'done', kind: null, count: 0 });
  });

  it('has one plain sentence for each ending', () => {
    const say = (search: string) => connectReturnMessage(readConnectReturn(search)!);
    expect(say('?connect=done&p=youtube&n=1')).toEqual({ ok: true, text: 'YouTube is connected.' });
    expect(say('?connect=done&p=meta&n=3')).toEqual({ ok: true, text: '3 Facebook and Instagram accounts are connected.' });
    expect(say('?connect=done&p=meta&n=1')).toEqual({ ok: true, text: 'Your Facebook Page is connected.' });
    expect(say('?connect=cancelled&p=x')).toEqual({ ok: false, text: 'Nothing was connected: the log-in was cancelled.' });
    expect(say('?connect=expired').text).toBe('That took too long. Press Connect again.');
    expect(say('?connect=none&p=meta').text).toMatch(/No Facebook Page was found/);
    expect(say('?connect=none&p=youtube').text).toBe('That Google account has no YouTube channel.');
    expect(say('?connect=failed&p=tiktok')).toEqual({ ok: false, text: 'The account could not be connected. Please try again.' });
  });
});
