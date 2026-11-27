// The page Claude sends a person to (/connect/authorize): it says who is
// asking and what Claude will be able to do, and connects nothing until Allow.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setInternalsVisible } from '@/lib/publicError';

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const ORG = '11111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => ({
  user: { userId: 'u1', email: 'sam@northwind.test' } as null | { userId: string; email: string },
  authLoading: false,
  organization: { organizationId: '11111111-1111-4111-8111-111111111111', name: 'Northwind Studio' } as null | { organizationId: string; name: string },
  checkConsent: vi.fn(),
  allowConsent: vi.fn(),
  goToClaude: vi.fn(),
  isFramed: vi.fn(() => false),
  allowAfterMs: 0,
}));

vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: h.user, loading: h.authLoading }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: h.organization, loading: false }) }));
vi.mock('@/services/claudeConnector', async (real) => ({
  ...(await real<typeof import('@/services/claudeConnector')>()),
  checkConsent: h.checkConsent,
  allowConsent: h.allowConsent,
  goToClaude: h.goToClaude,
  isFramed: h.isFramed,
  get ALLOW_AFTER_MS() { return h.allowAfterMs; },
}));

import { ConnectClaude } from '@/pages/ConnectClaude';
import { isClaudeAddress } from '@/services/claudeConnector';

const QUERY = `?response_type=code&client_id=tc1.abc.def&redirect_uri=${encodeURIComponent(CLAUDE)}&code_challenge=xyz&code_challenge_method=S256&state=st-1`;
const show = () => render(<MemoryRouter initialEntries={[`/connect/authorize${QUERY}`]}><ConnectClaude /></MemoryRouter>);
const asked = { ok: true, allowed: true, from: 'claude', clientName: 'Claude', deny: `${CLAUDE}?error=access_denied&state=st-1`, workspaces: ['Northwind Studio', 'Harbour Dental'] };

beforeEach(() => {
  h.user = { userId: 'u1', email: 'sam@northwind.test' };
  h.authLoading = false;
  h.organization = { organizationId: ORG, name: 'Northwind Studio' };
  h.checkConsent.mockReset().mockResolvedValue(asked);
  h.allowConsent.mockReset().mockResolvedValue({ ok: true, redirect: `${CLAUDE}?code=tcc_1&state=st-1` });
  h.goToClaude.mockReset().mockReturnValue(true);
  h.isFramed.mockReset().mockReturnValue(false);
  h.allowAfterMs = 0;
  setInternalsVisible(false);
});
afterEach(cleanup);

