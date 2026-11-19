// An invoice's billing plan (linked on the draft, shown once issued) and the emails sent for it.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ClientProject, Invoice } from '../../../../api/_signroom/shared/types';
import {
  crmCurrency, crmList, customer, delivery, designLine, emailDelivery, invoice, issued, plan, planYear, stubBrowser,
} from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  const pdf = vi.fn();
  // One object for the whole file: the screens keep `client` in effect dependencies.
  return { call, pdf, state: { client: { call, pdf, upload: vi.fn() }, workspaceId: 'w' as string | null } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

// The first render loads every dialog and menu: give it room on a busy machine.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crmList([]), useCrmDeals: () => crmList([]) }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => crmCurrency }));

import { InvoiceDetailPage } from '@/pages/signroom/InvoiceDetail';

type Body = Record<string, unknown>;
const PLANS_NOT_SET_UP = 'Run the latest database update to use billing plans.';

/** What the pretend server holds. */
const server = {
  invoice: invoice() as Invoice,
  /** The company's billing plans. Null stands for a server whose database update for plans has not been run. */
  plans: null as ClientProject[] | null,
  /** The emails sent for the invoice, newest first. */
  emails: [] as Array<ReturnType<typeof emailDelivery>>,
  on: {} as Record<string, (body: Body) => Invoice>,
};

const savedDraft = (over: Partial<Invoice> = {}) =>
  invoice({ revision: 2, lines: [designLine], subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800, ...over });

function serve(start: Invoice, on: Record<string, (body: Body) => Invoice> = {}) {
  server.invoice = start;
  server.on = on;
  sr.call.mockImplementation(async (path: string, body?: Body) => {
    if (path === 'clients') return [customer()];
    if (path === 'clients/from-company') return customer();
    if (path === 'billing/delivery') return delivery;
    if (path === 'billing/i1') return server.invoice;
    if (path === 'billing/i1/deliveries') return { deliveries: server.emails };
    if (path === 'client-projects/c1') {
      if (!server.plans) throw Object.assign(new Error(PLANS_NOT_SET_UP), { status: 503 });
      return { year: 2026, clientName: 'Northwind Studio', projects: server.plans.map((p) => planYear(p)) };
    }
    const action = path.replace('billing/i1/', '');
    if (server.on[action]) {
      server.invoice = server.on[action]!(body ?? {});
      return server.invoice;
    }
    throw new Error(`unexpected ${path}`);
  });
}
const open = async () => {
  render(
    <MemoryRouter initialEntries={['/crm/invoices/i1']}>
      <Routes><Route path="/crm/invoices/:id" element={<InvoiceDetailPage />} /></Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1 });
};
const bodyOf = (path: string) => sr.call.mock.calls.find((c) => c[0] === path)?.[1] as Body | undefined;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const planBox = () => screen.findByRole('combobox', { name: 'Billing plan (optional)' });
const options = async () => (await screen.findAllByRole('option')).map((o) => o.textContent);
const choose = async (box: string, name: string) => {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: box }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name }), { key: 'Enter' });
};
const saved = () => waitFor(() => expect(toast.success).toHaveBeenCalledWith('Draft saved'));

