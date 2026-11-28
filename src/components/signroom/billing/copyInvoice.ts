// A new invoice made from an existing one: the same customer and lines on a
// fresh draft, with its own number and today's dates. Nothing of the first
// invoice is changed.
import type { Invoice } from '../../../../api/_signroom/shared/types';
import type { SignroomClient } from '@/services/signroom/client';
import { invoiceCopy, linesForServer } from '@/lib/signroom/billing';

export interface CopiedInvoice {
  /** The new draft. */
  invoice: Invoice;
  /** False when the draft was made but its lines could not be added: it is then an empty draft. */
  filled: boolean;
}

/**
 * Makes the draft, then fills it in. Two calls, the same two the "New invoice"
 * window makes. When the deal or the service the first invoice was for is gone,
 * the copy is still made, for the customer alone.
 */
export async function copyInvoice(client: Pick<SignroomClient, 'call'>, source: Invoice): Promise<CopiedInvoice> {
  const copy = invoiceCopy(source);
  let draft: Invoice;
  try {
    draft = await client.call<Invoice>('billing', copy.create);
  } catch (error) {
    const linked = Object.keys(copy.create).length > 1;
    if (!linked) throw error;
    draft = await client.call<Invoice>('billing', { clientId: copy.create.clientId });
  }
  try {
    const saved = await client.call<Invoice>(`billing/${draft.id}/save`, {
      revision: draft.revision,
      lines: linesForServer(copy.lines, copy.taxMode),
      currency: copy.currency,
      // The new invoice's own dates: today, and due by the customer's payment terms.
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      taxPercent: copy.taxPercent,
      receiptDraft: null,
      project: copy.project,
      notes: copy.notes,
    });
    return { invoice: saved, filled: true };
  } catch {
    return { invoice: draft, filled: false };
  }
}
