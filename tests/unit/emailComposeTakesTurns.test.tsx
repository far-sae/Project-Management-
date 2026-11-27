// The compose screen, for a campaign that goes out through all mailboxes:
// what it says will happen, and the one sender name and reply address.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ takesTurns: true, mailboxes: [] as unknown[], accounts: [] as unknown[] }));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', email: 'sam@northwind.test', displayName: 'Sam' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/supabase/email', () => ({
  listAccounts: async () => h.accounts,
  listMailboxStatus: async () => h.mailboxes,
  listSuppressions: async () => [],
  getEmailSettings: async () => null,
  mailboxesTakeTurns: async () => h.takesTurns,
  createCampaign: vi.fn(),
  queueRecipients: vi.fn(),
  setCampaignStatus: vi.fn(),
}));
vi.mock('@/components/email/AudiencePicker', () => ({ AudiencePicker: () => <div>Audience</div> }));
vi.mock('@/components/email/RichTextEditor', () => ({ RichTextEditor: () => <div>Editor</div> }));
vi.mock('@/components/email/LaunchReview', () => ({ LaunchReview: () => null }));
vi.mock('@/components/email/verifyAccount', () => ({ verifyAccount: vi.fn() }));

import { ComposeTab } from '@/components/email/ComposeTab';

const health = (id: string, limit: number, over: Record<string, unknown> = {}) => ({
  id, label: id, fromEmail: `${id}@northwind.test`, isActive: true, pausedReason: null, status: 'active',
  consecutiveFailures: 0, lastSentAt: null, effectiveLimit: limit, sentToday: 0, ...over,
});
const account = (id: string) => ({ id, label: id, fromName: 'Sam', fromEmail: `${id}@northwind.test`, status: 'active', signatureHtml: '' });
const show = () => render(<ComposeTab orgId="org-1" workspaceId="ws-1" isAdmin onSent={() => undefined} onCancel={() => undefined} pendingTemplate={null} onTemplateLoaded={() => undefined} />);

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => {
  h.takesTurns = true;
  h.mailboxes = [health('hello', 40), health('sales', 25)];
  h.accounts = [account('hello'), account('sales')];
});
afterEach(cleanup);

describe('composing a campaign for all mailboxes', () => {
  it('says every working mailbox takes a turn, and offers one sender name and one reply address', async () => {
    show();
    expect(await screen.findByText('Goes out through your 2 working mailboxes in turn: up to 65 emails a day together. Each one keeps its own daily limit.')).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Look like one sender' });
    expect(group).toBeTruthy();
    expect((screen.getByLabelText('Sender name') as HTMLInputElement).placeholder).toBe("Each mailbox's own name");
    expect((screen.getByLabelText('Replies go to') as HTMLInputElement).placeholder).toBe("Each mailbox's own address");
    expect(screen.getByText(/The address an\s+email comes from is always the sending mailbox/)).toBeTruthy();
  });

  it('says at once when the reply address is not an address', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Replies go to'), { target: { value: 'hello@' } });
    expect(screen.getByRole('alert').textContent).toBe('The reply address is not an email address.');
    fireEvent.change(screen.getByLabelText('Replies go to'), { target: { value: 'hello@northwind.test' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not offer them with one mailbox: there is nothing to make alike', async () => {
    h.mailboxes = [health('hello', 40)];
    h.accounts = [account('hello')];
    show();
    expect(await screen.findByText(/You have one working mailbox \(hello\), so it sends the whole campaign/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Look like one sender' })).toBeNull();
  });

  it('keeps the old words, and no new fields, on a database where mailboxes do not take turns yet', async () => {
    h.takesTurns = false;
    show();
    expect(await screen.findByText(/The whole campaign goes from one mailbox: the one used least recently when it starts/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Look like one sender' })).toBeNull();
  });
});
