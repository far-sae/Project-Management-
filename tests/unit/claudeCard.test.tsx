// Email, Settings: the Claude card. The address to add in Claude, who has
// connected it, what Claude did, and Disconnect.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setInternalsVisible } from '@/lib/publicError';

const h = vi.hoisted(() => ({ load: vi.fn(), cut: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/claudeConnector', async (real) => ({
  ...(await real<typeof import('@/services/claudeConnector')>()),
  loadClaudeStatus: h.load,
  disconnectClaude: h.cut,
}));

import { ClaudeCard } from '@/components/email/ClaudeCard';

const ORG = '11111111-1111-4111-8111-111111111111';
const people = [{ userId: 'u1', displayName: 'Sam' }, { userId: 'u2', displayName: 'Priya Nair' }];
const ready = { ready: true, address: 'https://app.example.test/api/mcp', mayConnect: true, connections: [], actions: [] };
const connected = {
  ...ready,
  connections: [
    { id: 'c1', userId: 'u1', clientName: 'Claude', createdAt: '2026-11-27T10:00:00Z', lastUsedAt: '2026-11-27T12:00:00Z' },
    { id: 'c2', userId: 'u2', clientName: 'Claude', createdAt: '2026-11-20T10:00:00Z', lastUsedAt: null },
  ],
  actions: [
    { at: '2026-11-27T12:00:00Z', userId: 'u1', summary: 'Started "November offer" to 42 people' },
    { at: '2026-11-27T11:50:00Z', userId: 'u2', summary: 'Prepared "Follow up" for 12 people' },
  ],
};
const show = () => render(<ClaudeCard orgId={ORG} userId="u1" people={people} />);

beforeEach(() => {
  h.load.mockReset().mockResolvedValue(ready);
  h.cut.mockReset().mockResolvedValue(undefined);
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  setInternalsVisible(false);
});
afterEach(cleanup);

describe('the Claude card in Email settings', () => {
  it('gives the address and the three steps, and copies the address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show();
    const how = await screen.findByRole('region', { name: 'How to connect' });
    expect((within(how).getByLabelText('Copy this address') as HTMLInputElement).value).toBe('https://app.example.test/api/mcp');
    expect(within(how).getAllByRole('listitem')).toHaveLength(3);
    expect(within(how).getByText(/open Settings, then Connectors, and choose “Add custom connector”/)).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    fireEvent.click(within(how).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example.test/api/mcp'));
    expect(h.toast.success).toHaveBeenCalledWith('Address copied.');
    expect(h.load).toHaveBeenCalledWith(ORG);
  });

  it('lists who connected Claude and what it did, with names', async () => {
    h.load.mockResolvedValue(connected);
    show();
    const list = await screen.findByRole('region', { name: 'Connected' });
    expect(screen.getByText('Connected', { selector: '[data-tone]' })).toBeTruthy();
    expect(within(list).getByText('Connected by you on 27 Nov 2026. Last used on 27 Nov 2026.')).toBeTruthy();
    expect(within(list).getByText('Connected by Priya Nair on 20 Nov 2026. Not used yet.')).toBeTruthy();
    const did = screen.getByRole('region', { name: 'What Claude did' });
    expect(within(did).getByText('Started "November offer" to 42 people')).toBeTruthy();
    expect(within(did).getByText('for Priya Nair')).toBeTruthy();
  });

  it('disconnects one connection and reads the list again', async () => {
    h.load.mockResolvedValueOnce(connected).mockResolvedValue({ ...connected, connections: [connected.connections[0]] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Claude, connected by Priya Nair' }));
    await waitFor(() => expect(h.cut).toHaveBeenCalledWith('c2'));
    await waitFor(() => expect(screen.queryByText(/Connected by Priya Nair/)).toBeNull());
    expect(h.toast.success).toHaveBeenCalledWith('Claude is disconnected. It can do nothing more from that connection.');
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('says in plain words when disconnecting failed, and keeps the connection listed', async () => {
    h.load.mockResolvedValue(connected);
    h.cut.mockRejectedValue(new Error('duplicate key value violates unique constraint "mcp_tokens_pkey"'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Claude, connected by you' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('The request could not be completed. Please try again.'));
    expect(screen.getByText(/Connected by you/)).toBeTruthy();
  });

  it('tells a person without the Email page that they cannot connect, without the steps', async () => {
    h.load.mockResolvedValue({ ...ready, mayConnect: false });
    show();
    expect(await screen.findByText(/Your account does not have the Email page/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'How to connect' })).toBeNull();
  });

  it('keeps how the site is set up away from everybody but the people who run it', async () => {
    h.load.mockResolvedValue({ ready: false, address: 'https://app.example.test/api/mcp', connections: [], actions: [] });
    const first = show();
    expect(await screen.findByText('Connecting Claude is not switched on yet.')).toBeTruthy();
    expect(screen.queryByText(/crm_setup\.sql/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'How to connect' })).toBeNull();
    first.unmount();
    setInternalsVisible(true);
    show();
    expect(await screen.findByText(/run supabase\/crm_setup\.sql in the Supabase SQL editor/)).toBeTruthy();
  });

  it('shows one plain sentence when the card cannot load', async () => {
    h.load.mockRejectedValue(new Error('relation "mcp_connections" does not exist'));
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('The request could not be completed. Please try again.');
  });
});
