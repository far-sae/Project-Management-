// The agreements list: what each row says, the filters, the empty and no-workspace states, and the row actions.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { agreement, clientRow, crmCompanies, crmDeals, person, polyfillDom, summaryOf } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the page's loading effect for ever.
  const state = { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const crm = vi.hoisted(() => ({
  companies: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
  deals: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
}));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crm.companies, useCrmDeals: () => crm.deals }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/signroom/PdfViewer', () => ({
  default: ({ agreement: a }: { agreement?: { id: string; kind: string } }) => <div data-testid="pdf">{a?.id}:{a?.kind}</div>,
}));

import { AgreementsPage } from '@/pages/signroom/Agreements';
import { SignroomError } from '@/services/signroom/client';

const draft = agreement({ id: 'a1', title: 'NDA for Northwind Studio', dealId: 'd2' });
const awaiting = agreement({
  id: 'a2', title: 'Service agreement for Harbour Dental', type: 'Service agreement', status: 'Awaiting signatures', clientId: 'cl2',
  sentAt: '2026-11-04T09:00:00.000Z', deadline: '2026-12-01',
  participants: [person('p1', 'Priya Nair', 'priya@harbour.example', { progress: 'signed' }), person('p2', 'Sam', 'sam@example.com', { order: 2 })],
});
const completed = agreement({
  id: 'a3', title: 'Completed contract', type: 'Contract', status: 'Completed', completedAt: '2026-11-06T09:00:00.000Z',
});
const trashed = agreement({ id: 'a4', title: 'Thrown away draft', trashedAt: '2026-11-07T09:00:00.000Z' });
const signFirst = agreement({
  id: 'a5', title: 'Sign-first agreement', status: 'Awaiting signatures', senderReleasePending: true, sentAt: '2026-11-08T09:00:00.000Z',
});

let rows = [draft, awaiting, completed, trashed, signFirst];
const clients = [clientRow(), clientRow({ id: 'cl2', name: 'Harbour Dental', crmCompanyId: 'c2' })];

const serve = (overrides: Record<string, (body?: unknown) => unknown> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: unknown) => {
    if (overrides[path]) return overrides[path](body);
    if (path === 'agreements') return rows.map(summaryOf);
    if (path === 'clients') return clients;
    if (path === 'templates') return [];
    const one = rows.find((a) => path === `agreements/${a.id}`);
    if (one) return one;
    throw new SignroomError('Not found.', 404);
  });
};

const renderPage = (path = '/crm/agreements') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/crm/agreements" element={<AgreementsPage />} />
      <Route path="/crm/agreements/:id" element={<div>agreement page</div>} />
      <Route path="/crm/agreements/:id/edit" element={<div>editor page</div>} />
    </Routes>
  </MemoryRouter>,
);

const titles = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('link')[0].textContent);
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const rowOf = (title: string) => screen.getByRole('link', { name: title }).closest('tr') as HTMLElement;

