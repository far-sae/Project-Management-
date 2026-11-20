import React, { useCallback, useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/common/StatusPill';
import {
  errorSentence, removeWarmupKey, saveWarmupKey, warmupStatus,
} from '@/services/email/warmup';
import type { WarmupStatus } from '../../../api/_warmup/shared/types';

/**
 * Email, Settings: connect the warm-up service (MailReach) with the
 * organisation's own API key. The key goes to the server once, is checked with
 * the service, and is stored encrypted; it is never shown again.
 */
export const WarmupServiceCard: React.FC<{ orgId: string; isAdmin: boolean }> = ({ orgId, isAdmin }) => {
  const fieldId = useId();
  const [status, setStatus] = useState<WarmupStatus | null>(null);
  const [loading, setLoading] = useState(isAdmin);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      setStatus(await warmupStatus(orgId, null));
      setProblem(null);
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, orgId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const inboxes = await saveWarmupKey(orgId, apiKey);
      setApiKey('');
      toast.success(`MailReach connected: ${inboxes} inbox${inboxes === 1 ? '' : 'es'} found.`);
      await load();
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await removeWarmupKey(orgId);
      toast.success('MailReach disconnected.');
      await load();
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setBusy(false);
    }
  };

  const warming = status ? Object.values(status.mailboxes).filter((m) => m.state !== 'not_connected').length : 0;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Warm-up service</CardTitle>
          {status?.linked && <StatusPill tone={status.problem ? 'danger' : 'success'}>{status.problem ? 'Needs attention' : 'Connected'}</StatusPill>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A new mailbox that starts sending campaigns straight away lands in spam. MailReach warms it up first: your
          mailbox exchanges real emails with a network of other inboxes that open them, reply and move them out of
          spam. Here you see its reputation score and how much lands in spam.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAdmin ? (
          <p className="text-sm text-muted-foreground">Only an organization owner or admin can connect the warm-up service.</p>
        ) : loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Checking the warm-up service…
          </p>
        ) : (
          <>
            {(problem ?? status?.problem) && <p role="alert" className="text-sm text-destructive">{problem ?? status?.problem}</p>}
            {status?.linked && !status.problem && (
              <p className="text-sm text-foreground">
                {warming === 0
                  ? 'Connected. No mailbox is warming yet: open Accounts and press Start warm-up on a mailbox.'
                  : `Connected. ${warming} of your mailboxes ${warming === 1 ? 'is' : 'are'} in MailReach.`}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-key`}>{status?.linked ? 'Replace the API key' : 'MailReach API key'}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${fieldId}-key`}
                  className="max-w-md"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the key from your MailReach project"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={busy}
                />
                <Button onClick={save} disabled={busy || apiKey.trim().length < 12}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}{status?.linked ? 'Replace' : 'Connect'}
                </Button>
                {status?.linked && (
                  <Button variant="outline" onClick={remove} disabled={busy}>Disconnect</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                In MailReach, open your project, then Settings, and copy the API key. It is stored encrypted and never
                shown again. MailReach bills you per mailbox that is warming.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
