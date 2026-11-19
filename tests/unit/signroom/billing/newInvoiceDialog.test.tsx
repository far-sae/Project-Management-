// Starting an invoice from the CRM: the company becomes the customer, the deal can start the first line.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { crmCompany, crmCurrency, crmDeal, crmList, customer, invoice, issued, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const crm = vi.hoisted(() => ({ companies: [] as unknown[], deals: [] as unknown[] }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmCompanies: () => crmList(crm.companies),
  useCrmDeals: () => crmList(crm.deals),
}));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => crmCurrency }));

import { NewInvoiceDialog } from '@/components/signroom/billing/NewInvoiceDialog';
import { InvoicesPanel } from '@/components/signroom/billing/InvoicesPanel';

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;
const inRouter = (ui: React.ReactNode) => render(
  <MemoryRouter initialEntries={['/start']}>
    <Routes>
      <Route path="/start" element={ui} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);
const calls = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path);

beforeEach(() => {
  stubBrowser();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  crm.companies = [crmCompany('co1', 'Northwind Studio'), crmCompany('co2', 'Harbour Dental')];
  crm.deals = [
    crmDeal('d1', 'Northwind website', 'co1', 9500),
    crmDeal('d2', 'Harbour booking app', 'co2', 20000, { currency: 'USD' }),
    crmDeal('d3', 'Tokyo launch', 'co1', 500000, { currency: 'JPY' }),
  ];
  sr.call.mockImplementation(async (path: string, body?: { lines?: unknown[]; currency?: string }) => {
    if (path === 'clients/from-company') return customer();
    if (path === 'billing' && body) return invoice({ id: 'new1', number: 'INV-0007' });
    if (path === 'billing/new1/save') return invoice({ id: 'new1', number: 'INV-0007', revision: 2, currency: body!.currency });
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(cleanup);

describe('New invoice dialog', () => {
  it('turns the company into the customer, creates the draft and opens it', async () => {
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} companyId="co1" />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'Company' }).textContent).toContain('Northwind Studio');
    fireEvent.click(dialog.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/crm/invoices/new1'));
    expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co1' });
    expect(sr.call).toHaveBeenCalledWith('billing', { clientId: 'c1' });
    expect(calls('billing/new1/save')).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith('INV-0007 created');
  });

  it('carries the deal, and starts the first line from its name and value', async () => {
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} companyId="co1" dealId="d1" />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'Deal (optional)' }).textContent).toContain('Northwind website');
    expect(dialog.getByText(/The invoice will be in GBP/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/crm/invoices/new1'));
    expect(sr.call).toHaveBeenCalledWith('billing', { clientId: 'c1', dealId: 'd1' });
    expect(calls('billing/new1/save')[0]![1]).toEqual({
      revision: 1,
      lines: [{ description: 'Northwind website', quantity: '1', rate: '9500.00', billingType: 'One-off', billingLabel: '', taxPercent: '0' }],
      currency: 'GBP',
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      taxPercent: '0',
      receiptDraft: null,
      project: '',
      notes: '',
    });
  });

  it('finds the company from the deal, and bills in the deal currency', async () => {
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} dealId="d2" />);
    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('combobox', { name: 'Company' }).textContent).toContain('Harbour Dental'));
    fireEvent.click(dialog.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(calls('billing/new1/save')).toHaveLength(1));
    expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co2' });
    expect(calls('billing/new1/save')[0]![1]).toMatchObject({ currency: 'USD', lines: [{ description: 'Harbour booking app', rate: '20000.00' }] });
  });

  it('leaves the deal line out when asked, and the price out when invoices cannot use the deal currency', async () => {
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} companyId="co1" dealId="d3" />);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/without a price, because invoices can't be in JPY/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Start the first line from this deal' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/crm/invoices/new1'));
    expect(sr.call).toHaveBeenCalledWith('billing', { clientId: 'c1', dealId: 'd3' });
    expect(calls('billing/new1/save')).toHaveLength(0);
  });

  it('picks a company from the list', async () => {
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} />);
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByRole('button', { name: 'Create invoice' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog.getByRole('combobox', { name: 'Company' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Harbour Dental' }), { key: 'Enter' });
    await waitFor(() => expect((dialog.getByRole('button', { name: 'Create invoice' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(dialog.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co2' }));
  });

  it('shows the server sentence and stays open when the invoice cannot be created', async () => {
    sr.call.mockImplementation(async (path: string) => {
      if (path === 'clients/from-company') return customer();
      throw new Error('Choose an existing client.');
    });
    inRouter(<NewInvoiceDialog open onOpenChange={() => {}} companyId="co1" />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Choose an existing client.'));
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

describe('Invoices panel on a company or deal page', () => {
  const list = [
    issued({ id: 'b', number: 'INV-0002', dueDate: '2099-01-10' }),
    invoice({ id: 'a', number: 'INV-0001' }),
  ];

  it('lists the company invoices with status and amounts', async () => {
    sr.call.mockImplementation(async (path: string) => (path === 'billing?companyId=co1' ? list : []));
    inRouter(<InvoicesPanel companyId="co1" />);
    const panel = within(screen.getByRole('region', { name: /^Invoices/ }));
    const link = await panel.findByRole('link', { name: 'INV-0002' });
    expect(link.getAttribute('href')).toBe('/crm/invoices/b');
    expect(panel.getByText('£18.00')).toBeTruthy();
    expect(panel.getByText('Issued')).toBeTruthy();
    expect(panel.getByText('Due 10 Jan 2099')).toBeTruthy();
    expect(panel.getByText('Draft')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledWith('billing?companyId=co1');
  });

  it('asks for the deal invoices, and starts a new one with the deal filled in', async () => {
    sr.call.mockImplementation(async (path: string) => (path === 'billing?companyId=co1&dealId=d1' ? [] : []));
    inRouter(<InvoicesPanel companyId="co1" dealId="d1" />);
    expect(await screen.findByText('No invoices for this deal yet.')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledWith('billing?companyId=co1&dealId=d1');
    fireEvent.click(screen.getByRole('button', { name: /New invoice/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: 'Company' }).textContent).toContain('Northwind Studio');
    expect(dialog.getByRole('combobox', { name: 'Deal (optional)' }).textContent).toContain('Northwind website');
  });

  it('asks for a workspace and calls nothing while none is selected', async () => {
    sr.state.workspaceId = null;
    inRouter(<InvoicesPanel companyId="co1" />);
    expect(screen.getByText('Pick a workspace in the sidebar to see its invoices.')).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
