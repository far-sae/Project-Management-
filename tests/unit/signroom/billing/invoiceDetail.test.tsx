// One invoice: the draft editor and its totals, issuing, payments and receipts, voiding and sending.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { crmCurrency, crmDeal, crmList, customer, delivery, designLine, invoice, issued, payment, stubBrowser } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  return { call, pdf, state: { client: { call, pdf, upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const crm = vi.hoisted(() => ({ deals: [] as unknown[], currency: 'GBP' }));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crmList([]), useCrmDeals: () => crmList(crm.deals) }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => ({ ...crmCurrency, code: crm.currency }) }));

import { InvoiceDetailPage } from '@/pages/signroom/InvoiceDetail';

type Body = Record<string, unknown>;
/** What the pretend server holds, and how it answers each change. */
const server = {
  invoice: invoice() as Invoice,
  customers: [customer()],
  /** What the CRM says about the company now, when it differs from the customer on the list. */
  latest: null as ReturnType<typeof customer> | null,
  delivery,
  on: {} as Record<string, (body: Body) => Invoice>,
};

const savedDraft = () => invoice({ revision: 2, lines: [designLine], subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800 });

function serve(start: Invoice, on: Record<string, (body: Body) => Invoice> = {}) {
  server.invoice = start;
  server.on = on;
  sr.call.mockImplementation(async (path: string, body?: Body) => {
    if (path === 'clients') return server.customers;
    if (path === 'clients/from-company') return server.latest ?? server.customers[0];
    if (path === 'billing/delivery') return server.delivery;
    if (path === 'billing/i1') return server.invoice;
    // Billing plans and the email log have their own tests (invoicePlanAndEmails.test.tsx). Here the
    // server has neither set up yet, which must leave everything else on the page working.
    if (path === 'billing/i1/deliveries' || path.startsWith('client-projects/')) {
      throw Object.assign(new Error('Run the latest database update to use this.'), { status: 503 });
    }
    const action = path.replace('billing/i1/', '');
    if (server.on[action]) {
      server.invoice = server.on[action]!(body ?? {});
      return server.invoice;
    }
    throw new Error(`unexpected ${path}`);
  });
  sr.pdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
}
const open = async (at = '/crm/invoices/i1') => {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes><Route path="/crm/invoices/:id" element={<InvoiceDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1 });
};
const bodyOf = (path: string) => sr.call.mock.calls.find((c) => c[0] === path)?.[1];
const paths = () => sr.call.mock.calls.map((c) => c[0] as string).filter((p) => /\/(save|issue|send|payment|void|send-receipt)$/.test(p));
const totals = () => within(screen.getByLabelText('Invoice totals'));
/** A headline figure. The strip comes before the invoice's own totals, which also say "Total". */
const stat = (label: string) => screen.getAllByText(label, { selector: 'dt' })[0]!.parentElement as HTMLElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  sr.pdf.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  crm.currency = 'GBP';
  crm.deals = [crmDeal('d1', 'Northwind website', 'co1', 9500)];
  server.customers = [customer()];
  server.latest = null;
  server.delivery = delivery;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Draft invoice', () => {
  it('says who it is for and links to the company and the deal', async () => {
    serve(invoice({ dealId: 'd1' }));
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('INV-0001');
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Draft')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Northwind Studio' }).getAttribute('href')).toBe('/crm/companies/co1');
    expect(screen.getByRole('link', { name: 'Northwind website' }).getAttribute('href')).toBe('/crm/deals/d1');
    expect(screen.getByText('elena@northwind.example')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Invoices/ }).getAttribute('href')).toBe('/crm/invoices');
  });

  it('works out the totals as the lines are typed, with tax on each line', async () => {
    serve(invoice());
    await open();
    expect(totals().getByText('Each line needs a description and quantity greater than zero.')).toBeTruthy();
    type('Description for item 1', 'Design');
    type('Quantity for item 1', '1.5');
    type('Unit price for item 1', '10.00');
    type('Tax percent for item 1', '20');
    expect(screen.getByLabelText('Total for item 1').textContent).toBe('£18.00');
    expect(totals().getByText('£15.00')).toBeTruthy();
    expect(totals().getByText('£3.00')).toBeTruthy();
    expect(totals().getByText('£18.00')).toBeTruthy();

    press(/Add line/);
    type('Description for item 2', 'Hosting');
    type('Unit price for item 2', '2.50');
    expect(totals().getByText('£17.50')).toBeTruthy();
    expect(totals().getByText('£20.50')).toBeTruthy();
    press('Remove item 2');
    expect(totals().getByText('£18.00')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove item 1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the draft with what was typed, and only then lets it be issued', async () => {
    serve(invoice(), { save: () => savedDraft() });
    await open();
    type('Description for item 1', 'Design');
    type('Quantity for item 1', '1.5');
    type('Unit price for item 1', '10.00');
    type('Tax percent for item 1', '20');
    type('Reference (optional)', 'PO 1182');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Issue invoice' }) as HTMLButtonElement).disabled).toBe(true);

    press('Save draft');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Draft saved'));
    expect(bodyOf('billing/i1/save')).toEqual({
      revision: 1,
      lines: [{ description: 'Design', quantity: '1.5', rate: '10.00', billingType: 'One-off', billingLabel: '', taxPercent: '20' }],
      currency: 'GBP',
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      taxPercent: '0',
      receiptDraft: null,
      project: 'PO 1182',
      notes: '',
    });
    expect(screen.getByText('All changes saved')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Issue invoice' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('can use one tax rate for the whole invoice instead', async () => {
    serve(savedDraft(), { save: () => savedDraft() });
    await open();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tax' }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'One tax rate for the whole invoice' }), { key: 'Enter' });
    const rate = await screen.findByLabelText('Tax rate (%)') as HTMLInputElement;
    expect(rate.value).toBe('20');
    expect(screen.queryByLabelText('Tax percent for item 1')).toBeNull();
    fireEvent.change(rate, { target: { value: '10' } });
    expect(totals().getByText('£1.50')).toBeTruthy();
    expect(totals().getByText('£16.50')).toBeTruthy();

    press('Save draft');
    await waitFor(() => expect(bodyOf('billing/i1/save')).toBeTruthy());
    expect(bodyOf('billing/i1/save')).toMatchObject({
      taxPercent: '10',
      lines: [{ description: 'Design', quantity: '1.5', rate: '10.00', billingType: 'One-off', billingLabel: '' }],
    });
  });

  it('starts a new draft in our company currency when the account has none set', async () => {
    crm.currency = 'EUR';
    serve(invoice(), { save: (body) => invoice({ revision: 2, currency: String(body.currency) }) });
    await open();
    expect(screen.getByRole('combobox', { name: 'Currency' }).textContent).toContain('EUR');
    expect(screen.getByText('Unit price (EUR)')).toBeTruthy();
    type('Description for item 1', 'Design');
    press('Save draft');
    await waitFor(() => expect(bodyOf('billing/i1/save')).toMatchObject({ currency: 'EUR' }));
  });

  it('keeps the account currency when the company has one', async () => {
    crm.currency = 'EUR';
    server.customers = [customer({ account: { currency: 'USD', paymentTermsDays: 14, reference: '', notes: '', revision: 1 } })];
    serve(invoice({ currency: 'USD' }));
    await open();
    expect(screen.getByRole('combobox', { name: 'Currency' }).textContent).toContain('USD');
  });

  it('issues after a confirmation, and the invoice becomes read-only', async () => {
    serve(savedDraft(), { issue: () => issued() });
    await open();
    press('Issue invoice');
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText(/cannot be edited afterwards/)).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Issue invoice' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invoice issued.'));
    expect(bodyOf('billing/i1/issue')).toEqual({ revision: 2, createReceipt: false, payment: undefined });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull());
    expect(screen.queryByLabelText('Description for item 1')).toBeNull();
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Issued')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send invoice' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Invoice line items' })).getByText('Design')).toBeTruthy();
  });

  it('can record a payment received as it issues, once the payment is confirmed', async () => {
    serve(savedDraft(), { issue: () => issued({ status: 'Paid', payments: [payment({ amountMinor: 1800 })] }) });
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Record a payment and create its receipt/ }));
    expect((screen.getByRole('button', { name: 'Issue invoice' }) as HTMLButtonElement).disabled).toBe(true);
    type('Payment reference', 'BACS 4471');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this payment has actually been received.' }));
    press('Issue invoice');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Issue invoice' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invoice issued and receipt created.'));
    expect(bodyOf('billing/i1/issue')).toEqual({
      revision: 2,
      createReceipt: true,
      payment: { amount: '18.00', paidOn: '2026-11-19', method: 'Bank transfer', reference: 'BACS 4471', confirmed: true },
    });
    expect(await screen.findByText('INV-0001-R01')).toBeTruthy();
  });

  it('saves, issues and sends in that order', async () => {
    serve(invoice(), {
      save: () => savedDraft(),
      issue: () => issued(),
      send: () => issued({ revision: 4, sentAt: '2026-11-19T12:00:00Z' }),
    });
    await open();
    type('Description for item 1', 'Design');
    type('Quantity for item 1', '1.5');
    type('Unit price for item 1', '10.00');
    press(/Save, issue and send/);
    const confirm = within(screen.getByRole('alertdialog'));
    expect(confirm.getByText(/emailed to elena@northwind.example/)).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Issue and send' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Email sent to elena@northwind.example.'));
    expect(paths()).toEqual(['billing/i1/save', 'billing/i1/issue', 'billing/i1/send']);
    expect(bodyOf('billing/i1/issue')).toMatchObject({ revision: 2, createReceipt: false });
    expect(bodyOf('billing/i1/send')).toEqual({});
    expect(await screen.findByRole('button', { name: 'Send invoice again' })).toBeTruthy();
  });

  it('says the invoice was issued when only the email fails', async () => {
    serve(invoice(), {
      save: () => savedDraft(),
      issue: () => issued(),
      send: () => { throw new Error('This invoice has been sent 5 times this hour. Try again in 12 minutes.'); },
    });
    await open();
    type('Description for item 1', 'Design');
    press(/Save, issue and send/);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Issue and send' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![0]).toBe(
      'The invoice was issued, but the email was not sent. Use Send invoice to try again. This invoice has been sent 5 times this hour. Try again in 12 minutes.',
    );
    expect(await screen.findByRole('button', { name: 'Send invoice' })).toBeTruthy();
  });

  it('cannot be sent while the company has no email address', async () => {
    server.customers = [customer({ email: '' })];
    serve(savedDraft());
    await open();
    expect(screen.getByText(/This company has no email address/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add one on the company page' }).getAttribute('href')).toBe('/crm/companies/co1');
    expect((screen.getByRole('button', { name: /Save, issue and send/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses an email address added in the CRM since the draft was started', async () => {
    server.customers = [customer({ email: '' })];
    server.latest = customer({ email: 'accounts@northwind.example' });
    serve(savedDraft());
    await open();
    expect(await screen.findByText('accounts@northwind.example')).toBeTruthy();
    expect(sr.call).toHaveBeenCalledWith('clients/from-company', { companyId: 'co1' });
    expect((screen.getByRole('button', { name: /Save, issue and send/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so when email is not set up, and still lets the invoice be issued', async () => {
    server.delivery = { mode: 'securovix', sender: '', ready: false };
    serve(savedDraft());
    await open();
    expect(await screen.findByText(/Sending email is not set up for this app yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Save, issue and send/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Issue invoice' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the server sentence when a save is refused, and offers to reload a stale draft', async () => {
    serve(savedDraft(), {
      save: () => { throw Object.assign(new Error('Only the current draft can be edited. Reload this invoice.'), { status: 409 }); },
    });
    await open();
    type('Description for item 1', 'Design work');
    press('Save draft');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![0]).toBe('Only the current draft can be edited. Reload this invoice.');
    expect(toast.error.mock.calls[0]![1]).toMatchObject({ action: { label: 'Reload' } });
  });

  it('previews the saved draft as a PDF', async () => {
    serve(savedDraft());
    await open();
    press('Preview PDF');
    expect(await screen.findByTitle('Invoice INV-0001 preview')).toBeTruthy();
    expect(sr.pdf).toHaveBeenCalledWith('billing/i1/preview?v=2');
    expect(screen.getByRole('link', { name: /Download PDF/ }).getAttribute('download')).toBe('INV-0001-draft.pdf');
  });
});

describe('Leaving a draft', () => {
  // The app's router builds a Request for every move. Node's Request refuses jsdom's AbortSignal, so stand in a plain one.
  class PlainRequest {
    readonly method = 'GET';
    readonly headers = new Headers();
    readonly signal: AbortSignal | null | undefined;
    constructor(readonly url: string, init?: RequestInit) { this.signal = init?.signal; }
  }
  beforeEach(() => { vi.stubGlobal('Request', PlainRequest); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const openInApp = async () => {
    const router = createMemoryRouter(
      [
        { path: '/crm/invoices/:id', element: <InvoiceDetailPage /> },
        { path: '/crm/invoices', element: <p>All invoices</p> },
      ],
      { initialEntries: ['/crm/invoices/i1'] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1 });
  };

  it('asks before unsaved changes are lost, and stays or leaves as chosen', async () => {
    serve(savedDraft());
    await openInApp();
    type('Description for item 1', 'Design work');
    fireEvent.click(screen.getByRole('link', { name: /Invoices/ }));
    const ask = within(await screen.findByRole('alertdialog'));
    expect(ask.getByText('Leave without saving?')).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((screen.getByLabelText('Description for item 1') as HTMLTextAreaElement).value).toBe('Design work');

    fireEvent.click(screen.getByRole('link', { name: /Invoices/ }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText('All invoices')).toBeTruthy();
  });

  it('does not ask when nothing has changed', async () => {
    serve(savedDraft());
    await openInApp();
    fireEvent.click(screen.getByRole('link', { name: /Invoices/ }));
    expect(await screen.findByText('All invoices')).toBeTruthy();
  });
});

describe('Issued invoice', () => {
  it('shows what is owed and when, with nothing left to edit', async () => {
    serve(issued({ dueDate: '2026-11-10', notes: 'Thank you for your business.' }));
    await open();
    expect(within(stat('Total')).getByText('£18.00')).toBeTruthy();
    expect(within(stat('Paid')).getByText('£0.00')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('£18.00').getAttribute('data-tone')).toBe('danger');
    expect(within(stat('Due')).getByText('10 Nov 2026')).toBeTruthy();
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Thank you for your business.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const activity = within(screen.getByRole('region', { name: /^Activity/ }));
    expect(activity.getByText('Invoice issued; PDF and details frozen')).toBeTruthy();
  });

  it('records a part payment: a receipt appears and the status moves to Part paid', async () => {
    serve(issued(), {
      payment: () => issued({ status: 'Part paid', revision: 4, payments: [payment({ amountMinor: 800, paidOn: '2026-11-19' })] }),
    });
    await open();
    press('Record a payment');
    const dialog = within(screen.getByRole('dialog'));
    const amount = dialog.getByLabelText('Amount received (GBP)') as HTMLInputElement;
    expect(amount.value).toBe('18.00');
    expect((dialog.getByLabelText('Payment date') as HTMLInputElement).value).toBe('2026-11-19');
    fireEvent.change(amount, { target: { value: '8.00' } });
    fireEvent.change(dialog.getByLabelText('Payment reference'), { target: { value: 'BACS 4471' } });
    const record = dialog.getByRole('button', { name: 'Record payment and create receipt' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.click(dialog.getByRole('checkbox', { name: 'I confirm this payment has actually been received.' }));
    fireEvent.click(record);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Payment recorded and receipt created.'));
    expect(bodyOf('billing/i1/payment')).toEqual({
      revision: 3, amount: '8.00', paidOn: '2026-11-19', method: 'Bank transfer', reference: 'BACS 4471',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Part paid')).toBeTruthy();
    const receipts = within(screen.getByRole('region', { name: 'Payments and receipts' }));
    expect(receipts.getByText('INV-0001-R01')).toBeTruthy();
    expect(receipts.getByText('£8.00')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('£10.00')).toBeTruthy();
    expect(within(stat('Paid')).getByText('£8.00')).toBeTruthy();
  });

  it('moves to Paid when the rest arrives, and no more payments can be recorded', async () => {
    const first = payment({ amountMinor: 800 });
    serve(issued({ status: 'Part paid', revision: 4, payments: [first] }), {
      payment: () => issued({
        status: 'Paid', revision: 5,
        payments: [first, payment({ id: 'p2', amountMinor: 1000, paidOn: '2026-11-19', receiptNumber: 'INV-0001-R02', reference: '' })],
      }),
    });
    await open();
    press('Record a payment');
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText('Amount received (GBP)') as HTMLInputElement).value).toBe('10.00');
    fireEvent.click(dialog.getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: 'Record payment and create receipt' }));

    expect(await screen.findByText('INV-0001-R02')).toBeTruthy();
    expect(bodyOf('billing/i1/payment')).toMatchObject({ revision: 4, amount: '10.00' });
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Paid')).toBeTruthy();
    expect(within(stat('Outstanding')).getByText('£0.00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record a payment' })).toBeNull();
  });

  it('keeps the payment form open and shows the server sentence when a payment is refused', async () => {
    serve(issued(), {
      payment: () => { throw new Error('Payment must be positive and no larger than the outstanding balance.'); },
    });
    await open();
    press('Record a payment');
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Amount received (GBP)'), { target: { value: '99.00' } });
    fireEvent.click(dialog.getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: 'Record payment and create receipt' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![0]).toBe('Payment must be positive and no larger than the outstanding balance.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens the payment form straight away from the list link', async () => {
    serve(issued());
    await open('/crm/invoices/i1?payment=new');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Amount received (GBP)')).toBeTruthy();
  });

  it('voids an unpaid issued invoice after a confirmation', async () => {
    serve(issued(), { void: () => issued({ status: 'Voided', revision: 4 }) });
    await open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for INV-0001' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Void this invoice/ }));
    const confirm = within(await screen.findByRole('alertdialog'));
    expect(confirm.getByText(/links already emailed stop working/)).toBeTruthy();
    fireEvent.click(confirm.getByRole('button', { name: 'Void invoice' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invoice voided.'));
    expect(bodyOf('billing/i1/void')).toEqual({ revision: 3 });
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Voided')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send invoice/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record a payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions for INV-0001' })).toBeNull();
  });

  it('does not offer to void an invoice that has a payment, or one that is paid', async () => {
    serve(issued({ status: 'Part paid', payments: [payment()] }));
    await open();
    expect(screen.queryByRole('button', { name: 'More actions for INV-0001' })).toBeNull();
    cleanup();
    serve(issued({ status: 'Paid', payments: [payment({ amountMinor: 1800 })] }));
    await open();
    expect(screen.queryByRole('button', { name: 'More actions for INV-0001' })).toBeNull();
  });

  it('sends the invoice, and a receipt, to the customer', async () => {
    const paid = issued({ status: 'Part paid', payments: [payment()] });
    serve(paid, {
      send: () => ({ ...paid, sentAt: '2026-11-19T12:00:00Z' }),
      'send-receipt': () => ({ ...paid, sentAt: '2026-11-19T12:05:00Z' }),
    });
    await open();
    expect(screen.getByText(/sent from invoices@example.com/)).toBeTruthy();
    expect(screen.getByText(/Not sent yet\./)).toBeTruthy();
    press('Send invoice');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Email sent to elena@northwind.example.'));
    expect(bodyOf('billing/i1/send')).toEqual({});
    expect(await screen.findByRole('button', { name: 'Send invoice again' })).toBeTruthy();

    press('Send receipt INV-0001-R01');
    await waitFor(() => expect(bodyOf('billing/i1/send-receipt')).toEqual({ paymentId: 'p1' }));
  });

  it('previews and downloads the invoice and receipt PDFs', async () => {
    serve(issued({ status: 'Part paid', payments: [payment()] }));
    await open();
    press('Preview PDF');
    expect(await screen.findByTitle('Invoice INV-0001')).toBeTruthy();
    expect(sr.pdf).toHaveBeenCalledWith('billing/i1/artifact');

    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    press('Download receipt INV-0001-R01');
    await waitFor(() => expect(sr.pdf).toHaveBeenCalledWith('billing/i1/artifact?payment=p1'));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    saved.mockRestore();
    press('Preview receipt INV-0001-R01');
    expect(await screen.findByTitle('Receipt INV-0001-R01')).toBeTruthy();
  });
});

describe('Invoice page states', () => {
  it('shows the server sentence when the invoice cannot be opened', async () => {
    sr.call.mockImplementation(async (path: string) => {
      if (path === 'billing/i1') throw new Error('Invoice not found.');
      return path === 'clients' ? [] : delivery;
    });
    render(
      <MemoryRouter initialEntries={['/crm/invoices/i1']}>
        <Routes><Route path="/crm/invoices/:id" element={<InvoiceDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Invoice not found.');
    expect(screen.getByRole('link', { name: 'Back to invoices' }).getAttribute('href')).toBe('/crm/invoices');
  });

  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    sr.state.workspaceId = null;
    serve(issued());
    await open();
    expect(screen.getByText('Pick a workspace in the sidebar to see this invoice.')).toBeTruthy();
    await Promise.resolve();
    expect(sr.call).not.toHaveBeenCalled();
  });
});
