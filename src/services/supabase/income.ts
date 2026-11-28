// Income with no invoice and no service (income_entries, migration 220):
// a cash sale, a refund, interest. Read and written by the owner and admins.
import { supabase } from '@/services/supabase/config';
import type { IncomeEntry } from '@/lib/income';

type Row = {
  id: string; organization_id: string; workspace_id: string; title: string; payer: string | null;
  amount: number | string; currency: string; received_on: string; method: string | null; reference: string | null; notes: string | null;
};

const map = (row: Row): IncomeEntry => ({
  id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id, title: row.title, payer: row.payer ?? '',
  amount: Number(row.amount), currency: row.currency, receivedOn: row.received_on, method: row.method, reference: row.reference, notes: row.notes,
});

/** The table is not in the database yet: the SQL has not been run. */
const notSetUp = (error: { code?: string; message?: string }): boolean =>
  error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message ?? '');

export const INCOME_NOT_SET_UP_MESSAGE = 'This needs a newer database. Run supabase/crm_setup.sql in the Supabase SQL editor, then reload.';

/**
 * The other income of a workspace, newest first. `ready` is false when the
 * table is not there yet: the page then still shows invoices and services, and
 * says that other income cannot be kept yet.
 */
export async function listIncomeEntries(workspaceId: string): Promise<{ entries: IncomeEntry[]; ready: boolean }> {
  const { data, error } = await supabase.from('income_entries').select('*').eq('workspace_id', workspaceId).order('received_on', { ascending: false });
  if (error) {
    if (notSetUp(error)) return { entries: [], ready: false };
    throw error;
  }
  return { entries: ((data ?? []) as Row[]).map(map), ready: true };
}

export interface IncomeInput {
  title: string;
  payer: string;
  amount: number;
  currency: string;
  receivedOn: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

const fields = (input: IncomeInput) => ({
  title: input.title, payer: input.payer, amount: input.amount, currency: input.currency, received_on: input.receivedOn,
  method: input.method, reference: input.reference, notes: input.notes,
});

const fail = (error: { code?: string; message?: string }): never => {
  if (notSetUp(error)) throw new Error(INCOME_NOT_SET_UP_MESSAGE);
  throw error;
};

export async function createIncomeEntry(input: IncomeInput & { organizationId: string; workspaceId: string }): Promise<IncomeEntry> {
  const { data, error } = await supabase.from('income_entries')
    .insert({ organization_id: input.organizationId, workspace_id: input.workspaceId, ...fields(input) })
    .select('*').single();
  if (error) fail(error);
  return map(data as Row);
}

export async function updateIncomeEntry(id: string, input: IncomeInput): Promise<IncomeEntry> {
  const { data, error } = await supabase.from('income_entries')
    .update({ ...fields(input), updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error) fail(error);
  return map(data as Row);
}

export async function deleteIncomeEntry(id: string): Promise<void> {
  const { error } = await supabase.from('income_entries').delete().eq('id', id);
  if (error) fail(error);
}
