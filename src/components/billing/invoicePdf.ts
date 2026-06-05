import type { Invoice } from '@/services/supabase/invoices';
export const downloadInvoicePdf = async (
  _invoice: Invoice,
  _org: { name: string },
  _clientName: string,
): Promise<void> => {
  throw new Error('PDF export is wired up in Task 6.');
};
