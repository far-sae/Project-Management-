// The lead page's Call button: it rings from the browser for an owner or admin
// once a phone provider is set up, and a recorded call can be played back from
// the timeline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => {
  const off = { setup: { configured: false, ready: false, problem: null, numbers: { US: false, GB: false } }, inApp: false, mayListen: false };
  const on = { setup: { configured: true, ready: true, problem: null, numbers: { US: true, GB: true } }, inApp: true, mayListen: true };
  return {
    off,
    on,
    calling: off,
    activities: [] as Record<string, unknown>[],
    fetchRecording: vi.fn(async () => new Blob(['audio'], { type: 'audio/mpeg' })),
    organization: {
      organization: {
        organizationId: 'org-1',
        members: [{ userId: 'u1', displayName: 'Sam Carter', email: 'sam@example.com', status: 'active' }],
      },
      isAdmin: true,
    },
  };
});

vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(list: T[]) => list;
  const scope = {
    selectedId: 'w', selected: { workspaceId: 'w', name: 'Studio' }, select: () => {},
    filterProjects: same, filterTasks: same, projectIds: null,
  };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/context/AuthContext', () => {
  const auth = { user: { userId: 'u1', displayName: 'Sam Carter', email: 'sam@example.com' } };
  return { useAuth: () => auth };
});
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.organization }));
vi.mock('@/context/CrmCurrencyContext', () => {
  const currency = { code: 'GBP', format: (n: number) => `£${n}` };
  return { useCrmCurrency: () => currency };
});
vi.mock('@/lib/fxRates', async (original) => {
  const fx = { rates: { USD: 1, GBP: 0.8 }, usingFallback: false, fetchedAt: 1 };
  return { ...(await original<typeof import('@/lib/fxRates')>()), useFxRates: () => fx };
});
vi.mock('@/services/supabase/config', () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return { supabase: { channel: () => channel } };
});
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  getContact: async () => ({
    id: 'lead-1', organizationId: 'org-1', workspaceId: 'ws-1', ownerId: 'u1', companyId: null,
    firstName: 'Elena', lastName: 'Rossi', email: 'elena@harbour.test', phone: '020 7946 0958', jobTitle: null,
    lifecycleStage: 'lead', leadStatus: 'connected', source: null, notes: null, category: null, customFields: {},
    lastContactedAt: null, createdAt: new Date('2026-11-01T09:00:00Z'), updatedAt: new Date('2026-11-01T09:00:00Z'),
  }),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ listActivities: async () => state.activities, logActivity: vi.fn() }));
vi.mock('@/services/supabase/crmHub/notes', () => ({ listNotes: async () => [], createNote: vi.fn() }));
// The meetings card has its own tests; here only what the page hands it is looked at.
vi.mock('@/components/crmHub/LeadMeetings', () => ({
  LeadMeetings: (props: { lead: { name: string; email: string | null }; planning: boolean }) => (
    <div data-testid="lead-meetings">{JSON.stringify({ lead: props.lead.name, email: props.lead.email, planning: props.planning })}</div>
  ),
}));

vi.mock('@/services/supabase/crmHub/tasks', () => ({ listTasks: async () => [], createTask: vi.fn() }));
vi.mock('@/services/supabase/crmHub/deals', () => ({ listDeals: async () => [] }));
vi.mock('@/services/supabase/crmHub/dealStages', () => ({ listDealStages: async () => [], seedDefaultDealStages: vi.fn() }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ getCompany: async () => null }));
vi.mock('@/hooks/useCrmHub', () => {
  const companies = { items: [], loading: false, error: null, refresh: vi.fn() };
  return { useCrmCompanies: () => companies, useWorkspaceForCreate: () => 'ws-1' };
});
vi.mock('@/hooks/useProjects', () => {
  const projects = { projects: [] };
  return { useProjects: () => projects };
});
vi.mock('@/components/crmHub/ContactTagPicker', () => ({ ContactTagPicker: () => null }));
vi.mock('@/components/crmHub/ClientAccountsTab', () => ({ ClientAccountsTab: () => null }));
vi.mock('@/components/crmHub/ConvertLeadDialog', () => ({ ConvertLeadDialog: () => null }));
vi.mock('@/components/automation/LeadAutomationCard', () => ({ LeadAutomationCard: () => null }));
vi.mock('@/hooks/useCalling', () => ({ useCalling: () => state.calling }));
vi.mock('@/services/voice/client', () => ({
  fetchRecording: state.fetchRecording,
  errorSentence: () => 'The recording could not be loaded. Please try again.',
}));
vi.mock('@/components/crmHub/CallDialog', () => ({
  CallDialog: ({ open, name, phone, target }: { open: boolean; name: string; phone: string; target: { contactId: string } }) =>
    (open ? <div role="dialog" aria-label="Call window">{name} · {phone} · {target.contactId}</div> : null),
}));

import { CrmContactDetailPage } from '@/pages/crmHub/ContactDetail';

const renderPage = async () => {
  render(
    <MemoryRouter initialEntries={['/crm/contacts/lead-1']}>
      <Routes>
        <Route path="/crm/contacts/:id" element={<CrmContactDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Elena Rossi' });
};

const recordedCall = {
  id: 'call-1', organizationId: 'org-1', workspaceId: 'ws-1', userId: 'u1', type: 'call',
  description: 'Called +44 20 7946 0958. 3 min 12 s. Spoke to them.\nSend the quote on Friday',
  contactId: 'lead-1', companyId: null, dealId: null, taskId: null,
  metadata: { callId: 'call-1', to: '+442079460958', country: 'GB', status: 'completed', seconds: 192, outcome: 'connected', recorded: true },
  createdAt: new Date('2026-11-20T10:00:00Z'),
};

beforeEach(() => {
  state.calling = state.off;
  state.activities = [];
  state.fetchRecording.mockClear();
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:recording');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('lead page: calling', () => {
  it('opens the Call window for the lead when calling is set up', async () => {
    state.calling = state.on;
    await renderPage();
    expect(screen.queryByRole('dialog', { name: 'Call window' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Call' }));
    expect(screen.getByRole('dialog', { name: 'Call window' }).textContent).toBe('Elena Rossi · 020 7946 0958 · lead-1');
  });

  it('keeps the Call button as it was while calling is not set up', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'Call' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Call window' })).toBeNull();
  });

  it('plays a recorded call from the timeline, on request', async () => {
    state.calling = state.on;
    state.activities = [recordedCall];
    await renderPage();
    expect(await screen.findByText(/Send the quote on Friday/)).toBeTruthy();
    expect(state.fetchRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    const audio = await screen.findByLabelText('Call recording');
    expect(state.fetchRecording).toHaveBeenCalledWith('call-1');
    expect(audio.getAttribute('src')).toBe('blob:recording');
  });

  it('offers no recording to someone who may not hear it, or for a call without one', async () => {
    state.activities = [recordedCall];
    await renderPage();
    await screen.findByText(/Send the quote on Friday/);
    expect(screen.queryByRole('button', { name: 'Play recording' })).toBeNull();

    cleanup();
    state.calling = state.on;
    state.activities = [{ ...recordedCall, metadata: { ...recordedCall.metadata, recorded: false } }];
    await renderPage();
    await screen.findByText(/Send the quote on Friday/);
    expect(screen.queryByRole('button', { name: 'Play recording' })).toBeNull();
  });
});
