import { supabase } from '@/services/supabase/config';
import type { ClientBillingType, CrmAccountPayment, CrmClientAccount } from '@/types/crmHub';

type AccountRow = {
  id: string; organization_id: string; workspace_id: string; contact_id: string;
  project_id: string | null; service_name: string; billing_type: ClientBillingType;
  agreed_amount: number | string; opening_paid: number | string; service_start: string | null;
  service_end: string | null; notes: string | null; created_at: string; updated_at: string;
};
type PaymentRow = {
  id: string; account_id: string; organization_id: string; workspace_id: string;
  paid_on: string; amount: number | string; notes: string | null; created_at: string;
};

const mapAccount = (row: AccountRow): CrmClientAccount => ({
  id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id,
  contactId: row.contact_id, projectId: row.project_id, serviceName: row.service_name,
  billingType: row.billing_type, agreedAmount: Number(row.agreed_amount), openingPaid: Number(row.opening_paid),
  serviceStart: row.service_start, serviceEnd: row.service_end, notes: row.notes,
  createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
});
const mapPayment = (row: PaymentRow): CrmAccountPayment => ({
  id: row.id, accountId: row.account_id, organizationId: row.organization_id,
  workspaceId: row.workspace_id, paidOn: row.paid_on, amount: Number(row.amount),
  notes: row.notes, createdAt: new Date(row.created_at),
});

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
}

export const createClientAccount = async (input: SaveClientAccountInput) => {
  const { data, error } = await supabase.from('crm_client_accounts').insert({
    organization_id: input.organizationId, workspace_id: input.workspaceId, contact_id: input.contactId,
    project_id: input.projectId ?? null, service_name: input.serviceName, billing_type: input.billingType,
    agreed_amount: input.agreedAmount, opening_paid: input.openingPaid, service_start: input.serviceStart ?? null,
    service_end: input.serviceEnd ?? null, notes: input.notes ?? null, created_by: input.createdBy ?? null,
  }).select('*').single();
  if (error) throw error;
  return mapAccount(data as AccountRow);
};

export const addAccountPayment = async (input: {
  accountId: string; organizationId: string; workspaceId: string; paidOn: string;
  amount: number; notes?: string | null; createdBy?: string | null;
}) => {
  const { data, error } = await supabase.from('crm_account_payments').insert({
    account_id: input.accountId, organization_id: input.organizationId, workspace_id: input.workspaceId,
    paid_on: input.paidOn, amount: input.amount, notes: input.notes ?? null, created_by: input.createdBy ?? null,
  }).select('*').single();
  if (error) throw error;
  return mapPayment(data as PaymentRow);
};
