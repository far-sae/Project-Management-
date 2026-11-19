// The deal page: where the deal is, the next step, and the hand-off to a project.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => {
  const now = new Date('2026-11-18T10:00:00Z');
  const stage = (id: string, name: string, sortOrder: number, probability: number, status = 'open') =>
    ({ id, name, sortOrder, probability, status, organizationId: 'o', workspaceId: 'w' });
  return {
    now,
    deal: null as Record<string, unknown> | null,
    base: {
      id: 'd4', organizationId: 'o', workspaceId: 'w', ownerId: 'u1', name: 'Northwind website', stageId: 's3',
      value: 9500, probability: 0, status: 'open', companyId: 'c1', contactId: 'l4', expectedCloseDate: '2026-12-15',
      source: 'Referral', notes: 'Wants to launch before March.', projectId: null, closedAt: null, lostReason: null,
      createdAt: now, updatedAt: now,
    },
    stages: [
      stage('s1', 'New Lead', 1, 10), stage('s2', 'Qualified', 2, 25), stage('s3', 'Proposal Sent', 3, 60),
      stage('s4', 'Negotiation', 4, 80), stage('s5', 'Won', 5, 100, 'won'), stage('s6', 'Lost', 6, 0, 'lost'),
    ],
    moveDealToStage: vi.fn(),
    updateDeal: vi.fn(),
    // The company works in pounds. 1 USD = 0.8 GBP.
    currency: { code: 'GBP', format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}` },
    fx: { rates: { USD: 1, GBP: 0.8 } as Record<string, number>, usingFallback: false, fetchedAt: 1 },
  };
});

vi.mock('@/services/supabase/config', () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }) },
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({
  getDeal: async () => h.deal, updateDeal: h.updateDeal, deleteDeal: vi.fn(), linkDealHandoff: vi.fn(),
  moveDealToStage: h.moveDealToStage,
}));
vi.mock('@/services/supabase/crmHub/companies', () => ({ getCompany: async () => ({ id: 'c1', name: 'Northwind Studio' }) }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  getContact: async () => ({ id: 'l4', firstName: 'Marcus', lastName: 'Bell', email: 'marcus@example.com' }),
}));
vi.mock('@/services/supabase/crmHub/dealStages', () => ({ listDealStages: async () => h.stages }));
vi.mock('@/services/supabase/crmHub/activities', () => ({
  listActivities: async () => [
    { id: 'a1', type: 'deal_stage_changed', description: 'Moved to Proposal Sent', createdAt: h.now },
    { id: 'a2', type: 'deal_created', description: 'Northwind website', createdAt: h.now },
  ],
}));
vi.mock('@/services/supabase/crmHub/notes', () => ({
  listNotes: async () => [{ id: 'n1', body: 'Sent the proposal. They will decide by Friday.', createdAt: h.now }],
  createNote: vi.fn(),
}));
vi.mock('@/services/supabase/crmHub/tasks', () => ({
  listTasks: async () => [{ id: 't1', title: 'Call Marcus about the proposal', dueDate: h.now, status: 'pending' }],
}));
vi.mock('@/services/supabase/crmHub/flow', () => ({
  handoffDealToNewProject: vi.fn(), HandoffLinkError: class extends Error {},
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'o' } }) }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => h.currency }));
vi.mock('@/lib/fxRates', async (original) => ({
  ...(await original<typeof import('@/lib/fxRates')>()),
  useFxRates: () => h.fx,
}));
// The real picker is a pop-up list; a plain list is enough to choose from here.
vi.mock('@/components/ui/currency-select', () => ({
  CurrencySelect: (p: { id?: string; value: string; onValueChange: (v: string) => void; disabled?: boolean; placeholder?: string }) => (
    <select id={p.id} value={p.value} disabled={p.disabled} onChange={(e) => p.onValueChange(e.target.value)}>
      <option value="">{p.placeholder}</option>
      {['USD', 'EUR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ selected: { workspaceId: 'w', name: 'Studio' } }) }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => ({ projects: [], loading: false }) }));

import { CrmDealDetailPage } from '@/pages/crmHub/DealDetail';

const show = async (over: Record<string, unknown> = {}) => {
  h.deal = { ...h.base, ...over };
  render(
    <MemoryRouter initialEntries={['/crm/deals/d4']}>
      <Routes><Route path="/crm/deals/:id" element={<CrmDealDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: /Northwind website/ });
};

beforeEach(() => {
  h.moveDealToStage.mockReset();
  h.updateDeal.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('deal page', () => {
  it('shows an open deal’s stage, chance and forecast, with Won and Lost one click away', async () => {
    await show();
    const pipeline = screen.getByRole('navigation', { name: 'Pipeline stage' });
    expect(within(pipeline).getByRole('button', { name: /Proposal Sent/ }).getAttribute('aria-current')).toBe('step');
    const details = screen.getByRole('heading', { name: 'Details' }).closest('section') as HTMLElement;
    expect(within(details).getByText('60%')).toBeTruthy();
    expect(within(details).getByText('£5,700')).toBeTruthy();
    // One in the stage bar, one as the header shortcut.
    expect(screen.getAllByRole('button', { name: 'Won' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Lost' })).toHaveLength(2);
  });

  it('moves the deal when a stage is clicked', async () => {
    h.moveDealToStage.mockResolvedValue({ ...h.base, stageId: 's4' });
    await show();
    fireEvent.click(screen.getByRole('button', { name: /Negotiation/ }));
    await waitFor(() => expect(h.moveDealToStage).toHaveBeenCalledTimes(1));
    expect(h.moveDealToStage.mock.calls[0].slice(0, 3)).toEqual(['d4', 's4', 'open']);
    expect(h.moveDealToStage.mock.calls[0][4]).toMatchObject({ probability: 80 });
  });

  it('says a won deal is not finished until it is handed off, and prepares the project', async () => {
    await show({ status: 'won', stageId: 's5', closedAt: h.now });
    expect(screen.getByText('Won, but not handed off yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Won' })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Hand off to project' })[0]);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect((within(dialog).getByLabelText('Project name') as HTMLInputElement).value).toBe('Northwind Studio – Northwind website'),
    );
    const brief = (within(dialog).getByLabelText('Brief for the team') as HTMLTextAreaElement).value;
    expect(brief).toContain('Value: £9,500');
    expect(brief).toContain('Contact: Marcus Bell (marcus@example.com)');
    expect(brief).toContain('Wants to launch before March.');
    expect((within(dialog).getAllByLabelText('Task title')[0] as HTMLInputElement).value).toBe('Kick-off call with Marcus Bell');
    expect(within(dialog).getAllByLabelText('Task title')).toHaveLength(5);
  });

  it('links to the project once the deal is handed off', async () => {
    await show({ status: 'won', stageId: 's5', closedAt: h.now, projectId: 'p1' });
    expect(screen.queryByText('Won, but not handed off yet')).toBeNull();
    expect(screen.getByRole('button', { name: /Open project/ })).toBeTruthy();
    expect(screen.getByText('Won · in delivery')).toBeTruthy();
  });

  it('shows why a deal was lost', async () => {
    await show({ status: 'lost', stageId: 's6', closedAt: h.now, lostReason: 'No budget' });
    expect(screen.getByText(/No budget/)).toBeTruthy();
  });
});

describe('a deal in another currency', () => {
  it('shows the value in the deal’s currency with the company amount beside it', async () => {
    await show({ value: 10000, currency: 'USD' });
    // Once under the title, once in the details.
    expect(screen.getAllByText('$10,000')).toHaveLength(2);
    expect(screen.getAllByText('≈ £8,000')).toHaveLength(2);
    const details = screen.getByRole('heading', { name: 'Details' }).closest('section') as HTMLElement;
    expect(within(details).getByText('$10,000')).toBeTruthy();
    expect(within(details).getByText('≈ £8,000')).toBeTruthy();
  });

  it('forecasts in the company currency', async () => {
    await show({ value: 10000, currency: 'USD' });
    const details = screen.getByRole('heading', { name: 'Details' }).closest('section') as HTMLElement;
    // $10,000 is £8,000, at the stage's 60%.
    expect(within(details).getByText('£4,800')).toBeTruthy();
  });

  it('shows no second amount for a deal in the company currency', async () => {
    await show();
    expect(screen.getAllByText('£9,500')).toHaveLength(2);
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it('tells the delivery team the value in the deal’s own currency', async () => {
    await show({ status: 'won', stageId: 's5', closedAt: h.now, value: 10000, currency: 'USD' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Hand off to project' })[0]);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect((within(dialog).getByLabelText('Brief for the team') as HTMLTextAreaElement).value).toContain('Value: $10,000'),
    );
  });
});

describe('editing a deal', () => {
  const edit = async (over: Record<string, unknown> = {}) => {
    await show(over);
    fireEvent.click(screen.getByRole('button', { name: 'Edit deal' }));
    return screen.findByRole('dialog');
  };

  it('starts on the deal’s own currency, or the company currency when it has none', async () => {
    const dialog = await edit();
    expect((within(dialog).getByLabelText('Currency') as HTMLSelectElement).value).toBe('GBP');
    cleanup();
    const dollars = await edit({ currency: 'USD' });
    expect((within(dollars).getByLabelText('Currency') as HTMLSelectElement).value).toBe('USD');
  });

  it('saves a new currency', async () => {
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '12000' } });
    fireEvent.change(within(dialog).getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateDeal).toHaveBeenCalledTimes(1));
    expect(h.updateDeal.mock.calls[0]![0]).toBe('d4');
    expect(h.updateDeal.mock.calls[0]![1]).toMatchObject({ value: 12000, currency: 'USD' });
  });

  it('leaves the currency alone when it was not changed', async () => {
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText('Value'), { target: { value: '12000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.updateDeal).toHaveBeenCalledTimes(1));
    expect(h.updateDeal.mock.calls[0]![1]).toMatchObject({ value: 12000 });
    expect(h.updateDeal.mock.calls[0]![1]).not.toHaveProperty('currency');
  });
});
