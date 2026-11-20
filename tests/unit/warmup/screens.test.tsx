// The warm-up screens: the section on each mailbox, and the card in Email
// Settings where the organisation's MailReach key is connected.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WarmupMailbox, WarmupStatus } from '../../../api/_warmup/shared/types';

const h = vi.hoisted(() => ({
  warmupStatus: vi.fn(),
  saveWarmupKey: vi.fn(),
  removeWarmupKey: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/email/warmup', () => ({
  warmupStatus: h.warmupStatus,
  saveWarmupKey: h.saveWarmupKey,
  removeWarmupKey: h.removeWarmupKey,
  errorSentence: (e: unknown) => (e instanceof Error && e.message ? e.message : 'The request could not be completed. Please try again.'),
}));

import { WarmupPanel } from '@/components/email/WarmupPanel';
import { WarmupServiceCard } from '@/components/email/WarmupServiceCard';
import { WarmupLaunchWarning } from '@/components/email/WarmupLaunchWarning';

const box = (over: Partial<WarmupMailbox> = {}): WarmupMailbox => ({
  state: 'warming', score: 87, days: 19, sent: 210, spam: 6, spamPercent: 2.9, ready: true, ...over,
});
const status = (over: Partial<WarmupStatus> = {}): WarmupStatus => ({ linked: true, problem: null, periodDays: 14, mailboxes: {}, ...over });

const panel = (mailbox: WarmupMailbox | undefined, over: Partial<React.ComponentProps<typeof WarmupPanel>> = {}) => {
  const onStart = vi.fn();
  const onPause = vi.fn();
  render(<WarmupPanel status={status()} mailbox={mailbox} isAdmin busy={false} onStart={onStart} onPause={onPause} {...over} />);
  return { onStart, onPause };
};

beforeEach(() => {
  h.warmupStatus.mockReset();
  h.saveWarmupKey.mockReset();
  h.removeWarmupKey.mockReset();
  h.toast.success.mockClear();
});
afterEach(cleanup);

