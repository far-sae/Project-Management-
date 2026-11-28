import { supabase } from '@/services/supabase/config';
import type { ClientBillingType, CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

type AccountRow = {
  id: string; organization_id: string; workspace_id: string; contact_id: string;
  project_id: string | null; service_name: string; billing_type: ClientBillingType;
  agreed_amount: number | string; opening_paid: number | string; service_start: string | null;
  service_end: string | null; notes: string | null; created_at: string; updated_at: string;
  due_day?: number | null; due_date?: string | null; currency?: string | null;
};
type PaymentRow = {
  id: string; account_id: string; organization_id: string; workspace_id: string;
  paid_on: string; amount: number | string; notes: string | null; created_at: string;
  billing_month?: string | null; method?: string | null; reference?: string | null; source_payment_id?: string | null;
};

const mapAccount = (row: AccountRow): CrmClientAccount => ({
  id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id,
  contactId: row.contact_id, projectId: row.project_id, serviceName: row.service_name,
  billingType: row.billing_type, agreedAmount: Number(row.agreed_amount), openingPaid: Number(row.opening_paid),
  serviceStart: row.service_start, serviceEnd: row.service_end, notes: row.notes,
  dueDay: row.due_day ?? null, dueDate: row.due_date ?? null, currency: row.currency ?? null,
  createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
});
const mapPayment = (row: PaymentRow): CrmAccountPayment => ({
  id: row.id, accountId: row.account_id, organizationId: row.organization_id,
  workspaceId: row.workspace_id, paidOn: row.paid_on, amount: Number(row.amount),
  notes: row.notes, billingMonth: row.billing_month ?? null, method: row.method ?? null, reference: row.reference ?? null,
  fromInvoice: Boolean(row.source_payment_id), createdAt: new Date(row.created_at),
});

/**
 * The newer fields of a payment or a service, only where they hold something.
 * A database that has not been given them yet (210) then still saves the rest.
 */
const given = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ''));

export const ACCOUNTS_NOT_SET_UP_MESSAGE = 'This needs a newer database. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';
/** A column the database does not have yet: the SQL has not been run. */
const notSetUp = (error: { code?: string; message?: string }): boolean =>
  error.code === 'PGRST204' || error.code === '42703' || /schema cache|column .* does not exist/i.test(error.message ?? '');
const fail = (error: { code?: string; message?: string }): never => {
  if (notSetUp(error)) throw new Error(ACCOUNTS_NOT_SET_UP_MESSAGE);
  throw error;
};

export const listClientAccounts = async (workspaceId: string, contactId?: string) => {
  let query = supabase.from('crm_client_accounts').select('*').eq('workspace_id', workspaceId);
  if (contactId) query = query.eq('contact_id', contactId);
  const { data, error } = await query.order('created_at');
  if (error) throw error;
  return ((data ?? []) as AccountRow[]).map(mapAccount);
};

export const listAccountPayments = async (workspaceId: string, year?: number, accountIds?: string[]) => {
  let query = supabase.from('crm_account_payments').select('*').eq('workspace_id', workspaceId);
  if (year) query = query.gte('paid_on', `${year}-01-01`).lte('paid_on', `${year}-12-31`);
  if (accountIds && accountIds.length > 0) query = query.in('account_id', accountIds);
  const { data, error } = await query.order('paid_on');
  if (error) throw error;
  return ((data ?? []) as PaymentRow[]).map(mapPayment);
};

export interface SaveClientAccountInput {
  organizationId: string; workspaceId: string; contactId: string; projectId?: string | null;
  serviceName: string; billingType: ClientBillingType; agreedAmount: number; openingPaid: number;
  serviceStart?: string | null; serviceEnd?: string | null; notes?: string | null; createdBy?: string | null;
  dueDay?: number | null; dueDate?: string | null;
  /** Another currency than the company's. Left out: the company's own. */
  currency?: string | null;
}

export const createClientAccount = async (input: SaveClientAccountInput) => {
  const { data, error } = await supabase.from('crm_client_accounts').insert({
    organization_id: input.organizationId, workspace_id: input.workspaceId, contact_id: input.contactId,
    project_id: input.projectId ?? null, service_name: input.serviceName, billing_type: input.billingType,
    agreed_amount: input.agreedAmount, opening_paid: input.openingPaid, service_start: input.serviceStart ?? null,
    service_end: input.serviceEnd ?? null, notes: input.notes ?? null, created_by: input.createdBy ?? null,
    ...given({ due_day: input.dueDay, due_date: input.dueDate, currency: input.currency }),
  }).select('*').single();
  if (error) fail(error);
  return mapAccount(data as AccountRow);
};

export const addAccountPayment = async (input: {
  accountId: string; organizationId: string; workspaceId: string; paidOn: string;
  amount: number; notes?: string | null; createdBy?: string | null;
  billingMonth?: string | null; method?: string | null; reference?: string | null;
}) => {
  const { data, error } = await supabase.from('crm_account_payments').insert({
    account_id: input.accountId, organization_id: input.organizationId, workspace_id: input.workspaceId,
    paid_on: input.paidOn, amount: input.amount, notes: input.notes ?? null, created_by: input.createdBy ?? null,
    ...given({ billing_month: input.billingMonth, method: input.method, reference: input.reference }),
  }).select('*').single();
  if (error) fail(error);
  return mapPayment(data as PaymentRow);
};

/** Change a service. Who it belongs to (lead, workspace, organisation) never changes. */
export const updateClientAccount = async (
  id: string,
  input: Omit<SaveClientAccountInput, 'organizationId' | 'workspaceId' | 'contactId' | 'createdBy'>,
) => {
  const { data, error } = await supabase.from('crm_client_accounts').update({
    project_id: input.projectId ?? null, service_name: input.serviceName, billing_type: input.billingType,
    agreed_amount: input.agreedAmount, opening_paid: input.openingPaid, service_start: input.serviceStart ?? null,
    service_end: input.serviceEnd ?? null, notes: input.notes ?? null,
    // Sent only when the form knows them: an older form (or database) leaves them alone.
    ...(input.dueDay !== undefined ? { due_day: input.dueDay } : {}),
    ...(input.dueDate !== undefined ? { due_date: input.dueDate } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
  }).eq('id', id).select('*').single();
  if (error) fail(error);
  return mapAccount(data as AccountRow);
};

/** Remove a service. Its payments go with it (the table removes them itself). */
export const deleteClientAccount = async (id: string) => {
  const { error } = await supabase.from('crm_client_accounts').delete().eq('id', id);
  if (error) throw error;
};

export const updateAccountPayment = async (id: string, input: {
  paidOn: string; amount: number; notes: string | null;
  billingMonth?: string | null; method?: string | null; reference?: string | null;
}) => {
  const { data, error } = await supabase.from('crm_account_payments')
    .update({
      paid_on: input.paidOn, amount: input.amount, notes: input.notes,
      ...(input.billingMonth !== undefined ? { billing_month: input.billingMonth } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
    })
    .eq('id', id).select('*').single();
  if (error) fail(error);
  return mapPayment(data as PaymentRow);
};

export const deleteAccountPayment = async (id: string) => {
  const { error } = await supabase.from('crm_account_payments').delete().eq('id', id);
  if (error) throw error;
};
