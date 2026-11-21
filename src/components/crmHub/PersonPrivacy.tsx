import { publicMessage } from '@/lib/publicError';
import React, { useState } from 'react';
import { Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { exportFileName } from '@/lib/crmPersonData';
import { leadName } from '@/lib/crmFlow';
import { collectPersonData, erasePerson } from '@/services/supabase/crmHub/privacy';
import type { CrmContact } from '@/types/crmHub';

/**
 * The two things a person can ask of you about their data: a copy of it, and
 * to have it removed. Both for one lead, from the lead's own page.
 */

interface Props {
  contact: CrmContact;
  companyName: string | null;
  /** Only the organisation's owner may erase a person. */
  isOwner: boolean;
  /** Called after the person is erased: the page they were on no longer exists. */
  onErased: () => void;
}

/** Hands the browser a file to save. */
function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const PersonPrivacy: React.FC<Props> = ({ contact, companyName, isOwner, onErased }) => {
  const [busy, setBusy] = useState<'copy' | 'erase' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState('');
  const name = leadName(contact);

  const download = async () => {
    setBusy('copy');
    try {
      const data = await collectPersonData(contact, companyName);
      saveFile(exportFileName(name, new Date()), JSON.stringify(data, null, 2));
      toast.success(`A copy of ${name}’s data was saved to your downloads`);
    } catch (err) {
      toast.error(publicMessage(err, 'The copy could not be made. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    setBusy('erase');
    setProblem('');
    try {
      await erasePerson(contact.id);
      toast.success(`${name} was erased`);
      setConfirming(false);
      onErased();
    } catch (err) {
      setProblem(publicMessage(err, 'This person could not be erased. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={busy !== null}>
            {busy === 'copy' ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            Privacy
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => void download()}>
            <Download aria-hidden />Download this person’s data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!isOwner}
            className="text-destructive focus:text-destructive"
            onSelect={() => { setProblem(''); setConfirming(true); }}
          >
            <Trash2 aria-hidden />{isOwner ? 'Erase this person…' : 'Erase this person (owner only)'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={(open) => { if (busy !== 'erase') setConfirming(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase {name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This removes the lead with its notes and timeline, its follow-ups, the emails sent to it, the record of
                  its replies, and its calls with their recordings.
                </p>
                <p>
                  Deals, agreements and invoices stay, because they are business records; they only lose their link to
                  this person. The email address stays on your do-not-email list, so the person is never emailed again.
                </p>
                <p className="font-medium text-foreground">This cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'erase'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === 'erase'}
              onClick={(e) => { e.preventDefault(); void erase(); }}
            >
              {busy === 'erase' && <Loader2 className="animate-spin" aria-hidden />}
              Erase for good
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