describe('the Allow page for Claude', () => {
  it('says who is asking, for which organisation and account, and what Claude will and will not be able to do', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Let Claude send email for you?' })).toBeTruthy();
    expect(screen.getByText(/The Claude app is asking to use Email in/).textContent).toBe('The Claude app is asking to use Email in Northwind Studio as you (sam@northwind.test).');
    const can = screen.getByRole('region', { name: 'What Claude will be able to do' });
    expect(within(can).getByText('Send a campaign from your mailboxes, after it asked you in the chat')).toBeTruthy();
    expect(within(can).getByText('In the workspaces Northwind Studio, Harbour Dental.')).toBeTruthy();
    const cannot = screen.getByRole('region', { name: 'What Claude will not be able to do' });
    expect(within(cannot).getByText('See a password, or add or change a mailbox')).toBeTruthy();
    expect(h.checkConsent).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'tc1.abc.def', redirect_uri: CLAUDE, state: 'st-1', code_challenge_method: 'S256' }), ORG);
    // Looking at the page connects nothing.
    expect(h.allowConsent).not.toHaveBeenCalled();
    expect(h.goToClaude).not.toHaveBeenCalled();
  });

  it('connects on Allow and sends the person back to Claude, once', async () => {
    show();
    const allow = (await screen.findByRole('button', { name: 'Allow' })) as HTMLButtonElement;
    await waitFor(() => expect(allow.disabled).toBe(false));
    fireEvent.click(allow);
    await waitFor(() => expect(h.goToClaude).toHaveBeenCalledWith(`${CLAUDE}?code=tcc_1&state=st-1`));
    expect(h.allowConsent).toHaveBeenCalledTimes(1);
    // On the way out both buttons stay off: a second press must not make a second code.
    expect((screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps Allow off for a moment after the page appears, so a click meant for something else cannot press it', async () => {
    h.allowAfterMs = 150;
    show();
    const allow = (await screen.findByRole('button', { name: 'Allow' })) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);
    fireEvent.click(allow);
    expect(h.allowConsent).not.toHaveBeenCalled();
    await waitFor(() => expect(allow.disabled).toBe(false));
    expect(screen.getByText(/Press Allow only if you pressed Connect in Claude yourself just now/)).toBeTruthy();
  });

  it('tells Claude "no" on Cancel and connects nothing', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(h.goToClaude).toHaveBeenCalledWith(`${CLAUDE}?error=access_denied&state=st-1`);
    expect(h.allowConsent).not.toHaveBeenCalled();
  });

  it('warns when the request comes from a program on this computer, in that program\'s own name', async () => {
    h.checkConsent.mockResolvedValue({ ...asked, from: 'this_computer', clientName: 'Claude Code' });
    show();
    expect((await screen.findByText(/A program on this computer/)).textContent).toContain('calls itself “Claude Code”');
    expect(screen.getByText(/Say yes only when you started this yourself/)).toBeTruthy();
  });

  it('asks a signed-out person to sign in, and comes back to the same request afterwards', () => {
    h.user = null;
    show();
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe(`/login?redirect=${encodeURIComponent(`/connect/authorize${QUERY}`)}`);
    expect(h.checkConsent).not.toHaveBeenCalled();
  });

  it('has nothing to allow for a person without the Email page', async () => {
    h.checkConsent.mockResolvedValue({ ok: true, allowed: false, from: 'claude', clientName: 'Claude', deny: asked.deny, problem: 'x' });
    show();
    expect(await screen.findByRole('heading', { name: 'You cannot connect Claude here' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Claude' }));
    expect(h.goToClaude).toHaveBeenCalledWith(asked.deny);
  });

  it('offers no way on for a request that did not come from Claude', async () => {
    h.checkConsent.mockResolvedValue({ ok: false, problem: 'This request did not come from Claude, so nothing was connected. Start again from Claude.', redirect: null });
    show();
    expect(await screen.findByText('This request did not come from Claude, so nothing was connected. Start again from Claude.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps how the site is set up away from everybody but the people who run it', async () => {
    h.checkConsent.mockResolvedValue({ ok: false, notSetUp: true, problem: 'Connecting Claude is not set up yet.', redirect: null });
    const first = show();
    expect(await screen.findByText('Connecting Claude is not switched on yet. Please contact support.')).toBeTruthy();
    expect(screen.queryByText(/crm_setup\.sql/)).toBeNull();
    first.unmount();
    setInternalsVisible(true);
    show();
    expect(await screen.findByText(/run supabase\/crm_setup\.sql in the Supabase SQL editor/)).toBeTruthy();
  });

  it('says so in plain words when the server cannot be reached, and when Allow is refused', async () => {
    h.checkConsent.mockRejectedValue(new Error('TypeError: Failed to fetch at https://x.supabase.co'));
    const first = show();
    expect((await screen.findByRole('alert')).textContent).toBe('The request could not be completed. Please try again.');
    first.unmount();
    h.checkConsent.mockResolvedValue(asked);
    h.allowConsent.mockResolvedValue({ ok: false, problem: 'Claude sent a request this page cannot use. Start again from Claude.', redirect: null });
    show();
    const allow = (await screen.findByRole('button', { name: 'Allow' })) as HTMLButtonElement;
    await waitFor(() => expect(allow.disabled).toBe(false));
    fireEvent.click(allow);
    expect(await screen.findByText('Claude sent a request this page cannot use. Start again from Claude.')).toBeTruthy();
    expect(h.goToClaude).not.toHaveBeenCalled();
  });

  it('shows no button at all inside another website, and asks the server nothing', () => {
    h.isFramed.mockReturnValue(true);
    show();
    expect(screen.getByRole('heading', { name: 'Open this page on its own' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(h.checkConsent).not.toHaveBeenCalled();
  });

  it('only ever sends a person on to Claude itself', () => {
    expect(isClaudeAddress('https://claude.ai/api/mcp/auth_callback?code=1')).toBe(true);
    expect(isClaudeAddress('https://claude.com/api/mcp/auth_callback?code=1')).toBe(true);
    expect(isClaudeAddress('http://localhost:3118/callback?code=1')).toBe(true);
    for (const bad of ['https://claude.ai.evil.test/api/mcp/auth_callback', 'https://evil.test/?x=https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/other', 'javascript:alert(1)', 'http://localhost.evil.test/callback', '']) {
      expect(isClaudeAddress(bad), bad).toBe(false);
    }
  });
});
