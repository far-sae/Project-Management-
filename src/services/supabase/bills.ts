import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { computeQuoteTotals, type QuoteLineItem } from "./quotes";

export type BillStatus = "draft" | "open" | "paid" | "overdue" | "void";

export interface Bill {
  billId: string;
  organizationId: string;
  workspaceId: string | null;
  projectId: string | null;
  vendorName: string;
  vendorEmail: string | null;
  billNumber: string;
  reference: string | null;
  status: BillStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: QuoteLineItem[];
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

export interface CreateBillInput {
  vendorName: string;
  vendorEmail?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  reference?: string | null;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  issuedAt?: Date;
  dueAt?: Date | null;
}

export type UpdateBillInput = Partial<CreateBillInput> & {
  status?: BillStatus;
  amountPaid?: number;
};

const mapBill = (r: Record<string, unknown>): Bill => ({
  billId: r.bill_id as string,
  organizationId: r.organization_id as string,
  workspaceId: (r.workspace_id as string) ?? null,
  projectId: (r.project_id as string) ?? null,
  vendorName: (r.vendor_name as string) ?? "",
  vendorEmail: (r.vendor_email as string) ?? null,
  billNumber: r.bill_number as string,
  reference: (r.reference as string) ?? null,
  status: ((r.status as string) || "draft") as BillStatus,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  subtotal: Number(r.subtotal ?? 0),
  taxRate: Number(r.tax_rate ?? 0),
  taxAmount: Number(r.tax_amount ?? 0),
  discount: Number(r.discount ?? 0),
  total: Number(r.total ?? 0),
  amountPaid: Number(r.amount_paid ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  issuedAt: new Date(r.issued_at as string),
  dueAt: r.due_at ? new Date(r.due_at as string) : null,
  paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
  voidedAt: r.voided_at ? new Date(r.voided_at as string) : null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export interface BillTotals {
  payable: number;
  overdue: number;
  paidLast30: number;
  counts: Record<BillStatus, number>;
}

export const isBillOverdue = (b: Bill, today: Date = new Date()): boolean => {
  if (b.status === "paid" || b.status === "void") return false;
  if (!b.dueAt) return false;
  return b.dueAt.getTime() < today.getTime();
};

export const billTotals = (list: Bill[], today: Date = new Date()): BillTotals => {
  const counts: Record<BillStatus, number> = { draft: 0, open: 0, paid: 0, overdue: 0, void: 0 };
  let payable = 0, overdue = 0, paidLast30 = 0;
  const cutoff = today.getTime() - 30 * 24 * 60 * 60 * 1000;
  for (const b of list) {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
    if (b.status === "void") continue;
    const balance = Math.max(0, b.total - b.amountPaid);
    if (b.status !== "paid" && b.status !== "draft") {
      payable += balance;
      if (isBillOverdue(b, today)) overdue += balance;
    }
    if (b.paidAt && b.paidAt.getTime() >= cutoff) paidLast30 += Math.min(b.amountPaid, b.total);
  }
  return { payable, overdue, paidLast30, counts };
};

const nextBillNumber = async (organizationId: string): Promise<string> => {
  const { data, error } = await supabase.rpc("next_bill_number", { p_organization_id: organizationId });
  if (error) { logger.warn("next_bill_number rpc failed, falling back:", error); return `BILL-${Date.now()}`; }
  return String(data);
};

export const listOrgBills = async (organizationId: string): Promise<Bill[]> => {
  const { data, error } = await supabase
    .from("bills").select("*")
    .eq("organization_id", organizationId)
    .order("issued_at", { ascending: false });
  if (error) { logger.error("listOrgBills failed:", error); return []; }
  return (data ?? []).map(mapBill);
};

export const createBill = async (
  organizationId: string, userId: string | null, userName: string | null, input: CreateBillInput,
): Promise<Bill> => {
  const taxRate = input.taxRate ?? 0;
  const discount = input.discount ?? 0;
  const totals = computeQuoteTotals(input.lineItems, taxRate, discount);
  const number = await nextBillNumber(organizationId);
  const { data, error } = await supabase.from("bills").insert({
    organization_id: organizationId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    vendor_name: input.vendorName,
    vendor_email: input.vendorEmail ?? null,
    bill_number: number,
    reference: input.reference ?? null,
    status: "open",
    currency: (input.currency ?? "USD").toUpperCase(),
    tax_rate: taxRate, discount,
    subtotal: totals.subtotal, tax_amount: totals.taxAmount, total: totals.total,
    line_items: input.lineItems,
    notes: input.notes ?? null,
    issued_at: (input.issuedAt ?? new Date()).toISOString().slice(0, 10),
    due_at: input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null,
    created_by: userId, created_by_name: userName,
  }).select().single();
  if (error) { logger.error("createBill failed:", error); throw error; }
  return mapBill(data);
};

export const updateBill = async (
  organizationId: string, billId: string, input: UpdateBillInput,
): Promise<Bill> => {
  const patch: Record<string, unknown> = {};
  if (input.vendorName !== undefined) patch.vendor_name = input.vendorName;
  if (input.vendorEmail !== undefined) patch.vendor_email = input.vendorEmail;
  if (input.reference !== undefined) patch.reference = input.reference;
  if (input.status !== undefined) {
    patch.status = input.status;
    // Clear stamps when leaving paid/void so "unmark paid" reverts cleanly.
    patch.paid_at = input.status === "paid" ? new Date().toISOString() : null;
    patch.voided_at = input.status === "void" ? new Date().toISOString() : null;
  }
  if (input.amountPaid !== undefined) patch.amount_paid = input.amountPaid;
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
  if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.lineItems !== undefined) {
    patch.line_items = input.lineItems;
    const totals = computeQuoteTotals(input.lineItems, input.taxRate ?? 0, input.discount ?? 0);
    patch.subtotal = totals.subtotal; patch.tax_amount = totals.taxAmount; patch.total = totals.total;
    // Clamp a recorded payment that now exceeds the (edited-down) total.
    if (input.amountPaid !== undefined) patch.amount_paid = Math.min(input.amountPaid, totals.total);
  }
  if (input.workspaceId !== undefined) patch.workspace_id = input.workspaceId;
  if (input.projectId !== undefined) patch.project_id = input.projectId;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.dueAt !== undefined) patch.due_at = input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null;
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("bills").update(patch)
    .eq("organization_id", organizationId).eq("bill_id", billId).select().single();
  if (error) { logger.error("updateBill failed:", error); throw error; }
  return mapBill(data);
};

/** Revert a paid bill back to "open" (clears amount_paid + paid_at). */
export const unmarkBillPaid = async (
  organizationId: string, billId: string,
): Promise<Bill> => updateBill(organizationId, billId, { status: "open", amountPaid: 0 });

export const deleteBill = async (organizationId: string, billId: string): Promise<void> => {
  const { error } = await supabase.from("bills").delete()
    .eq("organization_id", organizationId).eq("bill_id", billId);
  if (error) { logger.error("deleteBill failed:", error); throw error; }
};
