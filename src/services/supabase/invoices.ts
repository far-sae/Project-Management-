import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { computeQuoteTotals, type QuoteLineItem } from "./quotes";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export interface Invoice {
  invoiceId: string;
  organizationId: string;
  clientId: string;
  dealId: string | null;
  quoteId: string | null;
  workspaceId: string | null;
  invoiceNumber: string;
  title: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  terms: string | null;
  issuedAt: Date;
  dueAt: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvoiceInput {
  clientId: string;
  dealId?: string | null;
  quoteId?: string | null;
  workspaceId?: string | null;
  title?: string | null;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  terms?: string | null;
  issuedAt?: Date;
  dueAt?: Date | null;
}

export type UpdateInvoiceInput = Partial<CreateInvoiceInput> & {
  status?: InvoiceStatus;
  amountPaid?: number;
};

const mapInvoice = (r: Record<string, unknown>): Invoice => ({
  invoiceId: r.invoice_id as string,
  organizationId: r.organization_id as string,
  clientId: r.client_id as string,
  dealId: (r.deal_id as string) ?? null,
  quoteId: (r.quote_id as string) ?? null,
  workspaceId: (r.workspace_id as string) ?? null,
  invoiceNumber: r.invoice_number as string,
  title: (r.title as string) ?? null,
  status: ((r.status as string) || "draft") as InvoiceStatus,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  subtotal: Number(r.subtotal ?? 0),
  taxRate: Number(r.tax_rate ?? 0),
  taxAmount: Number(r.tax_amount ?? 0),
  discount: Number(r.discount ?? 0),
  total: Number(r.total ?? 0),
  amountPaid: Number(r.amount_paid ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  terms: (r.terms as string) ?? null,
  issuedAt: new Date(r.issued_at as string),
  dueAt: r.due_at ? new Date(r.due_at as string) : null,
  sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
  paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
  voidedAt: r.voided_at ? new Date(r.voided_at as string) : null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const nextInvoiceNumber = async (organizationId: string): Promise<string> => {
  const { data, error } = await supabase.rpc("next_invoice_number", {
    p_organization_id: organizationId,
  });
  if (error) {
    logger.warn("next_invoice_number rpc failed, falling back:", error);
    return `INV-${Date.now()}`;
  }
  return String(data);
};

export const createInvoice = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateInvoiceInput,
): Promise<Invoice> => {
  const taxRate = input.taxRate ?? 0;
  const discount = input.discount ?? 0;
  const totals = computeQuoteTotals(input.lineItems, taxRate, discount);
  const number = await nextInvoiceNumber(organizationId);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      deal_id: input.dealId ?? null,
      quote_id: input.quoteId ?? null,
      workspace_id: input.workspaceId ?? null,
      invoice_number: number,
      title: input.title ?? null,
      currency: (input.currency ?? "USD").toUpperCase(),
      tax_rate: taxRate,
      discount,
      subtotal: totals.subtotal,
      tax_amount: totals.taxAmount,
      total: totals.total,
      line_items: input.lineItems,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      issued_at: (input.issuedAt ?? new Date()).toISOString().slice(0, 10),
      due_at: input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null,
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) {
    logger.error("createInvoice failed:", error);
    throw error;
  }
  return mapInvoice(data);
};

export const updateInvoice = async (
  organizationId: string,
  invoiceId: string,
  input: UpdateInvoiceInput,
): Promise<Invoice> => {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "sent") patch.sent_at = new Date().toISOString();
    if (input.status === "paid") patch.paid_at = new Date().toISOString();
    if (input.status === "void") patch.voided_at = new Date().toISOString();
  }
  if (input.amountPaid !== undefined) patch.amount_paid = input.amountPaid;
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
  if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.lineItems !== undefined) {
    patch.line_items = input.lineItems;
    const totals = computeQuoteTotals(
      input.lineItems,
      input.taxRate ?? 0,
      input.discount ?? 0,
    );
    patch.subtotal = totals.subtotal;
    patch.tax_amount = totals.taxAmount;
    patch.total = totals.total;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.dueAt !== undefined) {
    patch.due_at = input.dueAt ? input.dueAt.toISOString().slice(0, 10) : null;
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("invoice_id", invoiceId)
    .select()
    .single();
  if (error) {
    logger.error("updateInvoice failed:", error);
    throw error;
  }
  return mapInvoice(data);
};

export const deleteInvoice = async (
  organizationId: string,
  invoiceId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("organization_id", organizationId)
    .eq("invoice_id", invoiceId);
  if (error) {
    logger.error("deleteInvoice failed:", error);
    throw error;
  }
};

export const listClientInvoices = async (
  organizationId: string,
  clientId: string,
): Promise<Invoice[]> => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("issued_at", { ascending: false });
  if (error) {
    logger.error("listClientInvoices failed:", error);
    return [];
  }
  return (data ?? []).map(mapInvoice);
};
