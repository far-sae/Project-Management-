// The Leads list: sorting it by a column, and doing one thing to many leads at once.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CrmCompany, CrmContact } from '@/types/crmHub';
import { BULK_CHUNK, forEachLead, nextSort, sortLeadIds, type SortableLead } from '@/lib/crmListTools';

const h = vi.hoisted(() => {
  const lead = (id: string, firstName: string, lastName: string, lifecycleStage: string, leadStatus: string, companyId: string | null, ownerId: string | null, day: number) => ({
    id, organizationId: 'o', workspaceId: 'w', ownerId, companyId, firstName, lastName,
    email: `${firstName.toLowerCase()}@example.com`, phone: null, jobTitle: null,
    lifecycleStage, leadStatus, source: 'Website', notes: null, category: null, customFields: {},
    lastContactedAt: null, createdAt: new Date(2026, 10, day), updatedAt: new Date(2026, 10, day),
  });
  return {
    contacts: [
      lead('l1', 'Priya', 'Nair', 'lead', 'new', 'c2', 'u1', 6),
      lead('l2', 'Tom', 'Okafor', 'lead', 'connected', 'c3', 'u2', 5),
      lead('l3', 'Elena', 'Rossi', 'sales_qualified_lead', 'connected', 'c1', 'u1', 4),
      lead('l4', 'Marcus', 'Bell', 'customer', 'open_deal', 'c1', null, 3),
      lead('l5', 'Jon', 'Petrov', 'lead', 'unqualified', null, 'u2', 2),
    ],
    companies: [{ id: 'c1', name: 'Northwind Studio' }, { id: 'c2', name: 'Harbour Dental' }, { id: 'c3', name: 'Fieldway Logistics' }],
    organization: {
      organizationId: 'o',
      members: [
        { userId: 'u1', displayName: 'Sam', email: 'sam@example.com', role: 'owner', status: 'active' },
        { userId: 'u2', displayName: 'Dana', email: 'dana@example.com', role: 'member', status: 'active' },
      ],
    },
    updateContact: vi.fn(),
    deleteContact: vi.fn(),
    refresh: vi.fn(async () => {}),
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: h.refresh });

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmContacts: () => list(h.contacts as unknown as CrmContact[]),
  useCrmCompanies: () => list(h.companies as unknown as CrmCompany[]),
  useCrmTags: () => list([]),
  useCrmDeals: () => list([]),
  useCrmDealStages: () => list([]),
  useCrmTasks: () => list([]),
  useCrmActivities: () => list([]),
  useContactTagsMap: () => ({ map: new Map(), refresh: async () => {} }),
  useWorkspaceForCreate: () => 'w',
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1', email: 'sam@example.com', displayName: 'Sam' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: h.organization }) }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => ({ selected: { workspaceId: 'w', name: 'Studio' } }) }));
vi.mock('@/services/supabase/crmHub/contacts', () => ({
  createContact: vi.fn(), deleteContact: h.deleteContact, updateContact: h.updateContact, getContact: vi.fn(),
  listLeadCategories: async () => [],
}));
vi.mock('@/services/supabase/crmHub/deals', () => ({ createDeal: vi.fn(), moveDealToStage: vi.fn(), linkDealHandoff: vi.fn() }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ getCompany: vi.fn(), createCompany: vi.fn(), ensureCompaniesByName: vi.fn() }));
vi.mock('@/services/supabase/crmHub/flow', () => ({
  convertLeadToDeal: vi.fn(), handoffDealToNewProject: vi.fn(), HandoffLinkError: class extends Error {},
}));
vi.mock('@/components/crmHub/CsvImportWizard', () => ({ CsvImportWizard: () => null }));
vi.mock('@/services/supabase/crmHub/activities', () => ({
  tryLogActivity: vi.fn(), logActivity: vi.fn(), listActivities: async () => [],
}));

import { CrmContactsPage } from '@/pages/crmHub/Contacts';

beforeEach(() => {
  h.updateContact.mockReset().mockResolvedValue(undefined);
  h.deleteContact.mockReset().mockResolvedValue(undefined);
  h.refresh.mockClear();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(cleanup);

describe('sorting leads', () => {
  const lead = (id: string, name: string, company: string, stepOrder: number, owner: string, day: number): SortableLead =>
    ({ id, name, company, stepOrder, owner, createdAt: new Date(2026, 10, day) });
  const LEADS = [
    lead('a', 'priya Nair', 'Harbour Dental', 0, 'Sam', 6),
    lead('b', 'Tom Okafor', '', 1, '', 5),
    lead('c', 'Elena Rossi', 'Northwind Studio', 2, 'Dana', 4),
    lead('d', 'elena Rossi', 'Fieldway Logistics', 2, 'Sam', 3),
  ];

  it('sorts by name without minding capitals, and keeps the old order for equal names', () => {
    expect(sortLeadIds(LEADS, { key: 'name', direction: 'asc' })).toEqual(['c', 'd', 'a', 'b']);
    expect(sortLeadIds(LEADS, { key: 'name', direction: 'desc' })).toEqual(['b', 'a', 'c', 'd']);
  });

  it('puts leads with nothing in the column last, whichever way the list is sorted', () => {
    expect(sortLeadIds(LEADS, { key: 'company', direction: 'asc' })).toEqual(['d', 'a', 'c', 'b']);
    expect(sortLeadIds(LEADS, { key: 'company', direction: 'desc' })).toEqual(['c', 'a', 'd', 'b']);
    expect(sortLeadIds(LEADS, { key: 'owner', direction: 'desc' }).at(-1)).toBe('b');
  });

  it('sorts by the step’s place in the flow and by the day the lead was added', () => {
    expect(sortLeadIds(LEADS, { key: 'step', direction: 'desc' })).toEqual(['c', 'd', 'b', 'a']);
    expect(sortLeadIds(LEADS, { key: 'added', direction: 'asc' })).toEqual(['d', 'c', 'b', 'a']);
  });

  it('starts a new column A to Z and turns the same column round', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort({ key: 'name', direction: 'desc' }, 'company')).toEqual({ key: 'company', direction: 'asc' });
    expect(nextSort(null, 'added')).toEqual({ key: 'added', direction: 'desc' });
  });
});