beforeAll(polyfillDom);
beforeEach(() => {
  rows = [draft, awaiting, completed, trashed, signFirst];
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  crm.companies.items = crmCompanies;
  crm.deals.items = crmDeals;
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('AgreementsPage', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderPage();
    expect(screen.getByText(/Pick a workspace in the sidebar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New agreement/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Templates/ })).toBeNull();
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('links to the workspace’s templates from the header', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'NDA for Northwind Studio' });
    expect(screen.getByRole('link', { name: /Templates/ }).getAttribute('href')).toBe('/crm/templates');
  });

  it('lists active agreements with status, company, deal and progress', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'NDA for Northwind Studio' });
    expect(sr.call.mock.calls.map((c) => c[0])).toEqual(['agreements', 'clients']);
    // The trashed draft is left out of the default view.
    expect(titles()).toEqual([
      'NDA for Northwind Studio', 'Service agreement for Harbour Dental', 'Completed contract', 'Sign-first agreement',
    ]);

    const first = rowOf('NDA for Northwind Studio');
    expect(within(first).getByText('Draft').getAttribute('data-tone')).toBe('neutral');
    expect(within(first).getByRole('link', { name: 'Northwind Studio' }).getAttribute('href')).toBe('/crm/companies/c1');
    expect(within(first).getByRole('link', { name: 'Deal: Northwind rebrand' }).getAttribute('href')).toBe('/crm/deals/d2');
    expect(within(first).getByRole('link', { name: 'NDA for Northwind Studio' }).getAttribute('href')).toBe('/crm/agreements/a1/edit');
    expect(within(first).getByText('Not sent')).toBeTruthy();
    expect(within(first).getByText('Draft saved')).toBeTruthy();

    const second = rowOf('Service agreement for Harbour Dental');
    expect(within(second).getByText('Awaiting signatures').getAttribute('data-tone')).toBe('warning');
    expect(within(second).getByText('1/2 signed')).toBeTruthy();
    expect(within(second).getByText('4 Nov 2026')).toBeTruthy();
    expect(within(second).getByText('1 Dec 2026')).toBeTruthy();
    expect(within(second).getByRole('link', { name: 'Service agreement for Harbour Dental' }).getAttribute('href')).toBe('/crm/agreements/a2');

    expect(within(rowOf('Completed contract')).getByText('Completed').getAttribute('data-tone')).toBe('success');
    expect(within(rowOf('Sign-first agreement')).getByText('Not sent to company')).toBeTruthy();
  });

  it('counts every agreement in the headline figures', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    const figure = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(figure('Total agreements')).toBe('5');
    expect(figure('Awaiting signatures')).toBe('2');
    expect(figure('Completed')).toBe('1');
    expect(figure('Drafts in progress')).toBe('2');
  });

  it('filters by status from the chips', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    expect(titles()).toEqual(['Completed contract']);
    expect(screen.getByRole('button', { name: /^Completed/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Drafts/ }));
    expect(titles()).toEqual(['NDA for Northwind Studio']);
    fireEvent.click(screen.getByRole('button', { name: /^All agreements/ }));
    expect(titles()).toHaveLength(4);
  });

  it('reads the status and the view from the address', async () => {
    renderPage('/crm/agreements?status=Awaiting%20signatures');
    await screen.findByRole('link', { name: 'Sign-first agreement' });
    expect(titles()).toEqual(['Service agreement for Harbour Dental', 'Sign-first agreement']);
  });

  it('searches by company name and by recipient', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    const search = screen.getByRole('textbox', { name: 'Search agreements' });
    fireEvent.change(search, { target: { value: 'harbour' } });
    expect(titles()).toEqual(['Service agreement for Harbour Dental']);
    fireEvent.change(search, { target: { value: 'priya@harbour' } });
    expect(titles()).toEqual(['Service agreement for Harbour Dental']);
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText('No agreements match this view. Try another status, type or search.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toHaveLength(4);
  });

  it('filters by type', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    choose('Agreement type', 'Contract');
    expect(titles()).toEqual(['Completed contract']);
  });

  it('shows only trashed agreements in the Trash view, and can restore one', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    choose('Show', 'Trash');
    expect(titles()).toEqual(['Thrown away draft']);
    const row = rowOf('Thrown away draft');
    expect(within(row).getByText('In Trash')).toBeTruthy();
    // A trashed draft cannot be edited, so it opens on its own page.
    expect(within(row).getByRole('link', { name: 'Thrown away draft' }).getAttribute('href')).toBe('/crm/agreements/a4');

    serve({ 'agreements/a4/restore': () => agreement({ id: 'a4', title: 'Thrown away draft' }) });
    fireEvent.keyDown(within(row).getByRole('button', { name: 'More actions for Thrown away draft' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Document updated.'));
    expect(sr.call).toHaveBeenCalledWith('agreements/a4/restore', {});
    expect(screen.queryByRole('link', { name: 'Thrown away draft' })).toBeNull();
  });

  it('moves a document to Trash only after confirming', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'NDA for Northwind Studio' });
    serve({ 'agreements/a1/trash': () => ({ ...draft, trashedAt: '2026-11-19T10:00:00.000Z' }) });
    fireEvent.keyDown(within(link.closest('tr') as HTMLElement).getByRole('button', { name: /More actions/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('You can restore it later. Permanent removal follows the existing retention policy.')).toBeTruthy();
    expect(sr.call).not.toHaveBeenCalledWith('agreements/a1/trash', {});
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Document moved to Trash. You can restore it from the Trash filter.'));
    expect(sr.call).toHaveBeenCalledWith('agreements/a1/trash', {});
    expect(screen.queryByRole('link', { name: 'NDA for Northwind Studio' })).toBeNull();
  });

  it('does not offer Trash while signing is active, and shows the server sentence when an action is refused', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Service agreement for Harbour Dental' });
    serve({ 'agreements/a2/archive': () => { throw new SignroomError('This agreement changed in another tab. Reload it and try again.', 409); } });
    fireEvent.keyDown(within(link.closest('tr') as HTMLElement).getByRole('button', { name: /More actions/ }), { key: 'Enter' });
    expect((await screen.findByRole('menuitem', { name: 'Move to Trash' })).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This agreement changed in another tab. Reload it and try again.'));
  });

  it('gives a quick look at a draft from the full agreement', async () => {
    rows = [agreement({ id: 'a1', documentHash: undefined, pages: [], content: 'Clause one. Clause two.' })];
    renderPage();
    const link = await screen.findByRole('link', { name: 'NDA for Northwind Studio' });
    fireEvent.keyDown(within(link.closest('tr') as HTMLElement).getByRole('button', { name: /More actions/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quick look' }));
    const dialog = await screen.findByRole('dialog');
    expect(sr.call).toHaveBeenCalledWith('agreements/a1');
    expect(within(dialog).getByText('Clause one. Clause two.')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Open document details' }).getAttribute('href')).toBe('/crm/agreements/a1/edit');
  });

  it('gives a quick look at the signed PDF once completed', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Completed contract' });
    fireEvent.keyDown(within(link.closest('tr') as HTMLElement).getByRole('button', { name: /More actions/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quick look' }));
    expect((await screen.findByTestId('pdf')).textContent).toBe('a3:final');
  });

  it('invites the first agreement when there are none', async () => {
    rows = [];
    renderPage();
    expect(await screen.findByText(/No agreements yet\. Start the first one for a company/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /New agreement/ })).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server sentence when the list cannot be loaded', async () => {
    serve({ agreements: () => { throw new SignroomError('You do not have access to this workspace.', 403); } });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('opens the start dialog from New agreement', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Completed contract' });
    fireEvent.click(screen.getByRole('button', { name: /New agreement/ }));
    expect(within(await screen.findByRole('dialog')).getByText('New agreement')).toBeTruthy();
  });
});
