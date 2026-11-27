import React, { useCallback, useEffect, useId, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SetupHint } from '@/components/common/SetupHint';
import { StatusPill } from '@/components/common/StatusPill';
import { disconnectClaude, errorSentence, loadClaudeStatus, type ClaudeStatus } from '@/services/claudeConnector';

/**
 * Email, Settings: connect the Claude app. The card gives the address to add
 * in Claude, lists who has connected it, and shows what Claude did. Claude
 * then sends through the mailboxes of this page, with their limits.
 */

type Person = { userId: string; displayName?: string; email?: string };

interface Props {
  orgId: string;
  /** The signed-in person, to say "you" where a line is theirs. */
  userId: string;
  /** The people of the organisation, to put a name on a connection. */
  people: Person[];
}

const day = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const moment = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const ClaudeCard: React.FC<Props> = ({ orgId, userId, people }) => {
  const fieldId = useId();
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [cutting, setCutting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await loadClaudeStatus(orgId));
      setProblem(null);
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = (id: string): string => {
    if (id === userId) return 'you';
    const p = people.find((x) => x.userId === id);
    return p?.displayName?.trim() || p?.email || 'a colleague';
  };

  const copy = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.address);
      toast.success('Address copied.');
    } catch {
      toast.error('The address could not be copied. Select it and copy it by hand.');
    }
  };

  const cut = async (id: string) => {
    setCutting(id);
    try {
      await disconnectClaude(id);
      toast.success('Claude is disconnected. It can do nothing more from that connection.');
      await load();
    } catch (err) {
      toast.error(errorSentence(err));
    } finally {
      setCutting(null);
    }
  };

  const connected = (status?.connections.length ?? 0) > 0;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Claude</CardTitle>
          {status?.ready && <StatusPill tone={connected ? 'success' : 'neutral'}>{connected ? 'Connected' : 'Not connected'}</StatusPill>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect TaskCalendar to the Claude app. Then you can ask Claude, in plain words, to write an email and send it
          to a group of your leads. It sends through the mailboxes on this page, with the same daily limits, sending
          hours, do-not-email list and unsubscribe link. It always shows you who gets the email and asks before it sends.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Checking the connection…
          </p>
        ) : problem ? (
          <p role="alert" className="text-sm text-destructive">{problem}</p>
        ) : !status?.ready ? (
          <p role="status" className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
            <SetupHint other="Connecting Claude is not switched on yet.">Connecting Claude is not set up yet: run supabase/crm_setup.sql in the Supabase SQL editor, then open this page again.</SetupHint>
          </p>
        ) : (
          <>
            {status.mayConnect === false ? (
              <p className="text-sm text-muted-foreground">Your account does not have the Email page, so you cannot connect Claude. The owner can switch it on for you on the Team page.</p>
            ) : (
              <section aria-label="How to connect">
                <ol className="list-decimal space-y-3 pl-5 text-sm text-foreground">
                  <li>
                    <Label htmlFor={`${fieldId}-address`}>Copy this address</Label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Input id={`${fieldId}-address`} className="max-w-md font-mono text-xs" readOnly value={status.address} onFocus={(e) => e.currentTarget.select()} />
                      <Button variant="outline" onClick={() => void copy()}><Copy aria-hidden />Copy</Button>
                    </div>
                  </li>
                  <li>In the Claude app, open Settings, then Connectors, and choose “Add custom connector”. Give it a name such as TaskCalendar, paste the address and press Add.</li>
                  <li>Press Connect on the new connector. A TaskCalendar page opens: read it and press Allow.</li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  Then try: “Use TaskCalendar. Write a short email about our new offer to the group Dentists, show me who gets it, and wait for my yes.”
                </p>
              </section>
            )}

            {connected && (
              <section aria-label="Connected">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Connected</h4>
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {status.connections.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{c.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          Connected by {nameOf(c.userId)} on {day(c.createdAt)}. {c.lastUsedAt ? `Last used on ${day(c.lastUsedAt)}.` : 'Not used yet.'}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" disabled={cutting !== null} aria-label={`Disconnect ${c.clientName}, connected by ${nameOf(c.userId)}`} onClick={() => void cut(c.id)}>
                        {cutting === c.id && <Loader2 className="animate-spin" aria-hidden />}Disconnect
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {status.actions.length > 0 && (
              <section aria-label="What Claude did">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What Claude did</h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {status.actions.slice(0, 10).map((a, i) => (
                    <li key={`${a.at}-${i}`} className="flex flex-wrap gap-x-2 text-foreground">
                      <span className="tabular-nums text-muted-foreground">{moment(a.at)}</span>
                      <span>{a.summary}</span>
                      <span className="text-muted-foreground">for {nameOf(a.userId)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default ClaudeCard;
