// The Leads list and the Deals board show where everything is in the flow and offer the next step.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CrmCompany, CrmContact, CrmDeal, CrmDealStage } from '@/types/crmHub';

const data = vi.hoisted(() => {
  const now = new Date('2026-11-18T10:00:00Z');
  const stage = (id: string, name: string, sortOrder: number, probability: number, status = 'open') =>
    ({ id, name, sortOrder, probability, status, organizationId: 'o', workspaceId: 'w' });
  const lead = (id: string, firstName: string, lastName: string, lifecycleStage: string, leadStatus: string, companyId: string | null, jobTitle: string) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', companyId, firstName, lastName,
    email: `${firstName.toLowerCase()}@example.com`, phone: '020 7946 0' + id.slice(-3), jobTitle,
    lifecycleStage, leadStatus, source: 'Website', notes: null, category: null, customFields: {},
    lastContactedAt: null, createdAt: now, updatedAt: now,
  });
  const deal = (id: string, name: string, stageId: string, value: number, status: string, projectId: string | null, extra: Record<string, unknown> = {}) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', name, stageId, value, probability: 0, status,
    companyId: 'c1', contactId: 'l4', expectedCloseDate: '2026-12-15', source: null, notes: null, projectId,
    closedAt: status === 'open' ? null : now, lostReason: null, createdAt: now, updatedAt: now, ...extra,
  });
  return {
    stages: [
      stage('s1', 'New Lead', 1, 10), stage('s2', 'Qualified', 2, 25), stage('s3', 'Proposal Sent', 3, 60),
      stage('s4', 'Negotiation', 4, 80), stage('s5', 'Won', 5, 100, 'won'), stage('s6', 'Lost', 6, 0, 'lost'),
    ],
    companies: [
      { id: 'c1', name: 'Northwind Studio' }, { id: 'c2', name: 'Harbour Dental' }, { id: 'c3', name: 'Fieldway Logistics' },
    ],
    contacts: [
      lead('l1', 'Priya', 'Nair', 'lead', 'new', 'c2', 'Practice manager'),
      lead('l2', 'Tom', 'Okafor', 'lead', 'connected', 'c3', 'Operations lead'),
      lead('l3', 'Elena', 'Rossi', 'sales_qualified_lead', 'connected', 'c1', 'Marketing director'),
      lead('l4', 'Marcus', 'Bell', 'opportunity', 'open_deal', 'c1', 'Founder'),
      lead('l5', 'Aisha', 'Khan', 'customer', 'open_deal', 'c2', 'Owner'),
      lead('l6', 'Jon', 'Petrov', 'lead', 'unqualified', null, 'Student'),
    ],
    tasks: [
      { id: 't1', title: 'Call Priya back about the booking site', dueDate: new Date(Date.now() - 2 * 86400000), status: 'pending', priority: 'high', contactId: 'l1', dealId: 'd1', projectId: null },
      { id: 't2', title: 'Send Fieldway the revised quote', dueDate: new Date(Date.now() + 2 * 86400000), status: 'pending', priority: 'medium', contactId: 'l2', dealId: 'd2', projectId: null },
    ],
    activities: [
      { id: 'a1', type: 'deal_won', description: 'Northwind website', dealId: 'd4', contactId: 'l4', companyId: 'c1', createdAt: now },
      { id: 'a2', type: 'deal_lost', description: 'Lost: Went with a competitor', dealId: 'd6', contactId: 'l2', companyId: 'c3', createdAt: now },
      { id: 'a3', type: 'call', description: 'Intro call with Elena', dealId: null, contactId: 'l3', companyId: 'c1', createdAt: now },
    ],
    deals: [
      deal('d1', 'Harbour Dental booking site', 's1', 4000, 'open', null, { companyId: 'c2', contactId: 'l1' }),
      deal('d2', 'Fieldway driver app', 's2', 18000, 'open', null, { companyId: 'c3', contactId: 'l2' }),
      deal('d3', 'Northwind rebrand', 's3', 12000, 'open', null),
      deal('d4', 'Northwind website', 's5', 9500, 'won', null),
      deal('d5', 'Harbour Dental SEO retainer', 's5', 6000, 'won', 'p1', { companyId: 'c2', contactId: 'l5' }),
      deal('d6', 'Fieldway intranet', 's6', 7000, 'lost', null, { companyId: 'c3', contactId: 'l2', lostReason: 'Went with a competitor' }),
    ],
  };
});

const svc = vi.hoisted(() => ({ createContact: vi.fn(), ensureCompaniesByName: vi.fn() }));

const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: async () => {} });

