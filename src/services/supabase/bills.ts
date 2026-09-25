export interface Bill {
  billId: string;
  organizationId: string;
  workspaceId: string | null;
  vendorName: string;
  vendorEmail: string | null;
  billNumber: string;
  reference: string | null;
  status: 'draft' | 'open' | 'paid' | 'void';
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: unknown[];
  notes: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const daysAgo = (date: Date, now: Date) => (now.getTime() - date.getTime()) / 86_400_000;

export const isBillOverdue = (bill: Bill, now = new Date()): boolean =>
  bill.status === 'open' && !!bill.dueAt && bill.dueAt.getTime() < now.getTime();

export const billTotals = (bills: Bill[], now = new Date()) => ({
  payable: bills
    .filter((bill) => bill.status === 'open')
    .reduce((sum, bill) => sum + Math.max(0, bill.total - bill.amountPaid), 0),
  overdue: bills
    .filter((bill) => isBillOverdue(bill, now))
    .reduce((sum, bill) => sum + Math.max(0, bill.total - bill.amountPaid), 0),
  paidLast30: bills
    .filter((bill) => bill.status === 'paid' && bill.paidAt && daysAgo(bill.paidAt, now) <= 30)
    .reduce((sum, bill) => sum + Math.min(bill.total, bill.amountPaid), 0),
  counts: bills.reduce<Record<string, number>>((counts, bill) => {
    counts[bill.status] = (counts[bill.status] ?? 0) + 1;
    return counts;
  }, {}),
});
