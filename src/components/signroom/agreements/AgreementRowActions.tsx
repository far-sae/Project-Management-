import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { canTrash } from '@/lib/signroom/agreementFormat';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Agreement, AgreementSummary } from '../../../../api/_signroom/shared/types';
import { messageOf } from './files';
import { DeleteAgreementDialog } from './DeleteAgreement';

export const TRASH_BLOCKED_NOTE =
  'Active signing must be cancelled or completed before deletion. Legal holds prevent deletion.';

/** Where an agreement opens: a draft outside Trash goes to the editor, anything else to its page. */
export const agreementPath = (a: Pick<AgreementSummary, 'id' | 'status' | 'trashedAt'>): string =>
  a.status === 'Draft' && !a.trashedAt ? `/crm/agreements/${a.id}/edit` : `/crm/agreements/${a.id}`;

interface AgreementRowActionsProps {
  agreement: AgreementSummary;
  /** Opens the quick look at the document, when the list offers one. */
  onView?: () => void;
  /** Called with the agreement as the server returned it after a change. */
  onChange: (agreement: Agreement) => void;
  /** Called once the agreement was deleted for good, so the list can drop its row. Without it, the menu does not offer deleting. */
  onDeleted?: (id: string) => void;
}

/** The menu on a row of the list: open, archive or unarchive, move to Trash or restore. */
export const AgreementRowActions: React.FC<AgreementRowActionsProps> = ({ agreement: a, onView, onChange, onDeleted }) => {
  const { client } = useSignroom();
  const [busy, setBusy] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const run = async (name: 'archive' | 'unarchive' | 'trash' | 'restore') => {
    setBusy(true);
    try {
      onChange(await client.call<Agreement>(`agreements/${a.id}/${name}`, {}));
      toast.success(name === 'trash'
        ? 'Document moved to Trash. You can restore it from the Trash filter.'
        : 'Document updated.');
      setConfirmTrash(false);
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const trashable = canTrash(a);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`More actions for ${a.title}`} disabled={busy}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onView && <DropdownMenuItem onClick={onView}>Quick look</DropdownMenuItem>}
          <DropdownMenuItem asChild>
            <Link to={agreementPath(a)}>{a.status === 'Draft' && !a.trashedAt ? 'Continue editing' : 'Open agreement'}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {a.trashedAt ? (
            <DropdownMenuItem onClick={() => void run('restore')}>Restore</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => void run(a.archivedAt ? 'unarchive' : 'archive')}>
                {a.archivedAt ? 'Unarchive' : 'Archive'}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={!trashable}
                title={trashable ? undefined : TRASH_BLOCKED_NOTE}
                onClick={() => setConfirmTrash(true)}
              >
                Move to Trash
              </DropdownMenuItem>
            </>
          )}
          {onDeleted && (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(true)}>
              Delete for good
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onDeleted && (
        <DeleteAgreementDialog agreement={deleting ? a : null} onOpenChange={setDeleting} onDeleted={() => onDeleted(a.id)} />
      )}

      <AlertDialog open={confirmTrash} onOpenChange={(open) => { if (!busy) setConfirmTrash(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move this document to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              You can restore it later. Permanent removal follows the existing retention policy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep document</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void run('trash'); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AgreementRowActions;
