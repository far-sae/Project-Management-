export interface Invoice {
  invoiceId: string;
  organizationId: string;
  clientId: string;
  dealId: string | null;
  quoteId: string | null;
  workspaceId: string | null;
  invoiceNumber: string;
  title: string | null;
  status: 'draft' | 'sent' | 'paid' | 'void';
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: unknown[];
  notes: string | null;
  terms: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  publicToken: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const daysAgo = (date: Date, now: Date) => (now.getTime() - date.getTime()) / 86_400_000;

export const isOverdue = (invoice: Invoice, now = new Date()): boolean =>
  invoice.status === 'sent' && !!invoice.dueAt && invoice.dueAt.getTime() < now.getTime();

export const invoiceTotals = (invoices: Invoice[], now = new Date()) => ({
  outstanding: invoices
    .filter((invoice) => invoice.status === 'sent')
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.amountPaid), 0),
  overdue: invoices
    .filter((invoice) => isOverdue(invoice, now))
    .reduce((sum, invoice) => sum + Math.max(0, invoice.total - invoice.amountPaid), 0),
  paidLast30: invoices
    .filter((invoice) => invoice.status === 'paid' && invoice.paidAt && daysAgo(invoice.paidAt, now) <= 30)
    .reduce((sum, invoice) => sum + Math.min(invoice.total, invoice.amountPaid), 0),
  counts: invoices.reduce<Record<string, number>>((counts, invoice) => {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    return counts;
  }, {}),
});
