import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCompanies, useCrmContacts, useCrmDealStages } from '@/hooks/useCrmHub';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/common/StatusPill';
import { leadName } from '@/lib/crmFlow';
import {
  KIND_LABEL, TRASH_DAYS, daysLeft, describeChange, recordPath, whoDid,
  type ChangeRow, type HistoryNames, type TrashItem,
} from '@/lib/crmHistory';
import { listChanges, listTrash, restoreFromTrash } from '@/services/supabase/crmHub/history';

/**
 * Two lists for the owner and admins: what was deleted in the last 30 days
 * (and can be put back), and who changed what.
 */

const when = (date: Date): string => format(date, 'd MMM yyyy, HH:mm');
const reason = (err: unknown, fallback: string): string => publicMessage(err, fallback);

/** The names behind the ids: team, stages, companies and leads of the workspace on screen. */
function useHistoryNames(): HistoryNames {
  const { organization } = useOrganization();
  const { items: stages } = useCrmDealStages();
  const { items: companies } = useCrmCompanies();
  const { items: contacts } = useCrmContacts();
  return useMemo(() => ({
    people: new Map((organization?.members ?? []).map((m) => [m.userId, m.displayName || m.email || 'A teammate'])),
    stages: new Map(stages.map((s) => [s.id, s.name])),
    companies: new Map(companies.map((c) => [c.id, c.name])),
    leads: new Map(contacts.map((c) => [c.id, leadName(c)])),
  }), [organization, stages, companies, contacts]);
}

const Frame: React.FC<{ title: string; description: string; busy: boolean; onRefresh: () => void; children: React.ReactNode }> = ({ title, description, busy, onRefresh, children }) => (
  <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-pretty text-xs text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onRefresh} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        Refresh
      </Button>
    </div>
    {children}
  </section>
);

const Message: React.FC<{ tone?: 'problem'; children: React.ReactNode }> = ({ tone, children }) => (
  <p role={tone === 'problem' ? 'alert' : undefined} className={tone === 'problem' ? 'px-4 py-8 text-center text-sm text-destructive' : 'px-4 py-8 text-center text-sm text-muted-foreground'}>
    {children}
  </p>
);

export const RecycleBin: React.FC = () => {
  const { organization, isAdmin } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const names = useHistoryNames();
  const organizationId = organization?.organizationId ?? '';
  const workspaceId = selected?.workspaceId ?? null;
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !isAdmin) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setProblem('');
    try {
      setItems(await listTrash(organizationId, workspaceId));
    } catch (err) {
      setProblem(reason(err, 'The recycle bin could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (item: TrashItem) => {
    setRestoring(item.id);
    try {
      await restoreFromTrash(item.id);
      toast.success(`${item.name} is back`);
      await load();
    } catch (err) {
      toast.error(reason(err, 'It could not be restored.'));
    } finally {
      setRestoring(null);
    }
  };

  const now = new Date();

  return (
    <Frame
      title="Recycle bin"
      description={`Leads, companies and deals deleted in the last ${TRASH_DAYS} days. Restoring one brings back its notes and timeline too.`}
      busy={loading}
      onRefresh={() => void load()}
    >
      {!isAdmin ? (
        <Message>Only the owner and admins can open the recycle bin.</Message>
      ) : problem ? (
        <Message tone="problem">{problem}</Message>
      ) : loading && items.length === 0 ? (
        <Message>Loading…</Message>
      ) : items.length === 0 ? (
        <Message>The recycle bin is empty.</Message>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const left = daysLeft(item.deletedAt, now);
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">{item.name}</span>
                    <StatusPill tone="neutral">{KIND_LABEL[item.kind]}</StatusPill>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Deleted by {whoDid(item.deletedBy, names)} on {when(item.deletedAt)}
                    {item.notes + item.timeline > 0 && ` · with ${item.notes + item.timeline} note${item.notes + item.timeline === 1 ? '' : 's'} and timeline entries`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {left === 0 ? 'Leaves the bin today.' : `Stays ${left} more day${left === 1 ? '' : 's'}.`}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void restore(item)} disabled={restoring !== null} aria-label={`Restore ${item.name}`}>
                  {restoring === item.id ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                  Restore
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
};

export const ChangeLog: React.FC = () => {
  const { organization, isAdmin } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const names = useHistoryNames();
  const organizationId = organization?.organizationId ?? '';
  const workspaceId = selected?.workspaceId ?? null;
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');

  const load = useCallback(async () => {
    if (!organizationId || !isAdmin) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setProblem('');
    try {
      setRows(await listChanges(organizationId, workspaceId));
    } catch (err) {
      setProblem(reason(err, 'The change log could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId, isAdmin]);

  useEffect(() => { void load(); }, [load]);

  // A change that only touched fields nobody reads (and so has no line to show) is left out.
  const shown = useMemo(() => rows.map((row) => ({ row, lines: describeChange(row.changes, names) })).filter((r) => r.lines.length > 0), [rows, names]);

  return (
    <Frame
      title="Change log"
      description="Who changed what on leads, companies and deals: the latest 200 changes, kept for 180 days."
      busy={loading}
      onRefresh={() => void load()}
    >
      {!isAdmin ? (
        <Message>Only the owner and admins can read the change log.</Message>
      ) : problem ? (
        <Message tone="problem">{problem}</Message>
      ) : loading && rows.length === 0 ? (
        <Message>Loading…</Message>
      ) : shown.length === 0 ? (
        <Message>No changes yet. They are written from the moment the log is set up.</Message>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map(({ row, lines }) => (
            <li key={row.id} className="px-4 py-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                <Link to={recordPath(row.kind, row.recordId)} className="truncate hover:underline">{row.name}</Link>
                <StatusPill tone="neutral">{KIND_LABEL[row.kind]}</StatusPill>
              </p>
              <p className="text-xs text-muted-foreground">{whoDid(row.changedBy, names)} · {when(row.changedAt)}</p>
              <ul className="mt-1.5 space-y-0.5">
                {lines.map((line) => <li key={line} className="break-words text-xs text-foreground">{line}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
};