const retainer = plan();
const hosting = plan({ id: 'pl2', name: 'Hosting', monthlyFeeMinor: 2000 });
const dollars = plan({ id: 'pl3', name: 'Shop build', currency: 'USD' });
const old = plan({ id: 'pl4', name: 'Old site care', archived: true });

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  sr.pdf.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  server.plans = null;
  server.emails = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Billing plan on a draft invoice', () => {
  it('links the draft to one of the company\'s active plans in the invoice currency', async () => {
    server.plans = [retainer, hosting, dollars, old];
    serve(savedDraft(), { save: () => savedDraft({ revision: 3, projectId: 'pl2' }) });
    await open();
    expect((await planBox()).textContent).toContain('No plan');
    expect(sr.call).toHaveBeenCalledWith('client-projects/c1');
    fireEvent.keyDown(await planBox(), { key: 'ArrowDown' });
    expect(await options()).toEqual(['No plan', 'Website retainer', 'Hosting']);
    fireEvent.keyDown(screen.getByRole('option', { name: 'Hosting' }), { key: 'Enter' });
    await waitFor(async () => expect((await planBox()).textContent).toContain('Hosting'));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // An empty reference takes the plan's name, so the invoice says what it is for.
    expect((screen.getByLabelText('Reference (optional)') as HTMLInputElement).value).toBe('Hosting');

    press('Save draft');
    await saved();
    expect(bodyOf('billing/i1/save')).toEqual({
      revision: 2,
      lines: [{ description: 'Design', quantity: '1.5', rate: '10.00', billingType: 'One-off', billingLabel: '', taxPercent: '20' }],
      currency: 'GBP',
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      taxPercent: '0',
      receiptDraft: null,
      project: 'Hosting',
      projectId: 'pl2',
      notes: '',
    });
  });

  it('unlinks the draft from its plan by sending an empty plan', async () => {
    server.plans = [retainer, hosting];
    serve(savedDraft({ projectId: 'pl1', project: 'PO 1182' }), { save: () => savedDraft({ revision: 3 }) });
    await open();
    expect((await planBox()).textContent).toContain('Website retainer');
    await choose('Billing plan (optional)', 'No plan');
    await waitFor(async () => expect((await planBox()).textContent).toContain('No plan'));
    expect((screen.getByLabelText('Reference (optional)') as HTMLInputElement).value).toBe('PO 1182');
    press('Save draft');
    await saved();
    expect(bodyOf('billing/i1/save')).toMatchObject({ projectId: '', project: 'PO 1182' });
  });

  it('keeps the link when something else on the draft is changed', async () => {
    server.plans = [retainer];
    serve(savedDraft({ projectId: 'pl1' }), { save: () => savedDraft({ revision: 3, projectId: 'pl1' }) });
    await open();
    await planBox();
    type('Reference (optional)', 'PO 1182');
    press('Save draft');
    await saved();
    expect(bodyOf('billing/i1/save')).toMatchObject({ projectId: 'pl1', project: 'PO 1182' });
  });

  it('still shows a linked plan that has since been archived', async () => {
    server.plans = [retainer, old];
    serve(savedDraft({ projectId: 'pl4' }));
    await open();
    expect((await planBox()).textContent).toContain('Old site care (archived)');
    fireEvent.keyDown(await planBox(), { key: 'ArrowDown' });
    expect(await options()).toEqual(['No plan', 'Website retainer', 'Old site care (archived)']);
  });

  it('unlinks the plan, and says why, when the invoice moves to another currency', async () => {
    server.plans = [retainer, dollars];
    serve(savedDraft({ projectId: 'pl1' }));
    await open();
    expect((await planBox()).textContent).toContain('Website retainer');
    await choose('Currency', 'USD');
    expect(await screen.findByText('Website retainer is billed in GBP, so it is no longer linked to this invoice.')).toBeTruthy();
    expect((await planBox()).textContent).toContain('No plan');
    fireEvent.keyDown(await planBox(), { key: 'ArrowDown' });
    expect(await options()).toEqual(['No plan', 'Shop build']);
  });

  it('offers nothing to pick while the company has no plans, and sends no plan', async () => {
    server.plans = [];
    serve(savedDraft(), { save: () => savedDraft({ revision: 3 }) });
    await open();
    await waitFor(() => expect(sr.call).toHaveBeenCalledWith('client-projects/c1'));
    type('Reference (optional)', 'PO 1182');
    press('Save draft');
    await saved();
    expect(screen.queryByRole('combobox', { name: 'Billing plan (optional)' })).toBeNull();
    expect(screen.queryByText(/billing plan/i)).toBeNull();
    expect(bodyOf('billing/i1/save')).toMatchObject({ projectId: '' });
  });

  it('says why nothing can be linked when the company\'s plans are in another currency', async () => {
    server.plans = [dollars];
    serve(savedDraft());
    await open();
    expect(await screen.findByText('This company\'s billing plans are in USD, so a GBP invoice cannot be linked to one.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Billing plan (optional)' })).toBeNull();
  });

  it('says quietly when plans are not set up yet, and saves the draft without touching the link', async () => {
    serve(savedDraft(), { save: () => savedDraft({ revision: 3 }) });
    await open();
    const note = await screen.findByText(new RegExp(PLANS_NOT_SET_UP));
    expect(note.getAttribute('role')).toBe('status');
    expect(note.className).not.toContain('destructive');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Billing plan (optional)' })).toBeNull();
    type('Reference (optional)', 'PO 1182');
    press('Save draft');
    await saved();
    expect(JSON.parse(JSON.stringify(bodyOf('billing/i1/save')))).not.toHaveProperty('projectId');
    expect(sr.call.mock.calls.some((c) => c[0] === 'billing/i1/deliveries')).toBe(false);
  });
});

