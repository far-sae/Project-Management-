// The lead page: where the lead is in the flow, its deals, and follow-ups
// that do not need a project.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { leadStepPatch } from '@/lib/crmFlow';

const state = vi.hoisted(() => ({
  lead: null as Record<string, unknown> | null,
  deals: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  updateContact: vi.fn(async () => ({})),
  createTask: vi.fn(async () => ({})),
}));

vi.mock('@/hooks/useSelectedWorkspace', () => {
  const same = <T,>(list: T[]) => list;
  const scope = {
    selectedId: 'w', selected: { workspaceId: 'w', name: 'Studio' }, select: () => {},
    filterProjects: same, filterTasks: same, projectIds: null,
  };
  return { useSelectedWorkspace: () => scope };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', displayName: 'Sam Carter', email: 'sam@example.com' } }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({
    organization: {
      organizationId: 'org-1',
      members: [{ userId: 'u1', displayName: 'Sam Carter', email: 'sam@example.com', status: 'active' }],
    },
  }),
}));
vi.mock('@/context/CrmCurrencyContext', () => {
  // The company works in pounds.
  const currency = { code: 'GBP', format: (n: number) => `£${n}` };
  return { useCrmCurrency: () => currency };
});
vi.mock('@/lib/fxRates', async (original) => {
  // 1 USD = 0.8 GBP
  const fx = { rates: { USD: 1, GBP: 0.8 }, usingFallback: false, fetchedAt: 1 };
  return { ...(await original<typeof import('@/lib/fxRates')>()), useFxRates: () => fx };
});
vi.mock('@/services/supabase/config', () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return { supabase: { channel: () => channel } };
});
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  getContact: async () => state.lead,
  updateContact: state.updateContact,
  deleteContact: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ listActivities: async () => [], logActivity: vi.fn() }));
vi.mock('@/services/supabase/crmHub/notes', () => ({ listNotes: async () => [], createNote: vi.fn() }));
vi.mock('@/services/supabase/crmHub/tasks', () => ({
  listTasks: async () => state.tasks,
  createTask: state.createTask,
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({ listDeals: async () => state.deals }));
vi.mock('@/services/supabase/crmHub/dealStages', () => ({
  listDealStages: async () => [{ id: 's1', name: 'Qualified', sortOrder: 1, probability: 20, status: 'open' }],
  seedDefaultDealStages: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/companies', () => ({
  getCompany: async () => ({ id: 'co-1', name: 'Northwind', workspaceId: 'ws-1' }),
}));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmCompanies: () => ({ items: [], loading: false, error: null, refresh: vi.fn() }),
  useWorkspaceForCreate: () => 'ws-1',
}));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: state.projects }) }));
vi.mock('@/components/crmHub/ContactTagPicker', () => ({ ContactTagPicker: () => <div>tag picker</div> }));
vi.mock('@/components/crmHub/ClientAccountsTab', () => ({ ClientAccountsTab: () => <div>accounts</div> }));
vi.mock('@/components/crmHub/ConvertLeadDialog', () => ({
  ConvertLeadDialog: ({ open, lead }: { open: boolean; lead: { firstName: string } }) =>
    (open ? <div data-testid="convert-dialog">Converting {lead.firstName}</div> : null),
}));

import { CrmContactDetailPage } from '@/pages/crmHub/ContactDetail';

const makeLead = (lifecycleStage: string, leadStatus: string) => ({
  id: 'lead-1',
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  ownerId: 'u1',
  companyId: 'co-1',
  firstName: 'Priya',
  lastName: 'Shah',
  email: 'priya@northwind.test',
  phone: '020 7946 0000',
  jobTitle: 'Head of Operations',
  lifecycleStage,
  leadStatus,
  source: 'Referral',
  notes: null,
  category: 'Warm intro',
  customFields: {},
  lastContactedAt: null,
  createdAt: new Date('2026-11-01T09:00:00Z'),
  updatedAt: new Date('2026-11-01T09:00:00Z'),
});

