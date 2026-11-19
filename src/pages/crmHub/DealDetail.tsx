import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import { getDeal, updateDeal, deleteDeal } from '@/services/supabase/crmHub/deals';
import { getCompany } from '@/services/supabase/crmHub/companies';
import { getContact } from '@/services/supabase/crmHub/contacts';
import { listDealStages } from '@/services/supabase/crmHub/dealStages';
import { listActivities } from '@/services/supabase/crmHub/activities';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { currencyNotSaved, dealCurrency } from '@/lib/crmDealMoney';
import { dealBadge, dealNeedsHandoff, leadName, weightedDealValue } from '@/lib/crmFlow';
import type {
  CrmDeal, CrmDealStage, CrmActivity, CrmNote, CrmTask, CrmCompany, CrmContact,
} from '@/types/crmHub';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { useDealMove } from '@/components/crmHub/useDealMove';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useDealMoney } from '@/hooks/useDealMoney';

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const Section: React.FC<{ title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({
  title, action, children,
}) => (
  <section className="rounded-lg border border-border bg-card">
    <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-4 py-2">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {action}
    </header>
    <div className="p-4">{children}</div>
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
    <dt className="shrink-0 text-muted-foreground">{label}</dt>
    <dd className="min-w-0 truncate text-right font-medium text-foreground">{children}</dd>
  </div>
);

export const CrmDealDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { format: fmtCurrency } = useCrmCurrency();
  const { formatDeal, formatDealConverted, allInCompany } = useDealMoney();

  const [deal, setDeal] = useState<CrmDeal | null>(null);
  const [stages, setStages] = useState<CrmDealStage[]>([]);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const d = await getDeal(id);
      if (!d) { setNotFound(true); return; }
      setDeal(d);
      const [stageRows, actRows, noteRows, taskRows] = await Promise.all([
        d.workspaceId ? listDealStages(orgId, d.workspaceId) : Promise.resolve([]),
        listActivities(orgId, { dealId: id, limit: 100 }),
        listNotes(orgId, { dealId: id }),
        listTasks(orgId, { dealId: id }),
      ]);
      setStages(stageRows);
      setActivities(actRows);
      setNotes(noteRows);
      setTasks(taskRows);
      setCompany(d.companyId ? await getCompany(d.companyId) : null);
      setContact(d.contactId ? await getContact(d.contactId) : null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load deal');
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-deal-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `deal_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `deal_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `deal_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  const { requestMove, openHandoff, busy: moving, dialogs } = useDealMove({ stages, onChanged: refresh });

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, workspaceId: deal?.workspaceId ?? null, body: noteBody.trim(), dealId: id }, user?.userId ?? null);
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteDeal(id);
      toast.success('Deal deleted');
      navigate('/crm/deals');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
      setBusy(false);
    }
  };

  if (loading) return (
    <main className="flex flex-1 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </main>
  );

  if (notFound || !deal) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">This deal no longer exists.</p>
      <Button asChild variant="outline"><Link to="/crm/deals"><ChevronLeft /> Back to deals</Link></Button>
    </main>
  );

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const currentStage = stageById.get(deal.stageId);
  const badge = dealBadge(deal);
  const chance = deal.probability || currentStage?.probability || 0;
  const wonStage = stages.find((s) => s.status === 'won');
  const lostStage = stages.find((s) => s.status === 'lost');
  const needsHandoff = dealNeedsHandoff(deal);
  // The deal is shown in its own currency; the forecast is in the company currency, like every total.
  const converted = formatDealConverted(deal);
  const forecast = allInCompany([deal]).reduce((sum, d) => sum + weightedDealValue(d, stageById), 0);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="flex flex-col gap-3">
          <Link to="/crm/deals" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> Deals
          </Link>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="break-words">{deal.name}</span>
                <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
              </span>
            }
            description={
              <>
                <span className="font-medium tabular-nums text-foreground">{formatDeal(deal)}</span>
                {converted && <> <span className="tabular-nums">{converted}</span></>}
                {company && <> · <Link to={`/crm/companies/${company.id}`} className="hover:text-foreground hover:underline">{company.name}</Link></>}
                {contact && <> · <Link to={`/crm/contacts/${contact.id}`} className="hover:text-foreground hover:underline">{leadName(contact)}</Link></>}
              </>
            }
            actions={
              <>
                {deal.status === 'open' && lostStage && (
                  <Button variant="outline" onClick={() => requestMove(deal, lostStage.id)} disabled={moving}>Lost</Button>
                )}
                {deal.status === 'open' && wonStage && (
                  <Button onClick={() => requestMove(deal, wonStage.id)} disabled={moving}>Won</Button>
                )}
                {deal.projectId && (
                  <Button onClick={() => navigate(`/project/${deal.projectId}`)}>Open project <ChevronRight /></Button>
                )}
                <Button variant="outline" size="icon" aria-label="Edit deal" onClick={() => setShowEdit(true)}><Pencil /></Button>
                <Button variant="outline" size="icon" aria-label="Delete deal" onClick={() => setShowDelete(true)}><Trash2 /></Button>
              </>
            }
          />
        </div>

        {/* Pipeline: where the deal is, and one click to move it. */}
        {stages.length > 0 && (
          <nav aria-label="Pipeline stage" className="overflow-x-auto">
            <ol className="flex min-w-max overflow-hidden rounded-lg border border-border">
              {stages.map((s, index) => {
                const current = s.id === deal.stageId;
                const done = deal.status === 'open' && s.status === 'open' && currentStage != null && s.sortOrder < currentStage.sortOrder;
                return (
                  <li key={s.id} className={cn('flex-1', index > 0 && 'border-l border-border')}>
                    <button
                      type="button"
                      disabled={moving || current}
                      aria-current={current ? 'step' : undefined}
                      onClick={() => requestMove(deal, s.id)}
                      className={cn(
                        'flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium transition-colors',
                        current
                          ? s.status === 'lost'
                            ? 'bg-destructive text-destructive-foreground'
                            : s.status === 'won'
                              ? 'bg-success text-success-foreground'
                              : 'bg-foreground text-background'
                          : done
                            ? 'bg-secondary text-foreground hover:bg-foreground/[0.08]'
                            : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                      )}
                    >
                      {s.name}
                      {s.status === 'open' && <span className="text-xs tabular-nums opacity-70">{s.probability}%</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {needsHandoff && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-warning-soft-foreground">
            <div className="min-w-0">
              <p className="text-sm font-medium">Won, but not handed off yet</p>
              <p className="text-sm opacity-90">Turn this deal into a project so the team can start the work.</p>
            </div>
            <Button onClick={() => openHandoff(deal)}>Hand off to project</Button>
          </div>
        )}
        {deal.status === 'lost' && (
          <div className="rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3 text-destructive-soft-foreground">
            <p className="text-sm font-medium">Lost{deal.closedAt ? ` on ${deal.closedAt.toLocaleDateString()}` : ''}</p>
            <p className="text-sm opacity-90">{deal.lostReason || 'No reason was given.'} Pick an open stage above to re-open it.</p>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="Notes">
              <div className="flex flex-col gap-2">
                <Textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="What was said, what was agreed…" disabled={busy} aria-label="New note" />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddNote} disabled={busy || !noteBody.trim()}>
                    {busy && <Loader2 className="animate-spin" />}Save note
                  </Button>
                </div>
              </div>
              {notes.length > 0 && (
                <ul className="mt-3 flex flex-col divide-y divide-border border-t border-border">
                  {notes.slice(0, 5).map((n) => (
                    <li key={n.id} className="py-3">
                      <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{when(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title={`Follow-ups (${tasks.length})`}
              action={<Button asChild size="sm" variant="outline"><Link to="/crm/tasks">All follow-ups</Link></Button>}
            >
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No follow-ups on this deal.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">{t.dueDate ? when(t.dueDate) : 'No due date'}</p>
                      </div>
                      <StatusPill tone={t.status === 'completed' ? 'success' : 'neutral'}>
                        <span className="capitalize">{t.status === 'completed' ? 'Done' : t.status.replace(/_/g, ' ')}</span>
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Timeline">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has happened on this deal yet.</p>
              ) : (
                <ol className="flex flex-col gap-3 border-l border-border pl-4">
                  {activities.slice(0, 20).map((a) => (
                    <li key={a.id} className="relative">
                      <span aria-hidden className="absolute -left-[1.3125rem] top-1.5 h-2 w-2 rounded-full border border-border bg-background" />
                      <p className="text-sm">{a.description ?? a.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs capitalize text-muted-foreground">{a.type.replace(/_/g, ' ')} · {when(a.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>

          <Section title="Details">
            <dl className="flex flex-col divide-y divide-border">
              <Field label="Value">
                <span className="tabular-nums">{formatDeal(deal)}</span>
                {converted && (
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{converted}</span>
                )}
              </Field>
              {deal.status === 'open' && (
                <>
                  <Field label="Chance of winning"><span className="tabular-nums">{chance}%</span></Field>
                  <Field label="Forecast">
                    <span className="tabular-nums">{fmtCurrency(forecast)}</span>
                  </Field>
                </>
              )}
              <Field label="Stage">{currentStage?.name ?? '—'}</Field>
              <Field label="Expected close">
                {deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toLocaleDateString() : '—'}
              </Field>
              {deal.closedAt && <Field label={deal.status === 'won' ? 'Won on' : 'Closed on'}>{deal.closedAt.toLocaleDateString()}</Field>}
              <Field label="Company">
                {company ? <Link to={`/crm/companies/${company.id}`} className="hover:underline">{company.name}</Link> : '—'}
              </Field>
              <Field label="Lead">
                {contact ? <Link to={`/crm/contacts/${contact.id}`} className="hover:underline">{leadName(contact)}</Link> : '—'}
              </Field>
              <Field label="Source">{deal.source || '—'}</Field>
              <Field label="Project">
                {deal.projectId
                  ? <Link to={`/project/${deal.projectId}`} className="hover:underline">Open project</Link>
                  : deal.status === 'won' ? 'Not handed off' : '—'}
              </Field>
            </dl>
            {deal.notes && (
              <p className="mt-3 whitespace-pre-wrap break-words border-t border-border pt-3 text-sm text-muted-foreground">{deal.notes}</p>
            )}
          </Section>
        </div>
      </div>

      {dialogs}

      <EditDealDialog deal={deal} open={showEdit} onOpenChange={setShowEdit} onSaved={refresh} />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              Follow-ups and notes on this deal will be removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

const EditDealDialog: React.FC<{
  deal: CrmDeal;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ deal, open, onOpenChange, onSaved }) => {
  const { code: companyCurrency } = useCrmCurrency();
  /** The currency the deal is in now. */
  const savedCurrency = dealCurrency(deal, companyCurrency);
  const [name, setName] = useState(deal.name);
  const [value, setValue] = useState<string>(deal.value.toString());
  const [currency, setCurrency] = useState(savedCurrency);
  const [probability, setProbability] = useState<string>(deal.probability.toString());
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>(deal.expectedCloseDate ?? '');
  const [source, setSource] = useState(deal.source ?? '');
  const [notes, setNotes] = useState(deal.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(deal.name);
      setValue(deal.value.toString());
      setCurrency(savedCurrency);
      setProbability(deal.probability.toString());
      setExpectedCloseDate(deal.expectedCloseDate ?? '');
      setSource(deal.source ?? '');
      setNotes(deal.notes ?? '');
    }
  }, [open, deal]);

  const handleSave = async () => {
    setBusy(true);
    try {
      const saved = await updateDeal(deal.id, {
        name: name.trim(),
        value: Number(value) || 0,
        // Only sent when it was changed, so a deal keeps following the company currency until someone picks one.
        ...(currency && currency !== savedCurrency ? { currency } : {}),
        probability: Number(probability) || 0,
        expectedCloseDate: expectedCloseDate || null,
        source: source.trim() || null,
        notes: notes.trim() || null,
      });
      if (currency !== savedCurrency && currencyNotSaved(currency, saved, companyCurrency)) {
        toast.warning(`Saved, but in ${companyCurrency}. This database cannot keep a deal in another currency until migration 182 has been run.`);
      } else {
        toast.success('Deal updated');
      }
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deal</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-deal-value">Value</Label>
              <Input id="edit-deal-value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-deal-currency">Currency</Label>
              {/* A currency that is not in the list still shows, as the placeholder. */}
              <CurrencySelect
                id="edit-deal-currency"
                value={COMMON_CURRENCIES.includes(currency) ? currency : ''}
                placeholder={currency}
                onValueChange={setCurrency}
                disabled={busy}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Chance of winning (%)</Label>
              <Input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Expected close</Label>
              <Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} disabled={busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmDealDetailPage;
