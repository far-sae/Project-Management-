// Delete an invoice for good. The owner and admins only. A draft goes after one
// question. An invoice that was issued takes its payments, receipts and email
// history with it: the window says so, says what a real invoice is, offers a
// copy first, and asks for a tick.
import React, { useState } from 'react';
import { Download, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { useOrganization } from '@/context/OrganizationContext';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence } from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { savePdf } from './shared';

interface Props {
  invoice: Invoice;
  /** Called once the invoice is gone, so the page can leave it. */
  onDeleted: () => void;
}

export const DeleteInvoiceButton: React.FC<Props> = ({ invoice, onDeleted }) => {
  const { client } = useSignroom();
  const { isAdmin } = useOrganization();
  const [asking, setAsking] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  // The server refuses anybody else as well: this only keeps a button they cannot use off the screen.
  if (!isAdmin) return null;

  const draft = invoice.status === 'Draft';
  const paid = invoice.payments.length > 0;

  const ask = (open: boolean) => {
    if (busy) return;
    setAsking(open);
    setSure(false);
  };

  const copy = async () => {
    try {
      savePdf(await client.pdf(`billing/${invoice.id}/artifact`), `${invoice.number}.pdf`);
    } catch (error) {
      toast.error(errorSentence(error, 'The PDF could not be downloaded.'));
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await client.call(`billing/${invoice.id}/delete`, {});
      toast.success(`${invoice.number} was deleted.`);
      setAsking(false);
      onDeleted();
    } catch (error) {
      toast.error(errorSentence(error, 'The invoice could not be deleted. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => ask(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>

      <AlertDialog open={asking} onOpenChange={ask}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {invoice.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {draft
                ? 'This draft was never issued. It is deleted for good.'
                : `This invoice is deleted for good, with ${paid ? 'its payments and receipts, ' : ''}its history and the record of emails sent. It cannot be brought back.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!draft && (
            <div className="flex flex-col gap-3">
              <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                A real invoice that was sent to a client is a business record, and the law may ask you to keep it for years.
                Delete it only when it was a test, or when you keep your own copy.
              </p>
              <div>
                <Button variant="outline" size="sm" onClick={() => void copy()}><Download aria-hidden /> Download a copy first</Button>
              </div>
              <label className="flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={sure} disabled={busy} onChange={(event) => setSure(event.target.checked)} />
                <span>I understand that {invoice.number} is deleted for good.</span>
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || (!draft && !sure)}
              onClick={(event) => { event.preventDefault(); void remove(); }}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Delete {invoice.number}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DeleteInvoiceButton;
