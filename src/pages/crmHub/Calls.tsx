import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Grip, Loader2, Phone, PhoneCall, Search, Trash2, PhoneIncoming } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmContacts, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { useCalling } from '@/hooks/useCalling';
import { leadName } from '@/lib/crmFlow';
import { publicText } from '@/lib/publicError';
import { deleteCall, errorSentence, listCalls } from '@/services/voice/client';
import { PageHeader } from '@/components/common/PageHeader';
import { CallBacksDialog } from '@/components/crmHub/CallBacksDialog';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { CallDialog } from '@/components/crmHub/CallDialog';
import { CallRecording } from '@/components/crmHub/CallRecording';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  OUTCOME_LABEL, type CallList, type CallListItem, type CallOutcome, type CallStatus,
} from '../../../api/_voice/shared/types';

/**
 * Every call placed from the CRM in this workspace: who was rung, how it went,
 * the caller's note and the recording. A lead can be rung from here as well.
 * For the organisation's owner and admins.
 */

type Filter = 'all' | 'answered' | 'missed' | 'recorded';

const STATUS_LABEL: Record<CallStatus, string> = {
  starting: 'Not finished',
  ringing: 'Not finished',
  completed: 'Answered',
  no_answer: 'No answer',
  busy: 'Line was busy',
  failed: 'Did not connect',
  canceled: 'Hung up',
};

const OUTCOME_TONE: Record<CallOutcome, StatusTone> = {
  connected: 'success',
  voicemail: 'info',
  no_answer: 'neutral',
  busy: 'neutral',
  wrong_number: 'warning',
};

/** What the call's pill says: the caller's own words when they gave them, else how the line ended. */
const resultOf = (call: CallListItem): { label: string; tone: StatusTone } => {
  if (call.outcome) return { label: OUTCOME_LABEL[call.outcome], tone: OUTCOME_TONE[call.outcome] };
  // A call back nobody took is worth a look: it is a lead who wanted to talk.
  if (call.direction === 'in' && !call.answeredBy && !(call.status === 'completed' && call.seconds > 0)) return { label: 'Missed', tone: 'danger' };
  if (call.status === 'completed') return { label: STATUS_LABEL.completed, tone: 'success' };
  if (call.status === 'failed') return { label: STATUS_LABEL.failed, tone: 'danger' };
  return { label: STATUS_LABEL[call.status], tone: 'neutral' };
};

const wasAnswered = (call: CallListItem): boolean => call.status === 'completed' && call.seconds > 0;

const lengthOf = (seconds: number): string => {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return seconds % 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.floor(seconds / 60)} min`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${Math.floor(seconds / 3600)} h ${minutes} min` : `${Math.floor(seconds / 3600)} h`;
};

const whenOf = (iso: string): string => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
};

type Dialing = { name: string; phone: string; target: { contactId: string } | { companyId: string } | { workspaceId: string } };

const BOX = 'overflow-hidden rounded-lg border border-border bg-card';

