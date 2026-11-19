// Deals in their own currency: each deal shows its own money, every total is in the company currency.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CrmCompany, CrmContact, CrmDeal, CrmDealStage } from '@/types/crmHub';

const data = vi.hoisted(() => {
  const now = new Date();
  const stage = (id: string, name: string, sortOrder: number, probability: number, status = 'open') =>
    ({ id, name, sortOrder, probability, status, organizationId: 'o', workspaceId: 'w' });
  const deal = (
    id: string, name: string, stageId: string, value: number, currency: string | null, status: string,
    projectId: string | null, extra: Record<string, unknown> = {},
  ) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', name, stageId, value, currency, probability: 0, status,
    companyId: 'c1', contactId: 'l1', expectedCloseDate: '2026-12-15', source: null, notes: null, projectId,
    closedAt: status === 'open' ? null : now, lostReason: null, createdAt: now, updatedAt: now, ...extra,
  });
  return {
    // The company works in pounds. 1 USD = 0.8 GBP = 0.9 EUR.
    currency: {
      code: 'GBP', def: { code: 'GBP', symbol: '£', label: 'British Pound' }, loading: false,
      format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`,
    },
    fx: { rates: { USD: 1, GBP: 0.8, EUR: 0.9 } as Record<string, number>, usingFallback: false, fetchedAt: 1 },
    stages: [
      stage('s1', 'New Lead', 1, 10), stage('s2', 'Qualified', 2, 25),
      stage('s5', 'Won', 5, 100, 'won'), stage('s6', 'Lost', 6, 0, 'lost'),
    ],
    companies: [{ id: 'c1', name: 'Northwind Studio' }, { id: 'c2', name: 'Harbour Dental' }],
    contacts: [{
      id: 'l1', organizationId: 'o', workspaceId: 'w', companyId: 'c1', firstName: 'Marcus', lastName: 'Bell',
      email: 'marcus@example.com', lifecycleStage: 'opportunity', leadStatus: 'open_deal', source: 'Website',
    }],
    deals: [
      deal('d1', 'Harbour Dental booking site', 's1', 4000, null, 'open', null, { companyId: 'c2' }),
      deal('d2', 'Fieldway driver app', 's2', 10000, 'USD', 'open', null),
      deal('d3', 'Northwind rebrand', 's2', 2000, 'GBP', 'open', null),
      deal('d4', 'Northwind website', 's5', 5000, 'USD', 'won', null),
      deal('d5', 'Harbour Dental SEO retainer', 's5', 6000, null, 'won', 'p1', { companyId: 'c2' }),
    ],
  };
});

const svc = vi.hoisted(() => ({ createDeal: vi.fn(), convertLeadToDeal: vi.fn() }));

const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: async () => {} });

vi.mock('@/hooks/useCrmHub', () => ({
  useCrmDeals: () => list(data.deals as unknown as CrmDeal[]),
  useCrmDealStages: () => list(data.stages as unknown as CrmDealStage[]),
  useCrmContacts: () => list(data.contacts as unknown as CrmContact[]),
  useCrmCompanies: () => list(data.companies as unknown as CrmCompany[]),
  useCrmTasks: () => list([]),
  useCrmActivities: () => list([]),
  useWorkspaceForCreate: () => 'w',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'o' } }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => data.currency }));
vi.mock('@/lib/fxRates', async (original) => ({
  ...(await original<typeof import('@/lib/fxRates')>()),
  useFxRates: () => data.fx,
}));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ selected: { workspaceId: 'w', name: 'Studio' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: [], loading: false }) }));
vi.mock('@/services/supabase/crmHub/deals', () => ({
  createDeal: svc.createDeal, moveDealToStage: vi.fn(), linkDealHandoff: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/companies', () => ({ getCompany: vi.fn(async () => null), createCompany: vi.fn() }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ getContact: vi.fn(async () => null), updateContact: vi.fn() }));
vi.mock('@/services/supabase/crmHub/flow', () => ({
  convertLeadToDeal: svc.convertLeadToDeal, handoffDealToNewProject: vi.fn(), HandoffLinkError: class extends Error {},
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// The real picker is a pop-up list; a plain list is enough to choose from here.
vi.mock('@/components/ui/currency-select', () => ({
  CurrencySelect: (p: { id?: string; value: string; onValueChange: (v: string) => void; disabled?: boolean; placeholder?: string }) => (
    <select id={p.id} value={p.value} disabled={p.disabled} onChange={(e) => p.onValueChange(e.target.value)}>
      <option value="">{p.placeholder}</option>
      {['USD', 'EUR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  ),
}));

import { CrmDealsPage } from '@/pages/crmHub/Deals';
import { CrmDashboardPage } from '@/pages/crmHub/Dashboard';
import { ConvertLeadDialog } from '@/components/crmHub/ConvertLeadDialog';

beforeEach(() => {
  svc.createDeal.mockReset().mockImplementation(async (input: Record<string, unknown>) => ({
    id: 'd-new', status: 'open', projectId: null, ...input,
  }));
  svc.convertLeadToDeal.mockReset().mockResolvedValue({ deal: { id: 'd-new' }, companyId: 'c1' });
});
afterEach(cleanup);

const column = (name: string) => screen.getByRole('region', { name });
const card = (name: string) => screen.getByRole('link', { name }).parentElement as HTMLElement;
/** The headline figure with this label in the strip at the top of a page. */
const figure = (label: string) =>
  (screen.getAllByText(label).find((el) => el.tagName === 'DT')!.parentElement as HTMLElement).querySelector('dd')?.textContent;

describe('Deals board', () => {
  it('shows each deal in its own currency, with the company amount beside a foreign one', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    const dollars = card('Fieldway driver app');
    expect(within(dollars).getByText('$10,000')).toBeTruthy();
    expect(within(dollars).getByText('≈ £8,000')).toBeTruthy();

    const pounds = card('Northwind rebrand');
    expect(within(pounds).getByText('£2,000')).toBeTruthy();
    expect(within(pounds).queryByText(/≈/)).toBeNull();

    // A deal with no currency of its own is in the company currency.
    const plain = card('Harbour Dental booking site');
    expect(within(plain).getByText('£4,000')).toBeTruthy();
    expect(within(plain).queryByText(/≈/)).toBeNull();
  });

  it('adds each column up in the company currency', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    // $10,000 is £8,000, plus £2,000.
    expect(within(column('Qualified')).getByText('£10,000')).toBeTruthy();
    // $5,000 is £4,000, plus £6,000.
    expect(within(column('Won')).getByText('£10,000')).toBeTruthy();
    expect(within(column('Lost')).getByText('£0')).toBeTruthy();
  });

  it('works out the pipeline, the forecast and what was won in the company currency', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    // £4,000 + £8,000 + £2,000
    expect(figure('Open pipeline')).toBe('£14,000');
    // £4,000 × 10% + £8,000 × 25% + £2,000 × 25%
    expect(figure('Forecast')).toBe('£2,900');
    expect(figure('Won')).toBe('£10,000');
  });

  it('shows the same in the list view', () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List' }));
    const dollars = screen.getByRole('link', { name: 'Fieldway driver app' }).closest('tr') as HTMLElement;
    expect(within(dollars).getByText('$10,000')).toBeTruthy();
    expect(within(dollars).getByText('≈ £8,000')).toBeTruthy();
    const pounds = screen.getByRole('link', { name: 'Northwind rebrand' }).closest('tr') as HTMLElement;
    expect(within(pounds).getByText('£2,000')).toBeTruthy();
    expect(within(pounds).queryByText(/≈/)).toBeNull();
  });
});

describe('New deal', () => {
  const open = () => {
    render(<MemoryRouter><CrmDealsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /New deal/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Deal name'), { target: { value: 'Harbour Dental app' } });
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '12000' } });
    return dialog;
  };

  it('starts in the company currency', async () => {
    const dialog = open();
    expect((within(dialog).getByLabelText('Currency') as HTMLSelectElement).value).toBe('GBP');
    fireEvent.click(within(dialog).getByRole('button', { name: /Create deal/ }));
    await waitFor(() => expect(svc.createDeal).toHaveBeenCalledTimes(1));
    expect(svc.createDeal.mock.calls[0]![0]).toMatchObject({ name: 'Harbour Dental app', value: 12000, currency: 'GBP' });
  });

  it('saves the deal in the currency that was picked', async () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create deal/ }));
    await waitFor(() => expect(svc.createDeal).toHaveBeenCalledTimes(1));
    expect(svc.createDeal.mock.calls[0]![0]).toMatchObject({ value: 12000, currency: 'USD' });
  });

  it('keeps a company currency that is not in the list', async () => {
    data.currency.code = 'PKR';
    try {
      const dialog = open();
      const picker = within(dialog).getByLabelText('Currency') as HTMLSelectElement;
      // Nothing in the list is chosen; the company currency shows in its place.
      expect(picker.value).toBe('');
      expect(picker.selectedOptions[0]?.textContent).toBe('PKR');
      fireEvent.click(within(dialog).getByRole('button', { name: /Create deal/ }));
      await waitFor(() => expect(svc.createDeal).toHaveBeenCalledTimes(1));
      expect(svc.createDeal.mock.calls[0]![0]).toMatchObject({ currency: 'PKR' });
    } finally {
      data.currency.code = 'GBP';
    }
  });

  it('goes back to the company currency the next time it is opened', async () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create deal/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /New deal/ }));
    expect((within(screen.getByRole('dialog')).getByLabelText('Currency') as HTMLSelectElement).value).toBe('GBP');
  });
});

describe('Convert a lead to a deal', () => {
  const lead = data.contacts[0] as unknown as CrmContact;
  const open = () => {
    render(
      <MemoryRouter>
        <ConvertLeadDialog
          lead={lead}
          stages={data.stages as unknown as CrmDealStage[]}
          companies={data.companies as unknown as CrmCompany[]}
          open
          onOpenChange={() => {}}
        />
      </MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '7500' } });
    return dialog;
  };

  it('opens the deal in the company currency unless another is picked', async () => {
    const dialog = open();
    expect((within(dialog).getByLabelText('Currency') as HTMLSelectElement).value).toBe('GBP');
    fireEvent.click(within(dialog).getByRole('button', { name: /Convert to deal/ }));
    await waitFor(() => expect(svc.convertLeadToDeal).toHaveBeenCalledTimes(1));
    expect(svc.convertLeadToDeal.mock.calls[0]![0]).toMatchObject({ value: 7500, currency: 'GBP' });
  });

  it('opens the deal in the currency that was picked', async () => {
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText('Currency'), { target: { value: 'EUR' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Convert to deal/ }));
    await waitFor(() => expect(svc.convertLeadToDeal).toHaveBeenCalledTimes(1));
    expect(svc.convertLeadToDeal.mock.calls[0]![0]).toMatchObject({ value: 7500, currency: 'EUR' });
  });
});

describe('CRM overview', () => {
  it('adds every figure up in the company currency', () => {
    render(<MemoryRouter><CrmDashboardPage /></MemoryRouter>);
    expect(figure('Open pipeline')).toBe('£14,000');
    expect(figure('Forecast')).toBe('£2,900');
    expect(figure('Won this month')).toBe('£10,000');
    expect(screen.getByText('£14,000 in the pipeline')).toBeTruthy();
  });

  it('breaks the pipeline down by stage in the company currency', () => {
    render(<MemoryRouter><CrmDashboardPage /></MemoryRouter>);
    const qualified = screen.getByRole('rowheader', { name: 'Qualified' }).closest('tr') as HTMLElement;
    expect(within(qualified).getByText('£10,000')).toBeTruthy();
    expect(within(qualified).getByText('£2,500')).toBeTruthy();
    // £10,000 of the £14,000 that is open.
    expect(within(qualified).getByText('71%')).toBeTruthy();
  });

  it('shows a deal waiting for hand-off in its own currency', () => {
    render(<MemoryRouter><CrmDashboardPage /></MemoryRouter>);
    const waiting = screen.getByRole('link', { name: /Northwind website/ });
    expect(within(waiting).getByText('$5,000')).toBeTruthy();
    expect(within(waiting).getByText('≈ £4,000')).toBeTruthy();
  });
});
