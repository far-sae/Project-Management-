// Made-up invoices, customers and CRM records for the invoice screen tests.
import { vi } from 'vitest';
import { projectYear } from '../../../../api/_signroom/shared/accounts';
import type {
  Client, ClientProject, Invoice, InvoiceLine, OverviewRow, Payment, ProjectYear, Workspace,
} from '../../../../api/_signroom/shared/types';

export const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1', workspaceId: 'w', clientId: 'c1', createdBy: 'u1', revision: 1, status: 'Draft', number: 'INV-0001',
  currency: 'GBP', issueDate: '2026-11-01', dueDate: '2026-12-01', lines: [], taxBps: 0, subtotalMinor: 0,
  taxMinor: 0, totalMinor: 0, notes: '', created: '2026-11-01T00:00:00Z', updated: '2026-11-01T00:00:00Z',
  payments: [], events: [{ at: '2026-11-01T09:00:00Z', type: 'Draft created', actor: 'sam@example.com' }], ...over,
});

/** One line of design work: 1.5 at £10.00 with 20% tax on the line. £15.00 + £3.00 = £18.00. */
export const designLine: InvoiceLine = {
  description: 'Design', quantityMilli: 1500, rateMinor: 1000, totalMinor: 1500, taxBps: 2000, taxMinor: 300, billingType: 'One-off',
};

/** An issued £18.00 invoice for Northwind Studio. */
export const issued = (over: Partial<Invoice> = {}): Invoice => invoice({
  status: 'Issued', revision: 3, lines: [designLine], subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800,
  customer: { name: 'Northwind Studio', contactName: 'Elena Rossi', email: 'elena@northwind.example', companyNumber: '' },
  invoiceHash: 'hash', issuedAt: '2026-11-02T09:00:00Z',
  events: [
    { at: '2026-11-01T09:00:00Z', type: 'Draft created', actor: 'sam@example.com' },
    { at: '2026-11-02T09:00:00Z', type: 'Invoice issued; PDF and details frozen', actor: 'sam@example.com' },
  ],
  ...over,
});

export const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', amountMinor: 800, paidOn: '2026-11-10', reference: 'BACS 4471', method: 'Bank transfer',
  receiptNumber: 'INV-0001-R01', receiptHash: 'rh', recordedAt: '2026-11-10T10:00:00Z', ...over,
});

export const customer = (over: Partial<Client> = {}): Client => ({
  id: 'c1', workspaceId: 'w', crmCompanyId: 'co1', name: 'Northwind Studio', contactName: 'Elena Rossi',
  email: 'elena@northwind.example', companyNumber: '', notes: '', created: '2026-10-01T00:00:00Z', archived: false, ...over,
});

export const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'w', owner: 'u1', name: 'Sam Studio', replyTo: 'hello@samstudio.example', senderName: 'Sam Studio',
  senderEmail: 'billing@samstudio.example', retentionDays: 365, suspended: false, created: '2026-01-01T00:00:00Z', ...over,
});

export const delivery = { mode: 'securovix', sender: 'invoices@example.com', ready: true };

const day = new Date(2026, 10, 1, 10, 0);
export const crmCompany = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, organizationId: 'o', workspaceId: 'w', ownerId: null, name, website: null, industry: null, type: null,
  phone: null, email: null, address: null, city: null, state: null, postalCode: null, country: null,
  linkedinUrl: null, companySize: null, annualRevenue: null, notes: null, customFields: {},
  createdAt: day, updatedAt: day, ...over,
});
export const crmDeal = (id: string, name: string, companyId: string, value: number, over: Record<string, unknown> = {}) => ({
  id, organizationId: 'o', workspaceId: 'w', ownerId: 'u1', stageId: 's1', companyId, contactId: null, name, value,
  currency: null, probability: 0, status: 'open', expectedCloseDate: null, source: null, notes: null, sortOrder: 0,
  projectId: null, closedAt: null, lostReason: null, createdAt: day, updatedAt: day, ...over,
});

export const crmCurrency = {
  code: 'GBP', def: { code: 'GBP', symbol: '£', label: 'British Pound' }, loading: false, setCurrency: async () => {},
  format: (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`,
};

/** A list as the CRM hooks return it. */
export const crmList = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: async () => {} });

/** jsdom has no blob URLs, ResizeObserver or pointer capture, which the PDF viewer and the menus use. */
export function stubBrowser(): void {
  URL.createObjectURL = vi.fn(() => 'blob:sample');
  URL.revokeObjectURL = vi.fn();
  class Observer { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Observer;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
}

/** A £500.00 a month billing plan for Northwind Studio, running from September 2026 with no end. */
export const plan = (over: Partial<ClientProject> = {}): ClientProject => ({
  id: 'pl1', workspaceId: 'w', clientId: 'c1', createdBy: 'u1', name: 'Website retainer', billingType: 'Monthly',
  billingLabel: '', currency: 'GBP', monthlyFeeMinor: 50000, contractValueMinor: 0, annualTargetMinor: 0,
  startMonth: '2026-09', endMonth: '', status: 'Active', notes: '', archived: false, revision: 1, monthlyEntries: {},
  created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', ...over,
});

/** What was entered by hand for one month of a plan. */
export const monthEntry = (paidMinor: number, expectedMinor: number, notes = '') => ({
  paidMinor, expectedMinor, notes, updated: '2026-10-01T00:00:00Z', updatedBy: 'u1',
});

/** A plan with its year worked out by the server's own maths. */
export const planYear = (over: Partial<ClientProject> = {}, invoices: Invoice[] = [], year = 2026): ProjectYear =>
  projectYear(plan(over), invoices, year);

/** One line of the accounts overview: a plan's month, or an issued invoice. */
export const overviewRow = (over: Partial<OverviewRow> = {}): OverviewRow => ({
  id: 'pl12026-11', clientId: 'c1', clientName: 'Northwind Studio', archived: false, reference: 'Website retainer',
  source: 'Project plan', period: '2026-11', currency: 'GBP', paidMinor: 0, remainingMinor: 50000, status: 'upcoming', ...over,
});

/** One email the server sent, as the delivery log lists it. */
export const emailDelivery = (over: Record<string, unknown> = {}) => ({
  id: 'd1', recipient: 'elena@northwind.example', subject: 'Invoice INV-0001 from Sam Studio', purpose: 'invoice',
  route: 'mailbox' as 'mailbox' | 'securovix' | undefined, status: 'sent' as 'sending' | 'sent' | 'failed',
  created: '2026-11-02T09:05:00Z', ...over,
});
