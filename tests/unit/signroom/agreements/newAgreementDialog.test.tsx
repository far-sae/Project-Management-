// Starting an agreement from a CRM company or deal, and the card that lists a company's or deal's agreements.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { agreement, clientRow, crmCompanies, crmDeals, person, polyfillDom, summaryOf } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
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

import { NewAgreementDialog } from '@/components/signroom/agreements/NewAgreementDialog';
import { AgreementsPanel } from '@/components/signroom/agreements/AgreementsPanel';
import { SignroomError } from '@/services/signroom/client';

const templates = [
  { id: 't1', name: 'Standard NDA', type: 'NDA', version: 1, created: '2026-10-01T00:00:00.000Z' },
  { id: 't2', name: 'Standard NDA', type: 'NDA', version: 2, created: '2026-10-05T00:00:00.000Z' },
  { id: 't3', name: 'Retainer', type: 'Service agreement', version: 1, created: '2026-10-06T00:00:00.000Z' },
];

let listed = [agreement()];
const serve = (overrides: Record<string, (body?: unknown) => unknown> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: unknown) => {
    if (overrides[path]) return overrides[path](body);
    if (path === 'templates') return templates;
    if (path === 'clients/from-company') return clientRow({ id: 'cl-' + (body as { companyId: string }).companyId });
    if (path === 'agreements' && body) return agreement({ id: 'new1', ...(body as object) });
    if (path.startsWith('agreements?')) return listed.map(summaryOf);
    throw new SignroomError('Not found.', 404);
  });
};

const Editor = () => <div>editor for {useParams().id}</div>;
const renderDialog = (props: Partial<React.ComponentProps<typeof NewAgreementDialog>> = {}) => {
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter initialEntries={['/crm/companies/c1']}>
      <Routes>
        <Route path="/crm/companies/:id" element={<NewAgreementDialog open onOpenChange={onOpenChange} {...props} />} />
        <Route path="/crm/agreements/:id/edit" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onOpenChange };
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const posted = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);