export const CrmCallsPage: React.FC = () => {
  // Deleting a call (with its recording) is for the organisation's owner alone.
  const { isAdmin, isOwner } = useOrganization();
  /** The window that says who takes the calls that come in. */
  const [callBacksOpen, setCallBacksOpen] = useState(false);
  const workspaceId = useWorkspaceForCreate();
  const calling = useCalling();
  const { items: leads } = useCrmContacts();

  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [summary, setSummary] = useState<CallList['summary'] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [dialing, setDialing] = useState<Dialing | null>(null);
  const [deleting, setDeleting] = useState<CallListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** The calls ticked to be deleted together (the owner only). */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [askMany, setAskMany] = useState(false);
  /** While several calls are being deleted: how many are done. */
  const [manyDone, setManyDone] = useState<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!isAdmin || !workspaceId) return;
    // After a delete the list is read again for its totals: what is on screen stays until the answer is there.
    if (!quiet) setLoading(true);
    setProblem(null);
    try {
      const out = await listCalls(workspaceId);
      setCalls(out.calls);
      setSummary(out.summary);
      setMore(out.more);
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const loadOlder = async () => {
    const last = calls[calls.length - 1];
    if (!workspaceId || !last) return;
    setLoadingMore(true);
    try {
      const out = await listCalls(workspaceId, last.at);
      setCalls((shown) => [...shown, ...out.calls.filter((c) => !shown.some((s) => s.id === c.id))]);
      setMore(out.more);
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteCall(deleting.id);
      setCalls((list) => list.filter((c) => c.id !== deleting.id));
      setDeleting(null);
      toast.success('Call deleted.');
      setTicked((old) => { const next = new Set(old); next.delete(deleting.id); return next; });
      // The totals above the list count this call too.
      void load(true);
    } catch (err) {
      toast.error(errorSentence(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  /**
   * Deletes the ticked calls, one after the other (each takes its recording at
   * the phone provider with it). It stops at the first one that cannot be
   * deleted and says how far it came: what was deleted stays deleted.
   */
  const deleteMany = async () => {
    const ids = calls.filter((c) => ticked.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    setManyDone(0);
    const gone: string[] = [];
    let stopped: unknown = null;
    for (const id of ids) {
      try {
        await deleteCall(id);
        gone.push(id);
        setManyDone(gone.length);
      } catch (err) {
        stopped = err;
        break;
      }
    }
    setCalls((list) => list.filter((c) => !gone.includes(c.id)));
    setTicked((old) => new Set([...old].filter((id) => !gone.includes(id))));
    setManyDone(null);
    setAskMany(false);
    if (stopped) toast.error(`${gone.length} of ${ids.length} calls were deleted. ${errorSentence(stopped)}`);
    else toast.success(gone.length === 1 ? 'Call deleted.' : `${gone.length} calls deleted.`);
    if (gone.length > 0) void load(true);
  };

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const digits = words.replace(/\D/g, '');
    return calls.filter((call) => {
      if (filter === 'answered' && !wasAnswered(call)) return false;
      if (filter === 'missed' && wasAnswered(call)) return false;
      if (filter === 'recorded' && !call.recorded) return false;
      if (!words) return true;
      const who = call.direction === 'in' ? call.answeredBy ?? '' : call.caller.name;
      const text = `${call.contact?.name ?? ''} ${call.company?.name ?? ''} ${who} ${call.note}`.toLowerCase();
      return text.includes(words) || (digits.length >= 3 && call.to.replace(/\D/g, '').includes(digits));
    });
  }, [calls, filter, query]);

  const callable = useMemo(() => leads.filter((lead) => (lead.phone ?? '').trim()), [leads]);
  const picked = useMemo(() => {
    const words = pickQuery.trim().toLowerCase();
    const digits = words.replace(/\D/g, '');
    const hits = !words
      ? callable
      : callable.filter((lead) =>
        leadName(lead).toLowerCase().includes(words)
        || (lead.email ?? '').toLowerCase().includes(words)
        || (digits.length >= 3 && (lead.phone ?? '').replace(/\D/g, '').includes(digits)));
    return hits.slice(0, 8);
  }, [callable, pickQuery]);

  if (!isAdmin) {
    return (
      <main className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader title="Calls" />
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Only the owner and admins can see calls and their recordings.
          </div>
        </div>
      </main>
    );
  }

  if (!workspaceId) {
    return (
      <main className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader title="Calls" />
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Choose a workspace in the sidebar to see its calls.
          </div>
        </div>
      </main>
    );
  }

  const canCall = calling.inApp;
  const again = (call: CallListItem): Dialing | null => {
    if (call.contact) return { name: call.contact.name, phone: call.display, target: { contactId: call.contact.id } };
    if (call.company) return { name: call.company.name, phone: call.display, target: { companyId: call.company.id } };
    // A number that was dialled by hand, or whose record is gone: ring the number itself.
    return workspaceId ? { name: '', phone: call.display, target: { workspaceId } } : null;
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Calls"
          description="Every call placed from the CRM in this workspace, with the caller's note and the recording."
          actions={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  className="w-56 pl-8"
                  type="search"
                  placeholder="Search calls"
                  aria-label="Search calls"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <SelectTrigger className="w-44" aria-label="Filter calls"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All calls</SelectItem>
                  <SelectItem value="answered">Answered</SelectItem>
                  <SelectItem value="missed">Not answered</SelectItem>
                  <SelectItem value="recorded">With a recording</SelectItem>
                </SelectContent>
              </Select>
              {canCall && workspaceId && (
                <Button variant="outline" onClick={() => setCallBacksOpen(true)}>
                  <PhoneIncoming aria-hidden />Call-backs
                </Button>
              )}
              {canCall && workspaceId && (
                <Button variant="outline" onClick={() => setDialing({ name: '', phone: '', target: { workspaceId } })}>
                  <Grip aria-hidden />Dialer
                </Button>
              )}
              {canCall && (
                <Button onClick={() => { setPickQuery(''); setPicking(true); }}>
                  <PhoneCall aria-hidden />Call a lead
                </Button>
              )}
            </>
          }
        />

        {(!calling.setup.configured || calling.setup.problem) && (
          <div role="status" className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm">
            {calling.setup.problem
              ? publicText(calling.setup.problem, 'Calling is not switched on yet.')
              : 'Calling is not set up yet. Once a phone provider is connected, leads can be rung from here and every call is listed with its recording.'}
          </div>
        )}

        {summary && (
          <dl aria-label={`Last ${summary.days} days`} className="grid grid-cols-3 gap-3">
            {[
              ['Calls', String(summary.total)],
              ['Answered', String(summary.answered)],
              ['Talk time', lengthOf(summary.seconds)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label} · last {summary.days} days</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <section className={BOX} aria-label="Calls">
          <div className="flex min-h-11 items-center border-b border-border px-4">
            <h2 className="text-sm font-semibold text-foreground">
              <span className="tabular-nums">{shown.length}</span> call{shown.length === 1 ? '' : 's'}
            </h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading calls…
            </div>
          ) : problem && calls.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <p role="alert" className="text-sm text-destructive">{problem}</p>
              <Button variant="outline" onClick={() => void load()}>Try again</Button>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
              <Phone className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              {calls.length === 0 ? (
                <>
                  <p className="text-sm font-medium">No calls yet.</p>
                  <p className="text-xs text-muted-foreground">Ring a lead from here or from the lead’s own page, and the call appears in this list.</p>
                  {canCall && (
                    <Button className="mt-3" onClick={() => { setPickQuery(''); setPicking(true); }}>
                      <PhoneCall aria-hidden />Call a lead
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No call matches.</p>
                  <Button variant="outline" className="mt-3" onClick={() => { setFilter('all'); setQuery(''); }}>Show all calls</Button>
                </>
              )}
            </div>
          ) : (
            <>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox" className="h-4 w-4 accent-primary" aria-label="Select every call shown"
                    checked={shown.length > 0 && shown.every((c) => ticked.has(c.id))}
                    onChange={(e) => setTicked((old) => {
                      const next = new Set(old);
                      for (const c of shown) { if (e.target.checked) next.add(c.id); else next.delete(c.id); }
                      return next;
                    })}
                  />
                  <span className="text-muted-foreground">{ticked.size > 0 ? `${ticked.size} selected` : 'Select all'}</span>
                </label>
                {ticked.size > 0 && (
                  <>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setAskMany(true)}>
                      <Trash2 aria-hidden />Delete {ticked.size === 1 ? '1 call' : `${ticked.size} calls`}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTicked(new Set())}>Clear</Button>
                  </>
                )}
              </div>
            )}
            <ul>
              {shown.map((call) => {
                const result = resultOf(call);
                const redial = again(call);
                return (
                  <li key={call.id} className="flex flex-col gap-1 border-b border-border/60 px-4 py-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {isOwner && (
                        <input
                          type="checkbox" className="h-4 w-4 accent-primary"
                          aria-label={`Select the call to ${call.contact?.name || call.company?.name || call.display}`}
                          checked={ticked.has(call.id)}
                          onChange={() => setTicked((old) => { const next = new Set(old); if (next.has(call.id)) next.delete(call.id); else next.add(call.id); return next; })}
                        />
                      )}
                      {call.contact ? (
                        <Link className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to={`/crm/contacts/${call.contact.id}`}>
                          {call.contact.name || 'Lead'}
                        </Link>
                      ) : call.company ? (
                        <Link className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to={`/crm/companies/${call.company.id}`}>
                          {call.company.name || 'Company'}
                        </Link>
                      ) : (
                        // A number dialled by hand, or one whose lead or company was deleted since.
                        <span className="text-sm font-medium tabular-nums text-foreground">{call.display}</span>
                      )}
                      {call.direction === 'in' && (
                        <StatusPill tone="info" dot={false}><PhoneIncoming className="mr-1 inline h-3 w-3" aria-hidden />Called back</StatusPill>
                      )}
                      <StatusPill tone={result.tone}>{result.label}</StatusPill>
                      {call.direction === 'in' && call.answeredBy && <span className="text-xs text-muted-foreground">Answered by {call.answeredBy}</span>}
                      {call.seconds > 0 && <span className="text-xs tabular-nums text-muted-foreground">{lengthOf(call.seconds)}</span>}
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        <time dateTime={call.at}>{whenOf(call.at)}</time>
                        {call.direction !== 'in' && call.caller.name ? ` · ${call.caller.name}` : ''}
                      </span>
                      {canCall && redial && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Call ${redial.name || call.display} again`}
                          onClick={() => setDialing(redial)}
                        >
                          <Phone aria-hidden />Call again
                        </Button>
                      )}
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 px-0 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete the call to ${call.contact?.name || call.company?.name || call.display}`}
                          title="Delete call"
                          onClick={() => setDeleting(call)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {call.display}{call.contact ? ' · Lead' : call.company ? ' · Company' : ''}
                    </p>
                    {call.note && <p className="max-w-3xl whitespace-pre-line break-words text-sm text-muted-foreground">{call.note}</p>}
                    {call.recorded && <CallRecording callId={call.id} />}
                  </li>
                );
              })}
            </ul>
            </>
          )}
          {more && !loading && (
            <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-3">
              {problem && calls.length > 0 && <p role="alert" className="text-xs text-destructive">{problem}</p>}
              <Button variant="outline" size="sm" onClick={() => void loadOlder()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" aria-hidden />}Show older calls
              </Button>
            </div>
          )}
        </section>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Call a lead</DialogTitle>
            <DialogDescription>Leads of this workspace that have a phone number.</DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            placeholder="Name, email or number"
            aria-label="Find a lead"
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
          />
          {picked.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {callable.length === 0 ? 'No lead in this workspace has a phone number yet.' : 'No lead with a phone number matches.'}
            </p>
          ) : (
            <ul className={BOX}>
              {picked.map((lead) => (
                <li key={lead.id} className="border-b border-border/60 last:border-0">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                    onClick={() => {
                      setPicking(false);
                      setDialing({ name: leadName(lead), phone: lead.phone ?? '', target: { contactId: lead.id } });
                    }}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">{leadName(lead)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{lead.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {workspaceId && <CallBacksDialog open={callBacksOpen} workspaceId={workspaceId} onOpenChange={setCallBacksOpen} />}

      <AlertDialog open={askMany} onOpenChange={(open) => { if (!open && manyDone === null) setAskMany(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {ticked.size === 1 ? 'this call' : `${ticked.size} calls`}?</AlertDialogTitle>
            <AlertDialogDescription>
              {ticked.size === 1 ? 'It is' : 'They are'} removed for good, together with {ticked.size === 1 ? 'its recording and its entry' : 'their recordings and their entries'} on the timeline.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={manyDone !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={manyDone !== null}
              onClick={(e) => { e.preventDefault(); void deleteMany(); }}
            >
              {manyDone !== null && <Loader2 className="animate-spin" aria-hidden />}
              {manyDone !== null ? `Deleting ${manyDone + 1} of ${ticked.size}…` : `Delete ${ticked.size === 1 ? 'call' : `${ticked.size} calls`}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deleteBusy) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  The call to {deleting.contact?.name || deleting.company?.name || deleting.display} on {whenOf(deleting.at)} is
                  removed for good{deleting.recorded ? ', together with its recording' : ''} and its entry on the timeline.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
            >
              {deleteBusy && <Loader2 className="animate-spin" aria-hidden />}Delete call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dialing && (
        <CallDialog
          open
          onOpenChange={(open) => { if (!open) setDialing(null); }}
          name={dialing.name}
          phone={dialing.phone}
          target={dialing.target}
          setup={calling.setup}
          onLogged={() => void load()}
        />
      )}
    </main>
  );
};

export default CrmCallsPage;
