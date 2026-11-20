// The CRM's Calls page: every call of the workspace with its note and its
// recording, and a way to ring a lead from the list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CallList, CallListItem } from '../../api/_voice/shared/types';

const state = vi.hoisted(() => {
  const off = { setup: { configured: false, ready: false, problem: null as string | null, numbers: { US: false, GB: false } }, inApp: false, mayListen: false };
  const on = { setup: { configured: true, ready: true, problem: null as string | null, numbers: { US: true, GB: true } }, inApp: true, mayListen: true };
  const admin = { isAdmin: true };
  const member = { isAdmin: false };
  const leads = {
    items: [
      { id: 'lead-1', firstName: 'Elena', lastName: 'Rossi', email: 'elena@harbour.test', phone: '020 7946 0958' },
      { id: 'lead-2', firstName: 'Priya', lastName: 'Nair', email: 'priya@fieldway.test', phone: '+1 415 555 0132' },
      { id: 'lead-3', firstName: 'Tom', lastName: 'Okafor', email: 'tom@northwind.test', phone: null },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
  return {
    off, on, admin, member, leads,
    calling: on,
    workspaceId: 'ws-1' as string | null,
    organization: admin as { isAdmin: boolean },
    listCalls: vi.fn(),
    fetchRecording: vi.fn(async () => new Blob(['audio'], { type: 'audio/mpeg' })),
  };
});

vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.organization }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmContacts: () => state.leads, useWorkspaceForCreate: () => state.workspaceId }));
vi.mock('@/hooks/useCalling', () => ({ useCalling: () => state.calling }));
vi.mock('@/services/voice/client', () => ({
  listCalls: state.listCalls,
  fetchRecording: state.fetchRecording,
  errorSentence: (e: unknown) => (e instanceof Error && e.message ? e.message : 'The request could not be completed. Please try again.'),
}));
vi.mock('@/components/crmHub/CallDialog', () => ({
  CallDialog: ({ open, name, phone, target, onLogged }: { open: boolean; name: string; phone: string; target: Record<string, string>; onLogged?: () => void }) =>
    (open ? (
      <div role="dialog" aria-label="Call window">
        {name} · {phone} · {JSON.stringify(target)}
        <button type="button" onClick={onLogged}>finish call</button>
      </div>
    ) : null),
}));

import { CrmCallsPage } from '@/pages/crmHub/Calls';

const call = (over: Partial<CallListItem>): CallListItem => ({
  id: 'c1', at: '2026-11-19T10:00:00.000Z', status: 'completed', seconds: 192, outcome: 'connected', note: '',
  to: '+442079460958', display: '+44 20 7946 0958', country: 'GB', recorded: false,
  contact: { id: 'lead-1', name: 'Elena Rossi' }, company: null, caller: { id: 'u1', name: 'Sam' },
  ...over,
});

const LIST: CallList = {
  calls: [
    call({ id: 'c1', recorded: true, note: 'Send the quote on Friday' }),
    call({ id: 'c2', status: 'no_answer', seconds: 0, outcome: null, contact: null, company: { id: 'co-1', name: 'Harbour Dental' }, to: '+14155550132', display: '+1 (415) 555-0132', country: 'US' }),
    call({ id: 'c3', status: 'completed', seconds: 45, outcome: 'voicemail', contact: null, company: null }),
  ],
  more: false,
  summary: { days: 30, total: 3, answered: 2, seconds: 3840 },
};

const renderPage = async () => {
  render(<MemoryRouter><CrmCallsPage /></MemoryRouter>);
  await screen.findByRole('heading', { level: 1, name: 'Calls' });
};
const rows = () => within(screen.getByRole('region', { name: 'Calls' })).getAllByRole('listitem');

