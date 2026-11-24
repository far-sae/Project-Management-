// The social accounts of a workspace: the list with a way to disconnect one,
// and the window that asks which of the accounts a log-in brought should be
// added (one log-in at Facebook brings every Page of the person).
import React, { useEffect, useState } from 'react';
import { Loader2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/common/StatusPill';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { publicMessage, publicText } from '@/lib/publicError';
import { chooseSocialAccounts, disconnectSocialAccount, type FoundSocialAccount } from '@/services/social/connect';
import { PLATFORM_NAME, isPlatform } from '../../../api/_social/shared/platforms';
import type { SocialAccount } from '@/types/social';

const platformName = (provider: string): string => (isPlatform(provider) ? PLATFORM_NAME[provider] : provider.charAt(0).toUpperCase() + provider.slice(1));

interface ListProps {
  organizationId: string;
  workspaceId: string;
  accounts: SocialAccount[];
  /** Owners and admins may disconnect. */
  canManage: boolean;
  onChanged: () => void;
}

export const ConnectedAccounts: React.FC<ListProps> = ({ organizationId, workspaceId, accounts, canManage, onChanged }) => {
  const [asking, setAsking] = useState<SocialAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const disconnect = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await disconnectSocialAccount(organizationId, workspaceId, asking.id);
      toast.success(`${asking.displayName} is disconnected.`);
      setAsking(null);
      onChanged();
    } catch (error) {
      toast.error(publicMessage(error, 'The account could not be disconnected. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (accounts.length === 0) {
    return <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">No account connected yet. Press Connect above.</div>;
  }

  return (
    <>
      <ul aria-label="Connected accounts" className="divide-y divide-border rounded-lg border border-border bg-card">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" aria-label={`${platformName(account.provider)}: ${account.displayName}`}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{account.displayName}</p>
              <p className="text-sm text-muted-foreground">{platformName(account.provider)}</p>
              {account.status === 'error' && account.lastError && (
                <p className="mt-0.5 text-xs text-destructive">{publicText(account.lastError, 'This account needs to be connected again.')}</p>
              )}
            </div>
            <StatusPill tone={account.status === 'connected' ? 'success' : account.status === 'error' ? 'danger' : 'muted'}>
              {account.status === 'connected' ? 'Connected' : account.status === 'error' ? 'Connect again' : 'Not connected'}
            </StatusPill>
            {canManage && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setAsking(account)} aria-label={`Disconnect ${account.displayName}`}>
                <Unplug aria-hidden />Disconnect
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog open={asking !== null} onOpenChange={(open) => { if (!open && !busy) setAsking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {asking?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is taken out of this list and nothing more is posted to it. Posts that are waiting to go out to this account will not be sent.
              What was already posted stays on {asking ? platformName(asking.provider) : 'the platform'}. You can connect it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy} onClick={(e) => { e.preventDefault(); void disconnect(); }}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

interface ChooseProps {
  organizationId: string;
  workspaceId: string;
  /** The accounts a log-in brought that are not in the list yet. Null keeps the window closed. */
  found: FoundSocialAccount[] | null;
  onOpenChange: (open: boolean) => void;
  /** Called with how many were added. */
  onDone: (added: number) => void;
}

/** "Which of these do you want to add?" Nothing is added until the person has chosen. */
export const ChooseAccounts: React.FC<ChooseProps> = ({ organizationId, workspaceId, found, onOpenChange, onDone }) => {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const key = found?.map((a) => a.serviceId).join(',') ?? '';
  // A new log-in starts with nothing ticked: the choice is made each time.
  useEffect(() => { setTicked(new Set()); }, [key]);

  if (!found) return null;

  const finish = async (add: string[]) => {
    setBusy(true);
    try {
      const drop = found.map((a) => a.serviceId).filter((id) => !add.includes(id));
      const added = await chooseSocialAccounts(organizationId, workspaceId, add, drop);
      onDone(added);
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The accounts could not be added. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Which accounts do you want to add?</DialogTitle>
          <DialogDescription>
            Your log-in gave access to {found.length === 1 ? 'this account' : `these ${found.length} accounts`}. Tick the ones to post to from here. The others are not connected.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {found.map((account) => (
            <li key={account.serviceId}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={ticked.has(account.serviceId)} disabled={busy}
                  onChange={() => setTicked((old) => { const next = new Set(old); if (next.has(account.serviceId)) next.delete(account.serviceId); else next.add(account.serviceId); return next; })}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{account.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{platformName(account.provider)}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void finish([])}>Add none</Button>
          <Button disabled={busy || ticked.size === 0} onClick={() => void finish([...ticked])}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {ticked.size === 0 ? 'Add' : ticked.size === 1 ? 'Add 1 account' : `Add ${ticked.size} accounts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConnectedAccounts;
