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
import { SERVICE_LABEL, WARMUP_SERVICES, type WarmupServiceName, type WarmupStatus } from '../../../api/_warmup/shared/types';

/**
 * Email, Settings: connect a warm-up service (MailReach or Mailivery) with the
 * organisation's own API key. The key goes to the server once, is checked with
 * the service, and is stored encrypted; it is never shown again. One service
 * is connected at a time: connecting the other one replaces it.
 */

/** Where each service keeps its key, and what else a person should know before they paste it. */
const KEY_HELP: Record<WarmupServiceName, string> = {
  mailreach:
    'In MailReach, open your project, then Settings, and copy the API key. It is stored encrypted and never shown again. MailReach bills you per mailbox that is warming.',
  mailivery:
    'In Mailivery, open Settings, then Team Settings, then API Access, and make a key. It is stored encrypted and never shown again. A mailbox that is already warming in Mailivery is found by its address: nothing is added twice.',
};
export const WarmupServiceCard: React.FC<{ orgId: string; isAdmin: boolean }> = ({ orgId, isAdmin }) => {
  const fieldId = useId();
  const [status, setStatus] = useState<WarmupStatus | null>(null);
  const [loading, setLoading] = useState(isAdmin);
  const [apiKey, setApiKey] = useState('');
  // The service the key being typed is for. It follows the one that is connected, until the person chooses another.
  const [chosen, setChosen] = useState<WarmupServiceName | null>(null);
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
      const inboxes = await saveWarmupKey(orgId, apiKey, service);
      setApiKey('');
      setChosen(null);
      toast.success(service === 'mailivery'
        ? `Mailivery connected: ${inboxes} mailbox${inboxes === 1 ? '' : 'es'} found.`
        : `MailReach connected: ${inboxes} inbox${inboxes === 1 ? '' : 'es'} found.`);
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
      toast.success(`${connectedName} disconnected.`);
      await load();
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setBusy(false);
    }
  };

  const warming = status ? Object.values(status.mailboxes).filter((m) => m.state !== 'not_connected').length : 0;
  const connected: WarmupServiceName | null = status?.linked ? status.service ?? 'mailreach' : null;
  const connectedName = SERVICE_LABEL[connected ?? 'mailreach'];
  const service: WarmupServiceName = chosen ?? connected ?? 'mailreach';
  const name = SERVICE_LABEL[service];
  // Typing a key for the other service than the one connected replaces the connection.
  const replacing = connected !== null && connected === service;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Warm-up service</CardTitle>
          {status?.linked && <StatusPill tone={status.problem ? 'danger' : 'success'}>{status.problem ? 'Needs attention' : 'Connected'}</StatusPill>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A new mailbox that starts sending campaigns straight away lands in spam. A warm-up service warms it up
          first: your mailbox exchanges real emails with a network of other inboxes that open them, reply and move
          them out of spam. Connect the one you use, MailReach or Mailivery, and you see its score for each mailbox
          and how much lands in spam.
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
                  ? connected === 'mailivery'
                    ? 'Connected. No mailbox is warming yet: open Accounts and press Start warm-up on a mailbox, or wait until Mailivery knows the address.'
                    : 'Connected. No mailbox is warming yet: open Accounts and press Start warm-up on a mailbox.'
                  : `Connected. ${warming} of your mailboxes ${warming === 1 ? 'is' : 'are'} in ${connectedName}.`}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-service`}>Warm-up service</Label>
              <select
                id={`${fieldId}-service`}
                className="h-11 w-fit rounded-md border border-input bg-background px-2 text-sm md:h-8"
                value={service}
                disabled={busy}
                onChange={(e) => { setChosen(e.target.value as WarmupServiceName); setProblem(null); }}
              >
                {WARMUP_SERVICES.map((id) => <option key={id} value={id}>{SERVICE_LABEL[id]}</option>)}
              </select>
              {connected !== null && connected !== service && (
                <p className="text-xs text-muted-foreground">{connectedName} is connected now. Saving a {name} key replaces it.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-key`}>{replacing ? 'Replace the API key' : `${name} API key`}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${fieldId}-key`}
                  className="max-w-md"
                  type="password"
                  autoComplete="off"
                  placeholder={`Paste your ${name} API key`}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={busy}
                />
                <Button onClick={save} disabled={busy || apiKey.trim().length < 12}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}{replacing ? 'Replace' : 'Connect'}
                </Button>
                {status?.linked && (
                  <Button variant="outline" onClick={remove} disabled={busy}>Disconnect</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{KEY_HELP[service]}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