beforeEach(() => {
  state.calling = state.on;
  state.organization = state.admin;
  state.workspaceId = 'ws-1';
  state.listCalls.mockReset().mockResolvedValue(LIST);
  state.fetchRecording.mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:recording');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('CRM calls page', () => {
  it('lists the calls of the workspace with who was rung, how it went and the note', async () => {
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    expect(state.listCalls).toHaveBeenCalledWith('ws-1');
    const [first, second, third] = rows();
    expect(within(first).getByRole('link', { name: 'Elena Rossi' }).getAttribute('href')).toBe('/crm/contacts/lead-1');
    expect(within(first).getByText('Spoke to them')).toBeTruthy();
    expect(within(first).getByText('3 min 12 s')).toBeTruthy();
    expect(first.textContent).toContain('+44 20 7946 0958');
    expect(first.textContent).toContain('Sam');
    expect(within(second).getByRole('link', { name: 'Harbour Dental' }).getAttribute('href')).toBe('/crm/companies/co-1');
    expect(within(second).getByText('No answer')).toBeTruthy();
    // A call whose lead was deleted since is still listed, with nobody to ring.
    expect(within(third).getByText('Deleted record')).toBeTruthy();
    expect(within(third).getByText('Left a voicemail')).toBeTruthy();
    expect(within(third).queryByRole('button', { name: /again/ })).toBeNull();
  });

  it('sums up the last 30 days', async () => {
    await renderPage();
    const summary = await screen.findByLabelText('Last 30 days');
    expect(summary.textContent).toContain('Calls · last 30 days3');
    expect(summary.textContent).toContain('Answered · last 30 days2');
    expect(summary.textContent).toContain('Talk time · last 30 days1 h 4 min');
  });

  it('plays a recording only when asked', async () => {
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    expect(screen.getAllByRole('button', { name: 'Play recording' })).toHaveLength(1);
    expect(state.fetchRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    expect((await screen.findByLabelText('Call recording')).getAttribute('src')).toBe('blob:recording');
    expect(state.fetchRecording).toHaveBeenCalledWith('c1');
  });

  it('filters and searches the list', async () => {
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    fireEvent.change(screen.getByLabelText('Search calls'), { target: { value: 'harbour' } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search calls'), { target: { value: '415 555' } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search calls'), { target: { value: 'quote on friday' } });
    expect(within(rows()[0]).getByText('Elena Rossi')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search calls'), { target: { value: 'nobody at all' } });
    expect(screen.getByText('No call matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all calls' }));
    expect(rows()).toHaveLength(3);
  });

  it('rings the same lead again from its row, then refreshes the list', async () => {
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Call Elena Rossi again' }));
    expect(screen.getByRole('dialog', { name: 'Call window' }).textContent).toContain('Elena Rossi · +44 20 7946 0958 · {"contactId":"lead-1"}');
    fireEvent.click(screen.getByRole('button', { name: 'finish call' }));
    await waitFor(() => expect(state.listCalls).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Call Harbour Dental again' }));
    expect(screen.getByRole('dialog', { name: 'Call window' }).textContent).toContain('{"companyId":"co-1"}');
  });

  it('rings a lead picked from the workspace, offering only leads with a number', async () => {
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    fireEvent.click(screen.getByRole('button', { name: 'Call a lead' }));
    const picker = screen.getByRole('dialog', { name: 'Call a lead' });
    expect(within(picker).getByText('Elena Rossi')).toBeTruthy();
    expect(within(picker).getByText('Priya Nair')).toBeTruthy();
    expect(within(picker).queryByText('Tom Okafor')).toBeNull();
    fireEvent.change(within(picker).getByLabelText('Find a lead'), { target: { value: 'priya' } });
    expect(within(picker).queryByText('Elena Rossi')).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: /Priya Nair/ }));
    expect(screen.getByRole('dialog', { name: 'Call window' }).textContent).toContain('Priya Nair · +1 415 555 0132 · {"contactId":"lead-2"}');
  });

  it('loads older calls on request', async () => {
    state.listCalls.mockResolvedValueOnce({ ...LIST, more: true }).mockResolvedValueOnce({ calls: [call({ id: 'c9', note: 'An older call' })], more: false, summary: LIST.summary });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Show older calls' }));
    expect(await screen.findByText('An older call')).toBeTruthy();
    expect(state.listCalls).toHaveBeenLastCalledWith('ws-1', '2026-11-19T10:00:00.000Z');
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Show older calls' })).toBeNull();
  });

  it('says so when there are no calls, and when the list cannot be loaded', async () => {
    state.listCalls.mockResolvedValue({ calls: [], more: false, summary: { days: 30, total: 0, answered: 0, seconds: 0 } });
    await renderPage();
    expect(await screen.findByText('No calls yet.')).toBeTruthy();

    cleanup();
    state.listCalls.mockReset().mockRejectedValueOnce(new Error('Calling is not set up yet: run supabase/migrations/188_crm_calls.sql in the Supabase SQL editor.')).mockResolvedValue(LIST);
    await renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('188_crm_calls.sql');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Send the quote on Friday')).toBeTruthy();
  });

  it('shows what is missing while calling is not set up, and offers no call buttons', async () => {
    state.calling = { ...state.off, setup: { ...state.off.setup, configured: true, problem: 'Twilio did not accept the API key.' } };
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    expect(screen.getByRole('status').textContent).toBe('Twilio did not accept the API key.');

    cleanup();
    state.calling = state.off;
    await renderPage();
    await screen.findByText('Send the quote on Friday');
    expect(screen.getByRole('status').textContent).toContain('Calling is not set up yet.');
    expect(screen.queryByRole('button', { name: 'Call a lead' })).toBeNull();
    expect(screen.queryByRole('button', { name: /again/ })).toBeNull();
  });

  it('asks for a workspace when none is chosen in the sidebar', async () => {
    state.workspaceId = null;
    await renderPage();
    expect(screen.getByText('Choose a workspace in the sidebar to see its calls.')).toBeTruthy();
    expect(state.listCalls).not.toHaveBeenCalled();
  });

  it('is closed to anyone who is not an owner or admin', async () => {
    state.organization = state.member;
    await renderPage();
    expect(screen.getByText('Only the owner and admins can see calls and their recordings.')).toBeTruthy();
    expect(state.listCalls).not.toHaveBeenCalled();
  });
});