describe('doing one thing to many leads', () => {
  it('goes on after a failure and says how many worked', async () => {
    const work = vi.fn(async (id: string) => { if (id === 'b') throw new Error('refused'); });
    expect(await forEachLead(['a', 'b', 'c'], work)).toEqual({ done: 2, failed: 1 });
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('never changes more than a few leads at the same moment', async () => {
    let running = 0;
    let most = 0;
    const ids = Array.from({ length: BULK_CHUNK * 2 + 3 }, (_, i) => `lead-${i}`);
    const result = await forEachLead(ids, async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(result).toEqual({ done: ids.length, failed: 0 });
    expect(most).toBe(BULK_CHUNK);
  });
});

describe('Leads page: list tools', () => {
  const show = () => render(<MemoryRouter><CrmContactsPage /></MemoryRouter>);
  const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent);
  const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Tick ${name}` }));
  const toolbar = () => screen.getByRole('toolbar', { name: 'Selected leads' });
  const giveTo = async (who: string) => {
    fireEvent.keyDown(within(toolbar()).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: who }), { key: 'Enter' });
  };

  it('sorts by the heading that is pressed, and turns round on the second press', () => {
    show();
    expect(names()).toEqual(['Priya Nair', 'Tom Okafor', 'Elena Rossi', 'Marcus Bell', 'Jon Petrov']);
    const name = screen.getByRole('button', { name: /^Name/ });
    fireEvent.click(name);
    expect(names()).toEqual(['Elena Rossi', 'Jon Petrov', 'Marcus Bell', 'Priya Nair', 'Tom Okafor']);
    expect(name.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(name);
    expect(names()).toEqual(['Tom Okafor', 'Priya Nair', 'Marcus Bell', 'Jon Petrov', 'Elena Rossi']);
    expect(name.closest('th')?.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts by company, step and owner, with empty ones last', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Company/ }));
    expect(names()).toEqual(['Tom Okafor', 'Priya Nair', 'Elena Rossi', 'Marcus Bell', 'Jon Petrov']);
    fireEvent.click(screen.getByRole('button', { name: /^Step/ }));
    expect(names()).toEqual(['Priya Nair', 'Tom Okafor', 'Elena Rossi', 'Marcus Bell', 'Jon Petrov']);
    fireEvent.click(screen.getByRole('button', { name: /^Owner/ }));
    // Dana's leads, then Sam's, then the lead nobody owns.
    expect(names()).toEqual(['Tom Okafor', 'Jon Petrov', 'Priya Nair', 'Elena Rossi', 'Marcus Bell']);
  });

  it('shows nothing extra until a lead is ticked', () => {
    show();
    expect(screen.queryByRole('toolbar')).toBeNull();
    tick('Priya Nair');
    expect(within(toolbar()).getByText('1 selected')).toBeTruthy();
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('gives the ticked leads to one owner', async () => {
    show();
    tick('Priya Nair');
    tick('Marcus Bell');
    await giveTo('Dana');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('2 leads given to Dana'));
    expect(h.updateContact.mock.calls).toEqual([['l1', { ownerId: 'u2' }], ['l4', { ownerId: 'u2' }]]);
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('can give the ticked leads to nobody', async () => {
    show();
    tick('Tom Okafor');
    await giveTo('Nobody');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('1 lead given to nobody'));
    expect(h.updateContact.mock.calls).toEqual([['l2', { ownerId: null }]]);
  });

  it('says how many were changed when some could not be', async () => {
    h.updateContact.mockImplementation(async (id: string) => { if (id === 'l4') throw new Error('refused'); });
    show();
    tick('Priya Nair');
    tick('Marcus Bell');
    await giveTo('Dana');
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('1 of 2 leads were given to Dana. Try the rest again.'));
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it('deletes the ticked leads only after it is confirmed', async () => {
    show();
    tick('Tom Okafor');
    tick('Jon Petrov');
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
    expect(h.deleteContact).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 2 leads' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('2 leads deleted'));
    expect(h.deleteContact.mock.calls.map((c) => c[0])).toEqual(['l2', 'l5']);
    expect(h.refresh).toHaveBeenCalled();
  });

  it('ticks every lead in the list at once, and never touches a lead the filter hides', async () => {
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick every lead in the list' }));
    expect(within(toolbar()).getByText('5 selected')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by step' })).getByRole('button', { name: /^Qualified 1$/ }));
    expect(within(toolbar()).getByText('1 selected')).toBeTruthy();
    await giveTo('Dana');
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('1 lead given to Dana'));
    expect(h.updateContact.mock.calls).toEqual([['l3', { ownerId: 'u2' }]]);
  });
});