describe('warm-up on a mailbox', () => {
  it('shows a warmed mailbox with its score, its days and how much lands in spam', () => {
    const { onPause } = panel(box());
    expect(screen.getByText('Warmed up')).toBeTruthy();
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.getByText('19 days')).toBeTruthy();
    expect(screen.getByText('2.9%')).toBeTruthy();
    expect(screen.getByText('Last 14 days: 210 warm-up emails, 6 landed in spam.')).toBeTruthy();
    expect(screen.getByText('Ready to send campaigns from.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause warm-up' }));
    expect(onPause).toHaveBeenCalledWith(true);
  });

  it('says a young mailbox is not ready, and why', () => {
    panel(box({ days: 5, ready: false }));
    expect(screen.getByText('Warming')).toBeTruthy();
    expect(screen.getByText('Not ready for campaigns yet. Warming for 5 days: 9 more to go.')).toBeTruthy();
  });

  it('says so when too much still lands in spam', () => {
    panel(box({ spam: 60, spamPercent: 28.6, ready: false }));
    expect(screen.getByText('Not ready for campaigns yet. 28.6% of its warm-up emails still land in spam.')).toBeTruthy();
  });

  it('offers to start warm-up on a mailbox that is not warming, and says it uses a seat', () => {
    const { onStart } = panel(undefined);
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.getByText('Uses one warm-up seat of your MailReach plan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start warm-up' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('resumes a paused mailbox and reconnects a disconnected one', () => {
    const paused = panel(box({ state: 'paused', ready: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume warm-up' }));
    expect(paused.onPause).toHaveBeenCalledWith(false);
    cleanup();
    const lost = panel(box({ state: 'disconnected', ready: false }));
    expect(screen.getByText('Disconnected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(lost.onStart).toHaveBeenCalled();
  });

  it('gives a member the figures and no buttons', () => {
    panel(box(), { isAdmin: false });
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('points to Settings while no warm-up service is connected', () => {
    panel(undefined, { status: status({ linked: false }) });
    expect(screen.getByText(/Add your MailReach key in Settings/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows what is wrong in place of the figures', () => {
    panel(box(), { status: status({ problem: 'MailReach no longer accepts the saved key. Add the current one in Email, Settings.' }) });
    expect(screen.getByRole('alert').textContent).toContain('no longer accepts the saved key');
    expect(screen.queryByText('87')).toBeNull();
  });

  it('draws nothing until the service has answered', () => {
    const { container } = render(<WarmupPanel status={null} mailbox={undefined} isAdmin busy={false} onStart={() => undefined} onPause={() => undefined} />);
    expect(container.textContent).toBe('');
  });
});

describe('warm-up service in Email settings', () => {
  it('connects MailReach with the key, then forgets what was typed', async () => {
    h.warmupStatus.mockResolvedValueOnce(status({ linked: false })).mockResolvedValue(status({ mailboxes: { a: box() } }));
    h.saveWarmupKey.mockResolvedValue(3);
    render(<WarmupServiceCard orgId="org-1" isAdmin />);
    const field = (await screen.findByLabelText('MailReach API key')) as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: 'mr_live_0123456789abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(h.saveWarmupKey).toHaveBeenCalledWith('org-1', 'mr_live_0123456789abcdef'));
    expect(await screen.findByText('Connected. 1 of your mailboxes is in MailReach.')).toBeTruthy();
    expect(h.toast.success).toHaveBeenCalledWith('MailReach connected: 3 inboxes found.');
    expect((screen.getByLabelText('Replace the API key') as HTMLInputElement).value).toBe('');
  });

  it('shows why a key was refused and keeps nothing', async () => {
    h.warmupStatus.mockResolvedValue(status({ linked: false }));
    h.saveWarmupKey.mockRejectedValue(new Error('MailReach did not accept this key. Copy it again from the Settings tab of your MailReach project.'));
    render(<WarmupServiceCard orgId="org-1" isAdmin />);
    fireEvent.change(await screen.findByLabelText('MailReach API key'), { target: { value: 'mr_live_wrong_key_000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toContain('did not accept this key');
    expect(screen.queryByText(/^Connected/)).toBeNull();
  });

  it('can be disconnected', async () => {
    h.warmupStatus.mockResolvedValueOnce(status()).mockResolvedValue(status({ linked: false }));
    h.removeWarmupKey.mockResolvedValue(undefined);
    render(<WarmupServiceCard orgId="org-1" isAdmin />);
    expect(await screen.findByText(/No mailbox is warming yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(h.removeWarmupKey).toHaveBeenCalledWith('org-1'));
    expect(await screen.findByLabelText('MailReach API key')).toBeTruthy();
  });

  it('says what is missing while warm-up is not set up', async () => {
    h.warmupStatus.mockResolvedValue(status({ linked: false, problem: 'Warm-up is not set up yet: run supabase/migrations/189_email_warmup.sql in the Supabase SQL editor.' }));
    render(<WarmupServiceCard orgId="org-1" isAdmin />);
    expect((await screen.findByRole('alert')).textContent).toContain('189_email_warmup.sql');
  });

  it('is closed to a member, without asking the server', () => {
    render(<WarmupServiceCard orgId="org-1" isAdmin={false} />);
    expect(screen.getByText('Only an organization owner or admin can connect the warm-up service.')).toBeTruthy();
    expect(h.warmupStatus).not.toHaveBeenCalled();
  });
});

describe('warm-up warning before a campaign is sent', () => {
  const boxes = [{ id: 'a', fromEmail: 'sam@northwind.test' }, { id: 'b', fromEmail: 'priya@northwind.test' }, { id: 'c', fromEmail: 'tom@northwind.test' }];

  it('names the mailboxes that are not warmed up yet, and why', async () => {
    h.warmupStatus.mockResolvedValue(status({ mailboxes: { a: box(), b: box({ days: 5, ready: false }) } }));
    render(<WarmupLaunchWarning open organizationId="org-1" mailboxes={boxes} />);
    const warning = await screen.findByRole('alert');
    expect(h.warmupStatus).toHaveBeenCalledWith('org-1', null);
    expect(warning.textContent).toContain('2 of 3 mailboxes are not warmed up yet.');
    expect(warning.textContent).toContain('priya@northwind.test: Warming for 5 days: 9 more to go.');
    expect(warning.textContent).toContain('tom@northwind.test: Warm-up has not been started for this mailbox.');
    expect(warning.textContent).not.toContain('sam@northwind.test');
  });

  it('says nothing when every mailbox is warmed, or when no warm-up service is connected', async () => {
    h.warmupStatus.mockResolvedValue(status({ mailboxes: { a: box() } }));
    const { container } = render(<WarmupLaunchWarning open organizationId="org-1" mailboxes={[boxes[0]]} />);
    await waitFor(() => expect(h.warmupStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    h.warmupStatus.mockResolvedValue(status({ linked: false }));
    const off = render(<WarmupLaunchWarning open organizationId="org-1" mailboxes={boxes} />);
    await waitFor(() => expect(h.warmupStatus).toHaveBeenCalledTimes(2));
    expect(off.container.textContent).toBe('');
  });

  it('does not ask the service until the review is open', () => {
    render(<WarmupLaunchWarning open={false} organizationId="org-1" mailboxes={boxes} />);
    expect(h.warmupStatus).not.toHaveBeenCalled();
  });
});