beforeAll(polyfillDom);
beforeEach(() => {
  listed = [agreement()];
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  crm.companies.items = crmCompanies;
  crm.deals.items = crmDeals;
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('NewAgreementDialog', () => {
  it('lists the seven document types', async () => {
    renderDialog();
    const types = within(screen.getByRole('radiogroup', { name: 'Document type' })).getAllByRole('radio');
    expect(types.map((t) => t.textContent?.replace(/(Keep|Define|Set out|Confirm|Bring).*/, ''))).toEqual([
      'NDA', 'Statement of work', 'Service agreement', 'Engagement letter', 'Contract', 'Agreement', 'Other agreement',
    ]);
    expect(types[0].getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('templates'));
  });

  it('cannot create until a company is chosen', () => {
    renderDialog();
    expect((screen.getByRole('button', { name: 'Create NDA' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: 'Deal (optional)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts pre-filled from a company and deal, then turns the company into the client and creates with the deal', async () => {
    renderDialog({ companyId: 'c1', dealId: 'd2' });
    expect(screen.getByRole('combobox', { name: 'Company' }).textContent).toContain('Northwind Studio');
    expect(screen.getByRole('combobox', { name: 'Deal (optional)' }).textContent).toContain('Northwind rebrand');

    fireEvent.click(screen.getByRole('button', { name: 'Create NDA' }));
    expect(await screen.findByText('editor for new1')).toBeTruthy();
    expect(posted('clients/from-company')).toEqual([{ companyId: 'c1' }]);
    expect(posted('agreements')).toEqual([{ clientId: 'cl-c1', type: 'NDA', title: undefined, templateId: undefined, dealId: 'd2' }]);
    // The client is made before the agreement that needs its id.
    const order = sr.call.mock.calls.map((c) => c[0]).filter((p) => p !== 'templates');
    expect(order).toEqual(['clients/from-company', 'agreements']);
    expect(toast.success).toHaveBeenCalledWith('Draft created');
  });

  it('fills the company in from the deal when only a deal is given', async () => {
    renderDialog({ dealId: 'd3' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Company' }).textContent).toContain('Harbour Dental'));
  });

  it('offers only the chosen company’s deals, and sends the type and title typed', async () => {
    const onCreated = vi.fn();
    renderDialog({ onCreated });
    choose('Company', 'Harbour Dental');
    fireEvent.click(screen.getByRole('combobox', { name: 'Deal (optional)' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No deal', 'Harbour booking system']);
    fireEvent.click(screen.getByRole('option', { name: 'Harbour booking system' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Service agreement/ }));
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: '  Booking system build  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Service agreement' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(posted('agreements')).toEqual([{
      clientId: 'cl-c2', type: 'Service agreement', title: 'Booking system build', templateId: undefined, dealId: 'd3',
    }]);
    // With onCreated the caller decides where to go.
    expect(screen.queryByText(/editor for/)).toBeNull();
  });

  it('forgets the deal when the company changes', async () => {
    renderDialog({ companyId: 'c1', dealId: 'd2' });
    choose('Company', 'Harbour Dental');
    expect(screen.getByRole('combobox', { name: 'Deal (optional)' }).textContent).toContain('No deal');
    fireEvent.click(screen.getByRole('button', { name: 'Create NDA' }));
    await screen.findByText('editor for new1');
    expect(posted('agreements')[0]).toMatchObject({ clientId: 'cl-c2', dealId: undefined });
  });

  it('offers only the newest template of the chosen type and creates from it', async () => {
    renderDialog({ companyId: 'c1' });
    const starting = await screen.findByRole('combobox', { name: 'Starting point' });
    fireEvent.click(starting);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Blank document · write my own terms', 'Standard NDA · v2']);
    fireEvent.click(screen.getByRole('option', { name: 'Standard NDA · v2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create NDA' }));
    await screen.findByText('editor for new1');
    expect(posted('agreements')[0]).toMatchObject({ templateId: 't2', dealId: undefined });
  });

  it('hides the starting point for a type with no template', async () => {
    renderDialog({ companyId: 'c1' });
    await screen.findByRole('combobox', { name: 'Starting point' });
    fireEvent.click(screen.getByRole('radio', { name: /^Contract/ }));
    expect(screen.queryByRole('combobox', { name: 'Starting point' })).toBeNull();
  });

  it('shows the server sentence on a refusal and stays open', async () => {
    serve({ agreements: () => { throw new SignroomError('Workspace draft limit reached.', 400); } });
    const { onOpenChange } = renderDialog({ companyId: 'c1' });
    fireEvent.click(screen.getByRole('button', { name: 'Create NDA' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Workspace draft limit reached.');
    expect(toast.error).toHaveBeenCalledWith('Workspace draft limit reached.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText(/editor for/)).toBeNull();
  });

  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderDialog({ companyId: 'c1' });
    expect(screen.getByText('Pick a workspace in the sidebar to start an agreement.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create NDA' }) as HTMLButtonElement).disabled).toBe(true);
    expect(sr.call).not.toHaveBeenCalled();
  });
});

describe('AgreementsPanel', () => {
  const renderPanel = (props: React.ComponentProps<typeof AgreementsPanel>) => render(
    <MemoryRouter initialEntries={['/crm/companies/c1']}>
      <Routes>
        <Route path="/crm/companies/:id" element={<AgreementsPanel {...props} />} />
        <Route path="/crm/agreements/:id/edit" element={<Editor />} />
      </Routes>
    </MemoryRouter>,
  );

  it('lists a company’s agreements with where each stands', async () => {
    listed = [
      agreement({ id: 'a1', title: 'NDA for Northwind Studio' }),
      agreement({
        id: 'a2', title: 'Service agreement', status: 'Awaiting signatures', updated: '2026-11-10T10:00:00.000Z',
        participants: [person('p1', 'Elena Rossi', 'elena@northwind.example', { progress: 'signed' }), person('p2', 'Sam', 'sam@example.com')],
      }),
      agreement({ id: 'a3', title: 'In the bin', trashedAt: '2026-11-11T10:00:00.000Z' }),
    ];
    renderPanel({ companyId: 'c1' });
    const sent = await screen.findByRole('link', { name: 'Service agreement' });
    expect(sr.call).toHaveBeenCalledWith('agreements?companyId=c1');
    expect(sent.getAttribute('href')).toBe('/crm/agreements/a2');
    expect(screen.getByRole('link', { name: 'NDA for Northwind Studio' }).getAttribute('href')).toBe('/crm/agreements/a1/edit');
    expect(screen.queryByRole('link', { name: 'In the bin' })).toBeNull();
    // Latest activity first.
    expect(screen.getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent)).toEqual(['Service agreement', 'NDA for Northwind Studio']);
    expect(screen.getByText('Awaiting signatures').getAttribute('data-tone')).toBe('warning');
    expect(screen.getByText(/1 of 2 signed/)).toBeTruthy();
  });

  it('lists a deal’s own agreements when given a deal', async () => {
    renderPanel({ companyId: 'c1', dealId: 'd2' });
    await screen.findByRole('link', { name: 'NDA for Northwind Studio' });
    expect(sr.call).toHaveBeenCalledWith('agreements?dealId=d2');
  });

  it('opens the start dialog pre-filled with the company and deal', async () => {
    listed = [];
    renderPanel({ companyId: 'c1', dealId: 'd2' });
    expect(await screen.findByText('No agreements yet. Start one to send for signature.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New agreement/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Company' }).textContent).toContain('Northwind Studio');
    expect(within(dialog).getByRole('combobox', { name: 'Deal (optional)' }).textContent).toContain('Northwind rebrand');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create NDA' }));
    expect(await screen.findByText('editor for new1')).toBeTruthy();
    expect(posted('agreements')[0]).toMatchObject({ clientId: 'cl-c1', dealId: 'd2' });
  });

  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderPanel({ companyId: 'c1' });
    expect(screen.getByText('Pick a workspace in the sidebar to see agreements.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New agreement/ })).toBeNull();
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('shows the server sentence when the list cannot be loaded', async () => {
    serve({ 'agreements?companyId=c1': () => { throw new SignroomError('You do not have access to this workspace.', 403); } });
    renderPanel({ companyId: 'c1' });
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this workspace.');
  });
});
