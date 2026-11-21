import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Loader2, RefreshCw, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/common/StatusPill';
import { listReplies } from '@/services/supabase/emailReplies';
import { realReplies, type ReplyRow } from '@/lib/email/replies';

/**
 * Everyone who answered an email, newest first: the work list after a
 * campaign. The text of a reply is not kept here (the inbox scan stores no
 * subject and no body), so each row says which mailbox to read it in.
 */

interface Props {
  orgId: string;
  workspaceId: string | null;
}

export const RepliesTab: React.FC<Props> = ({ orgId, workspaceId }) => {
  const [rows, setRows] = useState<ReplyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    if (!orgId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setProblem('');
    try {
      setRows(await listReplies(orgId, workspaceId));
    } catch (err) {
      // The database's own errors are plain objects with a message, not Error instances.
      const reason = (err as { message?: unknown } | null)?.message;
      setProblem(typeof reason === 'string' && reason ? `The replies could not be loaded: ${reason}` : 'The replies could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const real = realReplies(rows);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Replies</h2>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            People who answered your campaigns and sequences, newest first. The reply itself is in your mailbox: this list
            keeps who answered and when, not what they wrote.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          Refresh
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="px-4 py-8 text-center text-sm text-destructive">{problem}</p>
      ) : loading && rows.length === 0 ? (
        <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">Loading replies…</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
          <Reply className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No replies yet.</p>
          <p className="max-w-md text-xs text-muted-foreground">
            A reply shows here when a mailbox with its inbox connected sees an answer to an email it sent. Connect the
            inbox on the Accounts tab if you have not.
          </p>
        </div>
      ) : (
        <>
          <p className="border-b border-border px-4 py-2 text-xs tabular-nums text-muted-foreground">
            {real} repl{real === 1 ? 'y' : 'ies'}
            {rows.length > real && `, and ${rows.length - real} automatic answer${rows.length - real === 1 ? '' : 's'}`}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{row.who}</span>
                    {row.automatic && <StatusPill tone="muted">Automatic answer</StatusPill>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.who !== row.address && <>{row.address} · </>}
                    answered {row.answered}{row.subject ? `: “${row.subject}”` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.mailbox ? <>Read it in {row.mailbox}.</> : <>The mailbox it arrived in has been removed.</>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <time dateTime={row.at.toISOString()} className="text-xs tabular-nums text-muted-foreground">
                    {format(row.at, 'd MMM yyyy, HH:mm')}
                  </time>
                  {row.contactId ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/crm/contacts/${row.contactId}`}>Open lead</Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not a lead in the CRM</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default RepliesTab;
