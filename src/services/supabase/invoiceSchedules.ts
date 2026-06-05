import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { computeQuoteTotals, type QuoteLineItem } from "./quotes";

export type ScheduleFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface InvoiceSchedule {
  scheduleId: string;
  organizationId: string;
  clientId: string;
  workspaceId: string | null;
  title: string | null;
  currency: string;
  taxRate: number;
  discount: number;
  lineItems: QuoteLineItem[];
  notes: string | null;
  terms: string | null;
  frequency: ScheduleFrequency;
  dueDays: number;
  nextRunDate: Date;
  enabled: boolean;
  lastInvoiceId: string | null;
  lastRunAt: Date | null;
  createdAt: Date;
}

export interface CreateScheduleInput {
  clientId: string;
  workspaceId?: string | null;
  title?: string | null;
  currency?: string;
  taxRate?: number;
  discount?: number;
  lineItems: QuoteLineItem[];
  notes?: string | null;
  terms?: string | null;
  frequency: ScheduleFrequency;
  dueDays?: number;
  nextRunDate: Date;
}

export type UpdateScheduleInput = Partial<CreateScheduleInput> & { enabled?: boolean };

const map = (r: Record<string, unknown>): InvoiceSchedule => ({
  scheduleId: r.schedule_id as string,
  organizationId: r.organization_id as string,
  clientId: r.client_id as string,
  workspaceId: (r.workspace_id as string) ?? null,
  title: (r.title as string) ?? null,
  currency: ((r.currency as string) || "USD").toUpperCase(),
  taxRate: Number(r.tax_rate ?? 0),
  discount: Number(r.discount ?? 0),
  lineItems: Array.isArray(r.line_items) ? (r.line_items as QuoteLineItem[]) : [],
  notes: (r.notes as string) ?? null,
  terms: (r.terms as string) ?? null,
  frequency: ((r.frequency as string) || "monthly") as ScheduleFrequency,
  dueDays: Number(r.due_days ?? 14),
  nextRunDate: new Date(r.next_run_date as string),
  enabled: !!r.enabled,
  lastInvoiceId: (r.last_invoice_id as string) ?? null,
  lastRunAt: r.last_run_at ? new Date(r.last_run_at as string) : null,
  createdAt: new Date(r.created_at as string),
});

export const listOrgSchedules = async (organizationId: string): Promise<InvoiceSchedule[]> => {
  const { data, error } = await supabase
    .from("invoice_schedules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("next_run_date", { ascending: true });
  if (error) { logger.error("listOrgSchedules failed:", error); return []; }
  return (data ?? []).map(map);
};

export const createSchedule = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateScheduleInput,
): Promise<InvoiceSchedule> => {
  // Validate totals compute (keeps the same math the worker uses).
  computeQuoteTotals(input.lineItems, input.taxRate ?? 0, input.discount ?? 0);
  const { data, error } = await supabase.from("invoice_schedules").insert({
    organization_id: organizationId,
    client_id: input.clientId,
    workspace_id: input.workspaceId ?? null,
    title: input.title ?? null,
    currency: (input.currency ?? "USD").toUpperCase(),
    tax_rate: input.taxRate ?? 0,
    discount: input.discount ?? 0,
    line_items: input.lineItems,
    notes: input.notes ?? null,
    terms: input.terms ?? null,
    frequency: input.frequency,
    due_days: input.dueDays ?? 14,
    next_run_date: input.nextRunDate.toISOString().slice(0, 10),
    created_by: userId,
    created_by_name: userName,
  }).select().single();
  if (error) { logger.error("createSchedule failed:", error); throw error; }
  return map(data);
};

export const updateSchedule = async (
  organizationId: string,
  scheduleId: string,
  input: UpdateScheduleInput,
): Promise<void> => {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();
  if (input.taxRate !== undefined) patch.tax_rate = input.taxRate;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.lineItems !== undefined) patch.line_items = input.lineItems;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.terms !== undefined) patch.terms = input.terms;
  if (input.frequency !== undefined) patch.frequency = input.frequency;
  if (input.dueDays !== undefined) patch.due_days = input.dueDays;
  if (input.nextRunDate !== undefined) patch.next_run_date = input.nextRunDate.toISOString().slice(0, 10);
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from("invoice_schedules").update(patch)
    .eq("organization_id", organizationId).eq("schedule_id", scheduleId);
  if (error) { logger.error("updateSchedule failed:", error); throw error; }
};

export const deleteSchedule = async (organizationId: string, scheduleId: string): Promise<void> => {
  const { error } = await supabase.from("invoice_schedules").delete()
    .eq("organization_id", organizationId).eq("schedule_id", scheduleId);
  if (error) { logger.error("deleteSchedule failed:", error); throw error; }
};
