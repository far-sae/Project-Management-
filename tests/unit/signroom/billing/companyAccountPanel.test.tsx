// A company's account on its CRM page: balances, how old the debt is, the statement and the billing defaults.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ClientAccount } from '../../../../api/_signroom/shared/types';
import { customer, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  return { call, state: { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));

import { CompanyAccountPanel } from '@/components/signroom/billing/CompanyAccountPanel';

const account = (over: Partial<ClientAccount> = {}): ClientAccount => ({
  asOf: '2026-11-19',
  settings: { currency: 'GBP', paymentTermsDays: 30, reference: '', notes: '', revision: 0 },
  canManage: true,
  summaries: [{
    currency: 'GBP', invoicedMinor: 5000, receivedMinor: 1000, outstandingMinor: 4000, overdueMinor: 500,
    currentMinor: 3500, days1to30: 500, days31to60: 0, days61to90: 0, over90: 0,
  }],
  entries: [
    { id: 'i1', date: '2026-11-01', kind: 'Invoice', reference: 'INV-0001', invoiceId: 'i1', invoiceNumber: 'INV-0001', currency: 'GBP', chargeMinor: 5000, paymentMinor: 0, balanceMinor: 5000 },
    { id: 'p1', date: '2026-11-10', kind: 'Payment', reference: 'INV-0001-R01', invoiceId: 'i1', invoiceNumber: 'INV-0001', currency: 'GBP', chargeMinor: 0, paymentMinor: 1000, balanceMinor: 4000 },
  ],
  opening: {},
  closing: { GBP: 4000 },
  ...over,
});

let customers = [customer()];
function serve(data = account()) {
  sr.call.mockImplementation(async (path: string, body?: object, method?: string) => {
    if (path === 'clients') return customers;
    if (path === 'clients/from-company') { customers = [customer()]; return customer(); }
    if (path.startsWith('client-accounts/c1?')) return data;
    if (path === 'client-accounts/c1' && method === 'PATCH') return { ...body, revision: 1 };
    throw new Error(`unexpected ${path}`);
  });
}
const open = () => render(<MemoryRouter><CompanyAccountPanel companyId="co1" /></MemoryRouter>);
const stat = (label: string) => screen.getAllByText(label, { selector: 'dt' })[0]!.parentElement as HTMLElement;
const readBlob = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

beforeEach(() => {
  stubBrowser();
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  customers = [customer()];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Company account', () => {
  it('shows the balances, how old the debt is and the statement with its running balance', async () => {
    serve();
    open();
    await screen.findByText('Closing balance (GBP)');
    expect(sr.call).toHaveBeenCalledWith('client-accounts/c1?from=&to=');
    expect(within(stat('Invoiced')).getByText('£50.00')).toBeTruthy();
    expect(within(stat('Received')).getByText('£10.00')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('£40.00')).toBeTruthy();
    expect(within(stat('Overdue')).getByText('£5.00').getAttribute('data-tone')).toBe('danger');

    const ageing = within(screen.getByRole('region', { name: 'Unpaid balance by age' }));
    expect(screen.getByText('19 Nov 2026')).toBeTruthy();
    expect(ageing.getByText('£35.00')).toBeTruthy();
    expect(ageing.getByText('£5.00')).toBeTruthy();

    const statement = within(screen.getByRole('region', { name: 'Statement' }));
    const charge = within(statement.getByText('1 Nov 2026').closest('tr') as HTMLElement);
    expect(charge.getByText('Invoice')).toBeTruthy();
    expect(charge.getAllByText('£50.00')).toHaveLength(2);
    expect(charge.getByRole('link', { name: 'INV-0001' }).getAttribute('href')).toBe('/crm/invoices/i1');
    const paid = within(statement.getByText('10 Nov 2026').closest('tr') as HTMLElement);
    expect(paid.getByText('Payment')).toBeTruthy();
    expect(paid.getByText('£10.00')).toBeTruthy();
    expect(paid.getByText('£40.00')).toBeTruthy();
    expect(screen.getByText('Closing balance (GBP)').nextElementSibling?.textContent).toBe('£40.00');
  });

  it('asks the server again for the dates chosen, and shows the opening balance', async () => {
    serve(account({ opening: { GBP: 1200 } }));
    open();
    await screen.findByText('Closing balance (GBP)');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-05' } });
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('client-accounts/c1?from=2026-11-05&to='));
    const opening = within(screen.getByText('Opening balance').closest('tr') as HTMLElement);
    expect(opening.getByText('5 Nov 2026')).toBeTruthy();
    expect(opening.getByText('£12.00')).toBeTruthy();
  });

  it('saves the account settings only once something has changed', async () => {
    serve();
    open();
    const save = await screen.findByRole('button', { name: 'Save account settings' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Days to pay'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('Account reference'), { target: { value: 'NW-001' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(
      'Account settings saved. New invoices will use these payment terms and currency.',
    ));
    expect(sr.call).toHaveBeenCalledWith(
      'client-accounts/c1',
      { currency: 'GBP', paymentTermsDays: 14, reference: 'NW-001', notes: '', revision: 0 },
      'PATCH',
    );
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it('locks the settings for someone who cannot manage them', async () => {
    serve(account({ canManage: false }));
    open();
    expect(await screen.findByText('Only a workspace owner can change these settings.')).toBeTruthy();
    expect((screen.getByLabelText('Days to pay') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save account settings' })).toBeNull();
  });

  it('shows the server sentence when settings are refused', async () => {
    serve();
    open();
    await screen.findByText('Closing balance (GBP)');
    sr.call.mockRejectedValueOnce(new Error('Account settings changed. Reload before saving.'));
    fireEvent.change(screen.getByLabelText('Days to pay'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save account settings' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Account settings changed. Reload before saving.'));
    expect((screen.getByRole('button', { name: 'Save account settings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('exports the statement, guarding anything a spreadsheet would run as a formula', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    serve(account({
      entries: [{ id: 'i1', date: '2026-11-01', kind: 'Invoice', reference: '@SUM(A1)', invoiceId: 'i1', invoiceNumber: 'INV-0001', currency: 'GBP', chargeMinor: 5000, paymentMinor: 0, balanceMinor: 5000 }],
    }));
    open();
    await screen.findByText('Closing balance (GBP)');
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(click).toHaveBeenCalled();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    const text = await readBlob(blob);
    expect(text).toContain('"Company","Northwind Studio"');
    expect(text).toContain('"2026-11-01","Invoice","\'@SUM(A1)","INV-0001","GBP","50.00","0.00","50.00"');
  });

  it('has nothing to show before the first invoice, and can still set the defaults', async () => {
    customers = [];
    serve();
    open();
    expect(await screen.findByText(/Nothing has been invoiced to this company yet/)).toBeTruthy();
    expect(sr.call.mock.calls.some((c) => String(c[0]).startsWith('client-accounts/'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Set currency and payment terms' }));
    expect(await screen.findByLabelText('Days to pay')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co1' });
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    serve();
    open();
    expect(screen.getByText("Pick a workspace in the sidebar to see this company's account.")).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
