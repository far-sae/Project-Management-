// Companies: the list shows what is going on with each company, and a company's
// page is laid out as details, story and what is linked to it.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const data = vi.hoisted(() => {
  const day = (n: number) => new Date(2026, 10, n, 10, 0);
  const company = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: null, name, website: null, industry: null, type: null,
    phone: null, email: null, address: null, city: null, state: null, postalCode: null, country: null,
    linkedinUrl: null, companySize: null, annualRevenue: null, notes: null, customFields: {},
    createdAt: day(1), updatedAt: day(1), ...over,
  });
  const lead = (id: string, firstName: string, lastName: string, companyId: string, jobTitle: string, lifecycleStage = 'lead', leadStatus = 'new') => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', companyId, firstName, lastName, email: null, phone: null,
    jobTitle, lifecycleStage, leadStatus, source: null, notes: null, category: null, customFields: {},
    lastContactedAt: null, createdAt: day(1), updatedAt: day(1),
  });
  const deal = (id: string, name: string, companyId: string, status: string, value: number, over: Record<string, unknown> = {}) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', stageId: status === 'open' ? 's3' : 's5', companyId,
    contactId: null, name, value, currency: null, probability: 0, status, expectedCloseDate: null, source: null,
    notes: null, sortOrder: 0, projectId: null, closedAt: null, lostReason: null, createdAt: day(2), updatedAt: day(6), ...over,
  });
  return {
    organization: {
      organizationId: 'o',
      members: [
        { userId: 'u1', displayName: 'Sam', email: 'sam@example.com', role: 'owner', status: 'active' },
        { userId: 'u2', displayName: 'Priya Nair', email: 'priya@example.com', role: 'member', status: 'active' },
      ],
    },
    companies: [
      company('c1', 'Northwind Studio', {
        ownerId: 'u1', website: 'https://www.northwind.example', industry: 'Software', phone: '020 7946 0101',
        email: 'hello@northwind.example', address: '128 City Road', city: 'London', state: 'Greater London',
        postalCode: 'EC1V 2NX', country: 'United Kingdom', linkedinUrl: 'linkedin.com/company/northwind',
        companySize: '11-50', annualRevenue: 2400000, notes: 'Design studio. Rebuilding their site this year.',
        customFields: { account_owner_name: 'Sam Example' },
      }),
      company('c2', 'Harbour Dental', { ownerId: 'u2', industry: 'Healthcare', city: 'Leeds', country: 'United Kingdom', type: 'Partner' }),
      company('c3', 'Fieldway Logistics', { industry: 'Logistics', city: 'Hull', country: 'United Kingdom' }),
    ],
    contacts: [
      lead('l1', 'Elena', 'Rossi', 'c1', 'Marketing director', 'sales_qualified_lead', 'connected'),
      lead('l2', 'Marcus', 'Bell', 'c1', 'Founder', 'customer', 'open_deal'),
      lead('l3', 'Tom', 'Okafor', 'c3', 'Operations lead'),
    ],
    deals: [
      deal('d1', 'Northwind website', 'c1', 'won', 9500),
      deal('d2', 'Northwind rebrand', 'c1', 'open', 12000),
      deal('d3', 'Fieldway driver app', 'c3', 'open', 20000, { currency: 'USD' }),
    ],
    activities: [
      { id: 'a1', organizationId: 'o', workspaceId: 'w', userId: 'u1', type: 'deal_won', description: 'Northwind website', contactId: null, companyId: 'c1', dealId: 'd1', taskId: null, metadata: {}, createdAt: day(12) },
      { id: 'a2', organizationId: 'o', workspaceId: 'w', userId: 'u1', type: 'call', description: 'Intro call with Elena', contactId: 'l1', companyId: 'c1', dealId: null, taskId: null, metadata: {}, createdAt: day(8) },
    ],
    tasks: [
      { id: 't1', title: 'Send the rebrand proposal', companyId: 'c1', status: 'pending', priority: 'high', dueDate: new Date(2099, 0, 5), contactId: null, dealId: 'd2', projectId: null },
    ],
    notes: [
      { id: 'n1', body: 'They want to launch before spring.', companyId: 'c1', createdAt: day(9), updatedAt: day(9) },
    ],
    stages: [{ id: 's3', name: 'Proposal Sent', status: 'open' }, { id: 's5', name: 'Won', status: 'won' }],
  };
});

