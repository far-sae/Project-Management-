import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";

export interface QuoteLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Quote {
  quoteId: string;
  organizationId: string;
  dealId: string | null;
  clientId: string | null;
  workspaceId: string | null;
  quoteNumber: string;
  title: string;
  status: QuoteStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  total: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  terms: string | null;
  expiresAt: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateQuoteInput {
  dealId?: string | null;
  clientId?: string | null;
  workspaceId?: string | null;
  title: string;
  status?: QuoteStatus;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  terms?: string | null;
  expiresAt?: Date | null;
}

export type UpdateQuoteInput = Partial<CreateQuoteInput> & {
  status?: QuoteStatus;
};

const mapQuote = (r: Record<string, unknown>): Quote => ({
  quoteId: r.quote_id as string,
  organizationId: r.organization_id as string,
  dealId: (r.deal_id as string) ?? null,
  clientId: (r.client_id as string) ?? null,
  workspaceId: (r.workspace_id as string) ?? null,
  quoteNumber: r.quote_number as string,
  title: r.title as string,
  status: ((r.status as string) || "draft") as QuoteStatus,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  subtotal: Number(r.subtotal ?? 0),
  taxRate: Number(r.tax_rate ?? 0),
  taxAmount: Number(r.tax_amount ?? 0),
  discount: Number(r.discount ?? 0),
  total: Number(r.total ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  terms: (r.terms as string) ?? null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
  sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
  acceptedAt: r.accepted_at ? new Date(r.accepted_at as string) : null,
  declinedAt: r.declined_at ? new Date(r.declined_at as string) : null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export const computeQuoteTotals = (
  lineItems: QuoteLineItem[],
  taxRate: number,
  discount: number,
): { subtotal: number; taxAmount: number; total: number } => {
  const subtotal = lineItems.reduce((sum, li) => sum + (li.lineTotal || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (discount || 0));
  const taxAmount = +(afterDiscount * (taxRate / 100)).toFixed(2);
  const total = +(afterDiscount + taxAmount).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxAmount, total };
};

const nextQuoteNumber = async (organizationId: string): Promise<string> => {
  const { data, error } = await supabase.rpc("next_quote_number", {
    p_organization_id: organizationId,
  });
  if (error) {
    logger.warn("next_quote_number rpc failed, falling back:", error);
    return `Q-${Date.now()}`;
  }
  return String(data);
};

export const createQuote = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateQuoteInput,
): Promise<Quote> => {
  const taxRate = input.taxRate ?? 0;
  const discount = input.discount ?? 0;
  const totals = computeQuoteTotals(input.lineItems, taxRate, discount);
  const number = await nextQuoteNumber(organizationId);

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      organization_id: organizationId,
      deal_id: input.dealId ?? null,
      client_id: input.clientId ?? null,
      workspace_id: input.workspaceId ?? null,
      quote_number: number,
      title: input.title,
      status: input.status ?? "draft",
      currency: (input.currency ?? "USD").toUpperCase(),
      subtotal: totals.subtotal,
      tax_rate: taxRate,
      tax_amount: totals.taxAmount,
      discount,
      total: totals.total,
      line_items: input.lineItems,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      expires_at: input.expiresAt ? input.expiresAt.toISOString().slice(0, 10) : null,
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) {
    logger.error("createQuote failed:", error);
    throw error;
  }
  return mapQuote(data);
};

export const updateQuote = async (
  organizationId: string,
  quoteId: string,
  input: UpdateQuoteInput,
): Promise<Quote> => {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "sent") patch.sent_at = new Date().toISOString();
    if (input.status === "accepted") patch.accepted_at = new Date().toISOString();
    if (input.status === "declined") patch.declined_at = new Date().toISOString();
  }
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
  if (input.expiresAt !== undefined) {
    patch.expires_at = input.expiresAt
      ? input.expiresAt.toISOString().slice(0, 10)
      : null;
  }

  const { data, error } = await supabase
    .from("quotes")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("quote_id", quoteId)
    .select()
    .single();
  if (error) {
    logger.error("updateQuote failed:", error);
    throw error;
  }
  return mapQuote(data);
};

export const deleteQuote = async (
  organizationId: string,
  quoteId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("quotes")
    .delete()
    .eq("organization_id", organizationId)
    .eq("quote_id", quoteId);
  if (error) {
    logger.error("deleteQuote failed:", error);
    throw error;
  }
};

export const listQuotesForDeal = async (
  organizationId: string,
  dealId: string,
): Promise<Quote[]> => {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("listQuotesForDeal failed:", error);
    return [];
  }
  return (data ?? []).map(mapQuote);
};