vi.mock('@/hooks/useCrmHub', () => ({
  useCrmDeals: () => list(data.deals as unknown as CrmDeal[]),
  useCrmDealStages: () => list(data.stages as unknown as CrmDealStage[]),
  useCrmContacts: () => list(data.contacts as unknown as CrmContact[]),
  useCrmCompanies: () => list(data.companies as unknown as CrmCompany[]),
  useCrmTags: () => list([]),
  useCrmTasks: () => list(data.tasks),
  useCrmActivities: () => list(data.activities),
  useContactTagsMap: () => ({ map: new Map(), refresh: async () => {} }),
  useWorkspaceForCreate: () => 'w',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'o' } }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({
  useCrmCurrency: () => ({
    code: 'GBP', def: { code: 'GBP', symbol: '£', label: 'British pound' }, loading: false,
    format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`,
  }),
}));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ selected: { workspaceId: 'w', name: 'Studio' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: [], loading: false }) }));
// Fixed exchange rates, so the pages never go to the network for them.
vi.mock('@/lib/fxRates', async (original) => {
  const fx = { rates: { USD: 1, GBP: 0.8 }, usingFallback: false, fetchedAt: 1 };
  return { ...(await original<typeof import('@/lib/fxRates')>()), useFxRates: () => fx };
});
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  createContact: svc.createContact, deleteContact: vi.fn(), updateContact: vi.fn(), getContact: vi.fn(),
  listLeadCategories: async () => [],
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({ createDeal: vi.fn(), moveDealToStage: vi.fn(), linkDealHandoff: vi.fn() }));
vi.mock('@/services/supabase/crmHub/companies', () => ({
  getCompany: vi.fn(), createCompany: vi.fn(), ensureCompaniesByName: svc.ensureCompaniesByName,
}));
vi.mock('@/services/supabase/crmHub/flow', () => ({
  convertLeadToDeal: vi.fn(), handoffDealToNewProject: vi.fn(), HandoffLinkError: class extends Error {},
}));
vi.mock('@/components/crmHub/CsvImportWizard', () => ({ CsvImportWizard: () => null }));

import { CrmContactsPage } from '@/pages/crmHub/Contacts';
import { CrmDealsPage } from '@/pages/crmHub/Deals';
import { CrmDashboardPage } from '@/pages/crmHub/Dashboard';
import { CrmTasksPage } from '@/pages/crmHub/Tasks';
import { CrmCompaniesPage } from '@/pages/crmHub/Companies';
import { CrmActivityPage } from '@/pages/crmHub/Activity';

afterEach(cleanup);

const row = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

describe('Leads list', () => {
  it('shows each lead’s step in one word', () => {
    render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
    expect(within(row('Priya Nair')).getByText('New')).toBeTruthy();
    expect(within(row('Tom Okafor')).getByText('Contacted')).toBeTruthy();
    expect(within(row('Elena Rossi')).getByText('Qualified')).toBeTruthy();
    expect(within(row('Marcus Bell')).getByText('Deal open')).toBeTruthy();
    expect(within(row('Aisha Khan')).getByText('Customer')).toBeTruthy();
    expect(within(row('Jon Petrov')).getByText('Unqualified')).toBeTruthy();
  });

  it('offers “Convert to deal” until the lead has a deal', () => {
    render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
    for (const name of ['Priya Nair', 'Tom Okafor', 'Elena Rossi']) {
      expect(within(row(name)).getByRole('button', { name: 'Convert to deal' })).toBeTruthy();
    }
    for (const name of ['Marcus Bell', 'Aisha Khan', 'Jon Petrov']) {
      expect(within(row(name)).queryByRole('button', { name: 'Convert to deal' })).toBeNull();
    }
  });

  it('counts the leads in every step', () => {
    render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
    const filters = screen.getByRole('group', { name: 'Filter by step' });
    expect(within(filters).getByRole('button', { name: /^All 6$/ })).toBeTruthy();
    expect(within(filters).getByRole('button', { name: /^Qualified 1$/ })).toBeTruthy();
  });
});

describe('New lead', () => {
  const addLead = async (company: string) => {
    svc.createContact.mockReset().mockResolvedValue({});
    svc.ensureCompaniesByName.mockReset().mockResolvedValue(
      new Map([['brightside labs', 'c-new'], ['harbour dental', 'c2']]),
    );
    render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New lead' }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Noor' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: company } });
    return screen;
  };

  it('adds a company that is not in the CRM yet and links the lead to it', async () => {
    await addLead('Brightside Labs');
    expect(screen.getByText(/new company/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
    expect(svc.ensureCompaniesByName).toHaveBeenCalledWith('o', 'w', ['Brightside Labs'], 'u1');
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ firstName: 'Noor', companyId: 'c-new' });
  });

  it('links to the company that is already there, however it is typed', async () => {
    await addLead('harbour dental');
    expect(screen.getByText(/already in the crm/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ companyId: 'c2' });
  });

  it('adds a lead without a company when none is typed', async () => {
    await addLead('');
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
    expect(svc.ensureCompaniesByName).not.toHaveBeenCalled();
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ companyId: null });
  });
});

describe('New lead: custom fields', () => {
  const openForm = () => {
    svc.createContact.mockReset().mockResolvedValue({});
    svc.ensureCompaniesByName.mockReset();
    render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New lead' }));
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Noor' } });
  };

  it('saves the fields typed into the form with the lead', async () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add custom field' }));
    fireEvent.change(screen.getByLabelText('Custom field 1 name'), { target: { value: 'Budget range' } });
    fireEvent.change(screen.getByLabelText('Custom field 1 value'), { target: { value: '£5k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ customFields: { budget_range: '£5k' } });
  });

  it('warns when the email already belongs to a lead, and adds it only when told to', async () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  Elena@Example.com ' } });
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toContain('A lead with this email is already in the CRM');
    expect(within(warning).getByRole('link', { name: 'Elena Rossi' }).getAttribute('href')).toBe('/crm/contacts/l3');

    // The first press only confirms the warning was seen.
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(svc.createContact).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalledTimes(1));
  });

  it('adds a lead straight away when the email is new, and re-checks when it is changed', async () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'elena@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(screen.getByRole('button', { name: 'Add anyway' })).toBeTruthy();
    // A different address is no longer a duplicate, and the button is the plain one again.
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'noor@example.com' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalledTimes(1));
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ email: 'noor@example.com' });
  });

  it('adds a lead with no custom fields when none are typed', async () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
    expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ customFields: {} });
  });

  it('takes a field away again', () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add custom field' }));
    fireEvent.change(screen.getByLabelText('Custom field 1 name'), { target: { value: 'Budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove custom field Budget' }));
    expect(screen.queryByLabelText('Custom field 1 name')).toBeNull();
  });

  it('does not add the lead while a value has no name', async () => {
    openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add custom field' }));
    fireEvent.change(screen.getByLabelText('Custom field 1 value'), { target: { value: '£5k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/name/i);
    expect(svc.createContact).not.toHaveBeenCalled();
  });

  it('offers the field names already used on other leads', async () => {
    const first = data.contacts[0] as { customFields: Record<string, string> };
    first.customFields = { industry: 'Dental' };
    try {
      openForm();
      fireEvent.click(screen.getByRole('button', { name: 'Add field Industry' }));
      expect((screen.getByLabelText('Custom field 1 name') as HTMLInputElement).value).toBe('Industry');
      fireEvent.change(screen.getByLabelText('Custom field 1 value'), { target: { value: 'Logistics' } });
      // A name that is on the form is not offered a second time.
      expect(screen.queryByRole('button', { name: 'Add field Industry' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
      await waitFor(() => expect(svc.createContact).toHaveBeenCalled());
      expect(svc.createContact.mock.calls[0]![0]).toMatchObject({ customFields: { industry: 'Logistics' } });
    } finally {
      first.customFields = {};
    }
  });
});

describe('Deals board', () => {
  it('forecasts with each stage’s chance of winning', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    // 4,000 × 10% + 18,000 × 25% + 12,000 × 60% = 12,100
    expect(screen.getByText('£34,000')).toBeTruthy();
    expect(screen.getByText('£12,100')).toBeTruthy();
  });

  it('flags a won deal that has no project and offers the hand-off', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    const won = screen.getByRole('region', { name: 'Won' });
    expect(within(won).getAllByRole('button', { name: 'Hand off to project' })).toHaveLength(1);
    expect(within(won).getByRole('link', { name: 'Open project' }).getAttribute('href')).toBe('/project/p1');
    expect(screen.getByText('Won, but no project yet')).toBeTruthy();
  });

  it('shows why a deal was lost', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: 'Lost' })).getByText('Lost: Went with a competitor')).toBeTruthy();
  });
});

describe('CRM overview', () => {
  it('shows the flow from lead to delivery and what is stuck in between', () => {
    render(<MemoryRouter><CrmDashboardPage /></MemoryRouter>);
    expect(screen.getByText('Waiting for hand-off')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Northwind website/ }).getAttribute('href')).toBe('/crm/deals/d4');
    expect(screen.getByText('£12,100')).toBeTruthy();
    expect(screen.getAllByText(/went with a competitor/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Call Priya back about the booking site')).toBeTruthy();
  });
});

describe('Follow-ups', () => {
  it('can be added before the workspace has any project, and flags what is overdue', () => {
    render(<MemoryRouter><CrmTasksPage /></MemoryRouter>);
    expect((screen.getByRole('button', { name: /New follow-up/ }) as HTMLButtonElement).disabled).toBe(false);
    const overdue = screen.getByText('Call Priya back about the booking site').closest('tr') as HTMLElement;
    expect(within(overdue).getByText('Overdue')).toBeTruthy();
    const upcoming = screen.getByText('Send Fieldway the revised quote').closest('tr') as HTMLElement;
    expect(within(upcoming).queryByText('Overdue')).toBeNull();
  });
});

describe('Companies and activity', () => {
  it('lists companies under the standard name', () => {
    render(<MemoryRouter><CrmCompaniesPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /New company/ })).toBeTruthy();
    expect(screen.getByText('Northwind Studio')).toBeTruthy();
  });

  it('shows the activity log in plain words', () => {
    render(<MemoryRouter><CrmActivityPage /></MemoryRouter>);
    expect(screen.getByText('Intro call with Elena')).toBeTruthy();
    expect(screen.queryByText(/deal_won|deal_lost/)).toBeNull();
  });
});