const svc = vi.hoisted(() => ({ createTask: vi.fn(async () => ({})), createNote: vi.fn(async () => ({})) }));
const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: async () => {} });
const forCompany = <T extends { companyId: string | null }>(rows: T[], opts?: { companyId?: string }) =>
  rows.filter((r) => r.companyId === opts?.companyId);

vi.mock('@/hooks/useCrmHub', () => ({
  useCrmCompanies: () => list(data.companies),
  useCrmContacts: () => list(data.contacts),
  useCrmDeals: () => list(data.deals),
  useCrmActivities: () => list(data.activities),
  useCrmDealStages: () => list(data.stages),
  useWorkspaceForCreate: () => 'w',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: data.organization }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({
  useCrmCurrency: () => ({
    code: 'GBP', def: { code: 'GBP', symbol: '£', label: 'British Pound' }, loading: false,
    format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`,
  }),
}));
vi.mock('@/lib/fxRates', () => ({
  useFxRates: () => ({ rates: { USD: 1, GBP: 0.5 } }),
  convertAmount: (amount: number, from: string, to: string, rates: Record<string, number>) =>
    from === to ? amount : (amount / rates[from]!) * rates[to]!,
}));
vi.mock('@/services/supabase/config', () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }) },
}));
vi.mock('@/services/supabase/crmHub/companies', () => ({
  getCompany: async (id: string) => data.companies.find((c) => c.id === id) ?? null,
  deleteCompany: vi.fn(), createCompany: vi.fn(), updateCompany: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  listContacts: async (_o: string, opts: { companyId?: string }) => forCompany(data.contacts, opts),
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({
  listDeals: async (_o: string, opts: { companyId?: string }) => forCompany(data.deals, opts),
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({
  listActivities: async (_o: string, opts: { companyId?: string }) => forCompany(data.activities, opts),
}));
vi.mock('@/services/supabase/crmHub/tasks', () => ({
  listTasks: async (_o: string, opts: { companyId?: string }) => forCompany(data.tasks, opts),
  createTask: svc.createTask,
}));
vi.mock('@/services/supabase/crmHub/notes', () => ({
  listNotes: async (_o: string, opts: { companyId?: string }) => forCompany(data.notes, opts),
  createNote: svc.createNote,
}));
vi.mock('@/components/crmHub/CsvImportWizard', () => ({ CsvImportWizard: () => null }));

import { CrmCompaniesPage } from '@/pages/crmHub/Companies';
import { CrmCompanyDetailPage } from '@/pages/crmHub/CompanyDetail';

afterEach(cleanup);

const row = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;
const openList = () => render(<MemoryRouter><CrmCompaniesPage /></MemoryRouter>);
const openCompany = async (id: string) => {
  render(
    <MemoryRouter initialEntries={[`/crm/companies/${id}`]}>
      <Routes><Route path="/crm/companies/:id" element={<CrmCompanyDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1 });
};
const card = (title: string | RegExp) => screen.getByRole('region', { name: title });

describe('Companies list', () => {
  it('shows who owns each company, what kind it is and what is open with it', () => {
    openList();
    const northwind = within(row('Northwind Studio'));
    expect(northwind.getByText('northwind.example')).toBeTruthy();
    expect(northwind.getByText('Customer')).toBeTruthy();
    expect(northwind.getByText('You')).toBeTruthy();
    expect(northwind.getByText('2')).toBeTruthy();
    expect(northwind.getByText('£12,000')).toBeTruthy();
    expect(northwind.getByText('1 deal')).toBeTruthy();
    expect(within(row('Harbour Dental')).getByText('Partner')).toBeTruthy();
    expect(within(row('Harbour Dental')).getByText('Priya Nair')).toBeTruthy();
  });

  it('adds up deals in other currencies in the company currency', () => {
    openList();
    // $20,000 at 0.5 is £10,000.
    expect(within(row('Fieldway Logistics')).getByText('£10,000')).toBeTruthy();
    expect(screen.getByText('£22,000')).toBeTruthy();
  });

  it('filters by kind of company, with a count on each', () => {
    openList();
    const filters = screen.getByRole('group', { name: 'Filter by type' });
    expect(within(filters).getByRole('button', { name: /^All 3$/ })).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: /^Prospect 1$/ }));
    expect(screen.getByRole('link', { name: 'Fieldway Logistics' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Northwind Studio' })).toBeNull();
  });

  it('searches by website as well as name', () => {
    openList();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies' }), { target: { value: 'northwind.ex' } });
    expect(screen.getByRole('link', { name: 'Northwind Studio' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Harbour Dental' })).toBeNull();
  });

  it('adds a company with the same grouped form used to edit one', () => {
    openList();
    fireEvent.click(screen.getByRole('button', { name: /New company/ }));
    const dialog = screen.getByRole('dialog');
    for (const group of ['Company', 'Contact', 'Address', 'Size', 'About']) {
      expect(within(dialog).getByRole('region', { name: group })).toBeTruthy();
    }
    expect(within(dialog).getByLabelText('Company owner')).toBeTruthy();
    expect(within(dialog).getByLabelText('LinkedIn page')).toBeTruthy();
    expect(within(dialog).getByLabelText('Postcode')).toBeTruthy();
  });
});

describe('Company page', () => {
  it('says what is known about the company on the left', async () => {
    await openCompany('c1');
    const about = within(card('About this company'));
    expect(about.getByText('northwind.example')).toBeTruthy();
    expect(about.getByText('Software')).toBeTruthy();
    expect(about.getByText('You')).toBeTruthy();
    expect(about.getByText('128 City Road')).toBeTruthy();
    expect(about.getByText('London, Greater London EC1V 2NX')).toBeTruthy();
    expect(about.getByText('11-50')).toBeTruthy();
    expect(about.getByText('£2,400,000')).toBeTruthy();
    expect(about.getByText('Account owner name')).toBeTruthy();
  });

  it('works out that a company with a won deal is a customer', async () => {
    await openCompany('c1');
    expect(within(card('About this company')).getByText('(from the deals)')).toBeTruthy();
    expect(screen.getAllByText('Customer').length).toBeGreaterThan(0);
  });

  it('sums up the pipeline and shows the latest activity in plain words', async () => {
    await openCompany('c1');
    expect(screen.getByText('£12,000', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('£9,500', { selector: 'dd' })).toBeTruthy();
    const latest = within(card('Latest activity'));
    expect(latest.getByText('Deal won')).toBeTruthy();
    expect(latest.getByText('Intro call with Elena')).toBeTruthy();
  });

  it('lists the linked leads and deals on the right, each with where it stands', async () => {
    await openCompany('c1');
    const leads = within(card(/^Leads/));
    expect(leads.getByText('Elena Rossi')).toBeTruthy();
    expect(leads.getByText('Qualified')).toBeTruthy();
    const deals = within(card(/^Deals/));
    expect(deals.getByText('Northwind rebrand')).toBeTruthy();
    expect(deals.getByText('Proposal Sent')).toBeTruthy();
    expect(deals.getByText('Not handed off yet')).toBeTruthy();
  });

  it('shows a deal in its own currency with the converted amount beside it', async () => {
    await openCompany('c3');
    const deals = within(card(/^Deals/));
    expect(deals.getByText('$20,000')).toBeTruthy();
    expect(deals.getByText('≈ £10,000')).toBeTruthy();
  });

  it('adds a follow-up for the company without leaving the page', async () => {
    await openCompany('c1');
    fireEvent.change(screen.getByRole('textbox', { name: 'New follow-up' }), { target: { value: 'Call Marcus back' } });
    fireEvent.click(within(card(/^Follow-ups/)).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(svc.createTask).toHaveBeenCalled());
    expect(svc.createTask.mock.calls[0]![0]).toMatchObject({
      organizationId: 'o', workspaceId: 'w', projectId: null, title: 'Call Marcus back', companyId: 'c1',
    });
  });

  it('keeps notes on their own tab', async () => {
    await openCompany('c1');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Notes/ }));
    expect(await screen.findByText('They want to launch before spring.')).toBeTruthy();
  });
});
