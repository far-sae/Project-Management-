// Delete an agreement for good. The owner only (the server checks). A draft
// goes after one question. A sent or signed agreement takes its documents, its
// evidence and its history with it: the window says so, says what a signed
// agreement is, and asks for a tick. An agreement people are signing right
// now, or one under a legal hold, cannot be deleted at all.
import React, { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { messageOf } from './files';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Target = Pick<Agreement, 'id' | 'title' | 'status'> & { legalHold?: boolean };

interface DialogProps {
  /** The agreement to delete. Null keeps the window closed. */
  agreement: Target | null;
  onOpenChange: (open: boolean) => void;
  /** Called once the agreement is gone. */
  onDeleted: () => void;
}

const SIGNING = ['Awaiting signatures', 'Finalising'];

/** Why this agreement cannot be deleted at all, or null when it can. */
export const deleteBlocked = (a: Target): string | null =>
  a.legalHold ? 'This agreement is under a legal hold. Release the hold first.'
    : SIGNING.includes(a.status) ? 'People are signing this agreement right now. Cancel it or let it finish first.'
      : null;

export const DeleteAgreementDialog: React.FC<DialogProps> = ({ agreement, onOpenChange, onDeleted }) => {
  const { client } = useSignroom();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const id = agreement?.id ?? null;
  // Asked afresh each time it opens.
  useEffect(() => { setSure(false); }, [id]);

  const draft = agreement?.status === 'Draft';
  const blocked = agreement ? deleteBlocked(agreement) : null;

  const remove = async () => {
    if (!agreement) return;
    setBusy(true);
    try {
      await client.call(`agreements/${agreement.id}/delete-now`, {});
      toast.success(`${agreement.title} was deleted.`);
      onOpenChange(false);
      onDeleted();
    } catch (error) {
      toast.error(messageOf(error, 'The agreement could not be deleted. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={agreement !== null} onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {agreement?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {draft
              ? 'This draft was never sent. It is deleted for good.'
              : 'This agreement is deleted for good, with its documents, its evidence and its history. It cannot be brought back.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{blocked}</p>
        ) : !draft && (
          <div className="flex flex-col gap-3">
            <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
              A signed agreement is the proof that both sides agreed. The law may ask you to keep it for years, and the other side may rely on it.
              Delete it only when it was a test, or when you keep your own copy. You can download the PDF and the evidence on the agreement’s page first.
            </p>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={sure} disabled={busy} onChange={(event) => setSure(event.target.checked)} />
              <span>I understand that this agreement is deleted for good.</span>
            </label>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || (!draft && !sure)}
              onClick={(event) => { event.preventDefault(); void remove(); }}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Delete agreement
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** The Delete button of an agreement's own page. */
export const DeleteAgreementButton: React.FC<{ agreement: Target; onDeleted: () => void }> = ({ agreement, onDeleted }) => {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAsking(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <DeleteAgreementDialog agreement={asking ? agreement : null} onOpenChange={setAsking} onDeleted={onDeleted} />
    </>
  );
};

export default DeleteAgreementButton;