const renderPage = async () => {
  render(
    <MemoryRouter initialEntries={['/crm/contacts/lead-1']}>
      <Routes>
        <Route path="/crm/contacts/:id" element={<CrmContactDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Priya Shah' });
};

const stepBar = () => screen.getByRole('list', { name: 'Lead steps' });

beforeEach(() => {
  state.lead = makeLead('lead', 'connected');
  state.deals = [];
  state.tasks = [];
  state.projects = [];
  state.updateContact.mockClear();
  state.createTask.mockClear();
});
afterEach(cleanup);

describe('lead page', () => {
  it('shows the step the lead is on and offers to convert it', async () => {
    await renderPage();
    const current = within(stepBar()).getByText('Contacted').closest('li');
    expect(current?.getAttribute('aria-current')).toBe('step');
    expect(within(stepBar()).getByText('New').closest('li')?.getAttribute('data-state')).toBe('done');
    expect(within(stepBar()).getByText('Qualified').closest('li')?.getAttribute('data-state')).toBe('todo');

    expect(screen.getByText('No deals yet.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Convert to deal' })[0]);
    expect(screen.getByTestId('convert-dialog').textContent).toBe('Converting Priya');
  });

  it('moves the lead on when a step is clicked', async () => {
    await renderPage();
    fireEvent.click(within(stepBar()).getByRole('button', { name: 'Qualified' }));
    await waitFor(() => expect(state.updateContact).toHaveBeenCalledWith('lead-1', leadStepPatch('qualified')));
  });

  it('does not let "Deal open" or "Customer" be set by hand', async () => {
    await renderPage();
    expect(within(stepBar()).queryByRole('button', { name: 'Deal open' })).toBeNull();
    expect(within(stepBar()).queryByRole('button', { name: 'Customer' })).toBeNull();
    expect(within(stepBar()).getByText('Customer').getAttribute('title')).toMatch(/won/);
  });

  it('marks a lead unqualified and can re-open it', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Mark unqualified' }));
    await waitFor(() => expect(state.updateContact).toHaveBeenCalledWith('lead-1', leadStepPatch('unqualified')));

    cleanup();
    state.updateContact.mockClear();
    state.lead = makeLead('lead', 'unqualified');
    await renderPage();
    expect(stepBar().querySelector('[aria-current]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Convert to deal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Re-open lead' }));
    await waitFor(() => expect(state.updateContact).toHaveBeenCalledWith('lead-1', leadStepPatch('contacted')));
  });

  it('lists the lead’s deals with their status and project', async () => {
    state.lead = makeLead('customer', 'open_deal');
    state.deals = [
      { id: 'd1', name: 'Northwind retainer', value: 12000, status: 'won', projectId: 'p1' },
      { id: 'd2', name: 'Northwind audit', value: 3000, status: 'open', projectId: null },
    ];
    await renderPage();
    const won = screen.getByRole('link', { name: 'Northwind retainer' }).closest('tr')!;
    expect(screen.getByRole('link', { name: 'Northwind retainer' }).getAttribute('href')).toBe('/crm/deals/d1');
    expect(within(won).getByText('£12000')).toBeTruthy();
    expect(within(won).getByText('Won · in delivery')).toBeTruthy();
    expect(within(won).getByRole('link', { name: 'Open project' }).getAttribute('href')).toBe('/project/p1');
    const open = screen.getByRole('link', { name: 'Northwind audit' }).closest('tr')!;
    expect(within(open).getByText('Open')).toBeTruthy();
    expect(within(open).queryByRole('link', { name: 'Open project' })).toBeNull();

    expect(screen.queryByRole('button', { name: 'Convert to deal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open another deal' })).toBeTruthy();
  });

  it('shows a deal in its own currency, with the company amount beside a foreign one', async () => {
    state.lead = makeLead('opportunity', 'open_deal');
    state.deals = [
      { id: 'd1', name: 'Northwind retainer', value: 3000, currency: 'USD', status: 'open', projectId: null },
      { id: 'd2', name: 'Northwind audit', value: 1500, currency: null, status: 'open', projectId: null },
    ];
    await renderPage();
    const dollars = screen.getByRole('link', { name: 'Northwind retainer' }).closest('tr')!;
    expect(within(dollars).getByText('$3,000')).toBeTruthy();
    expect(within(dollars).getByText('≈ £2400')).toBeTruthy();
    const pounds = screen.getByRole('link', { name: 'Northwind audit' }).closest('tr')!;
    expect(within(pounds).getByText('£1500')).toBeTruthy();
    expect(within(pounds).queryByText(/≈/)).toBeNull();
  });

  it('asks before stepping a customer back', async () => {
    state.lead = makeLead('customer', 'open_deal');
    await renderPage();
    fireEvent.click(within(stepBar()).getByRole('button', { name: /New/ }));
    expect(state.updateContact).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(state.updateContact).toHaveBeenCalledWith('lead-1', leadStepPatch('new')));
  });

  it('creates a follow-up without a project, even when the workspace has none', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'New follow-up' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('No project (sales follow-up)')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Send the proposal' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create follow-up' }));
    await waitFor(() => expect(state.createTask).toHaveBeenCalledTimes(1));
    const [input] = state.createTask.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(input).toMatchObject({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      projectId: null,
      title: 'Send the proposal',
      contactId: 'lead-1',
      companyId: 'co-1',
    });
  });

  it('shows the lead’s custom fields and lets them be edited', async () => {
    state.lead = { ...makeLead('lead', 'connected'), customFields: { budget_range: '£5k', industry: 'Dental' } };
    await renderPage();
    expect(screen.getByText('Budget Range')).toBeTruthy();
    expect(screen.getByText('£5k')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /^Edit/ })[0]);
    const form = await screen.findByRole('dialog');
    expect((within(form).getByLabelText('Custom field 1 name') as HTMLInputElement).value).toBe('Budget Range');
    fireEvent.change(within(form).getByLabelText('Custom field 1 value'), { target: { value: '£8k' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Remove custom field Industry' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Add custom field' }));
    fireEvent.change(within(form).getByLabelText('Custom field 2 name'), { target: { value: 'Team size' } });
    fireEvent.change(within(form).getByLabelText('Custom field 2 value'), { target: { value: '12' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(state.updateContact).toHaveBeenCalled());
    expect(state.updateContact.mock.calls[0]).toMatchObject([
      'lead-1', { customFields: { budget_range: '£8k', team_size: '12' } },
    ]);
  });

  it('shows the single step pill instead of the two raw fields', async () => {
    await renderPage();
    expect(screen.queryByText('Lead status')).toBeNull();
    expect(screen.queryByText('Lifecycle stage')).toBeNull();
    expect(screen.getByText('Step')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('href')).toBe('/crm/contacts');
  });
});