describe('Billing plan on an issued invoice', () => {
  it('shows the linked plan, opening the company it belongs to', async () => {
    server.plans = [retainer, hosting];
    serve(issued({ projectId: 'pl2', project: 'PO 1182' }));
    await open();
    const link = await screen.findByRole('link', { name: 'Hosting' });
    expect(link.getAttribute('href')).toBe('/crm/companies/co1');
    expect(link.parentElement?.textContent).toBe('Billing plan: Hosting');
    expect(sr.call).toHaveBeenCalledWith('client-projects/c1');
    expect(screen.queryByRole('combobox', { name: 'Billing plan (optional)' })).toBeNull();
  });

  it('still says the invoice is linked when the plan\'s name cannot be read', async () => {
    serve(issued({ projectId: 'pl2' }));
    await open();
    expect(await screen.findByText('Linked to a billing plan.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks for no plans when the invoice is not linked to one', async () => {
    server.plans = [retainer];
    serve(issued());
    await open();
    await screen.findByText('No emails have been sent yet.');
    expect(sr.call.mock.calls.some((c) => String(c[0]).startsWith('client-projects/'))).toBe(false);
    expect(screen.queryByText(/Billing plan/)).toBeNull();
  });
});

describe('Emails sent for an invoice', () => {
  it('lists them on the issued invoice, with where each was sent from', async () => {
    server.emails = [
      emailDelivery({ id: 'd2', subject: 'Receipt INV-0001-R01', purpose: 'receipt', route: 'securovix', status: 'failed', error: 'The address was rejected.' }),
      emailDelivery(),
    ];
    serve(issued({ sentAt: '2026-11-02T09:05:00Z' }));
    await open();
    const emails = within(await screen.findByRole('region', { name: /^Emails/ }));
    expect(sr.call).toHaveBeenCalledWith('billing/i1/deliveries');
    expect(await emails.findByText('Invoice INV-0001 from Sam Studio')).toBeTruthy();
    expect(emails.getByText('Invoice · from your mailbox')).toBeTruthy();
    expect(emails.getByText('Receipt · from TaskCalendar')).toBeTruthy();
    expect(emails.getByText('The address was rejected.')).toBeTruthy();
    expect(emails.getByText('Failed').getAttribute('data-tone')).toBe('danger');
  });

  it('reads the list again after the invoice is sent', async () => {
    serve(issued(), {
      send: () => {
        server.emails = [emailDelivery()];
        return issued({
          sentAt: '2026-11-19T12:00:00Z',
          events: [...issued().events, { at: '2026-11-19T12:00:00Z', type: 'Invoice sent', actor: 'sam@example.com' }],
        });
      },
    });
    await open();
    expect(await screen.findByText('No emails have been sent yet.')).toBeTruthy();
    press('Send invoice');
    expect(await screen.findByText('Invoice INV-0001 from Sam Studio')).toBeTruthy();
    expect(sr.call.mock.calls.filter((c) => c[0] === 'billing/i1/deliveries')).toHaveLength(2);
  });
});
