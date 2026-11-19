import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Globe, Handshake, Mail, MapPin, Pencil, Phone, Trash2,
  Loader2, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  getCompany, updateCompany, deleteCompany,
} from '@/services/supabase/crmHub/companies';
import { listContacts } from '@/services/supabase/crmHub/contacts';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { listActivities } from '@/services/supabase/crmHub/activities';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import type {
  CrmCompany, CrmContact, CrmDeal, CrmActivity, CrmTask, CrmNote, TaskStatus,
} from '@/types/crmHub';
import { companyDealSummary, dealHandoffState, dealStatusPill } from '@/lib/crmCompany';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
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

const PAGE_BODY = 'flex w-full flex-col gap-6 px-4 py-6 lg:px-6';
const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
/** One row of a list inside a section box. */
const ROW = 'border-b border-border/60 px-4 py-2.5 last:border-0';
/** One labelled field in the edit form. */
const FIELD = 'space-y-1.5';
/** Two fields side by side; stacked on phones. */
const FIELD_ROW = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

const FOLLOW_UP_STATUS: Record<TaskStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
};

const formatDateTime = (date: Date): string =>
  date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** A bordered box with a title row; the page's lists and details live in these. */
const Section: React.FC<{
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, meta, children }) => (
  <section className={BOX}>
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {meta != null && <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </div>
    {children}
  </section>
);

export const CrmCompanyDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { format: fmtCurrency } = useCrmCurrency();
  const dealsHeadingId = useId();

  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    setLoading(true);
    try {
      const c = await getCompany(id);
      if (!c) { setNotFound(true); return; }
      setCompany(c);
      const [contactRows, dealRows, actRows, taskRows, noteRows] = await Promise.all([
        listContacts(orgId, { companyId: id }),
        listDeals(orgId, { companyId: id }),
        listActivities(orgId, { companyId: id, limit: 100 }),
        listTasks(orgId, { companyId: id }),
        listNotes(orgId, { companyId: id }),
      ]);
      setContacts(contactRows);
      setDeals(dealRows);
      setActivities(actRows);
      setTasks(taskRows);
      setNotes(noteRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load company');
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-company-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `company_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `company_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_deals', filter: `company_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  const dealSummary = useMemo(() => companyDealSummary(deals), [deals]);

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, workspaceId: company?.workspaceId ?? null, body: noteBody.trim(), companyId: id }, user?.userId ?? null);
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
      await deleteCompany(id);
      toast.success('Company deleted');
      navigate('/crm/companies');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
      setBusy(false);
    }
  };

  if (loading) return (
    <main className="flex flex-1 items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading company" />
    </main>
  );

  if (notFound || !company) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
      <p className="text-sm font-medium">Company not found.</p>
      <Button asChild variant="outline">
        <Link to="/crm/companies"><ChevronLeft aria-hidden />Back to companies</Link>
      </Button>
    </main>
  );

  const location = [company.city, company.country].filter(Boolean).join(', ');
  const customFields = Object.entries(company.customFields ?? {});

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className={PAGE_BODY}>
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2.5 self-start text-muted-foreground">
            <Link to="/crm/companies"><ChevronLeft aria-hidden />Companies</Link>
          </Button>
          <PageHeader
            title={company.name}
            description={company.industry ?? undefined}
            actions={
              <>
                <Button variant="outline" onClick={() => setShowEdit(true)}>
                  <Pencil aria-hidden />Edit
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:bg-destructive-soft hover:text-destructive"
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 aria-hidden />Delete
                </Button>
              </>
            }
          />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          {/* LEFT: details */}
          <div className="min-w-0 lg:col-span-1">
            <Section title="Details">
              <div className="space-y-2.5 px-4 py-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 shrink-0" aria-hidden />
                  {company.website ? (
                    <a
                      href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 break-words text-primary hover:underline"
                    >
                      {company.website}
                    </a>
                  ) : '—'}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{company.email ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="tabular-nums">{company.phone ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{location || '—'}</span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Size</dt>
                  <dd className="font-medium">{company.companySize ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Revenue</dt>
                  <dd className="font-medium tabular-nums">
                    {company.annualRevenue != null ? fmtCurrency(company.annualRevenue) : '—'}
                  </dd>
                </div>
              </dl>
              {company.notes && (
                <div className="border-t border-border px-4 py-3">
                  <p className="mb-1 text-xs text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap break-words text-sm">{company.notes}</p>
                </div>
              )}
              {customFields.length > 0 && (
                <div className="space-y-2 border-t border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">Custom fields</p>
                  {customFields.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3 text-sm">
                      <span className="capitalize text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                      <span className="min-w-0 break-words text-right font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>

          {/* RIGHT: deals and projects, leads, notes, timeline, follow-ups */}
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <section className="flex flex-col gap-3" aria-labelledby={dealsHeadingId}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={dealsHeadingId} className="text-base font-semibold text-foreground">Deals and projects</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {plural(deals.length, 'deal', 'deals')}
                </span>
              </div>

              {deals.length > 0 && (
                <StatStrip
                  items={[
                    {
                      label: 'Open pipeline',
                      value: fmtCurrency(dealSummary.openValue),
                      note: plural(dealSummary.open, 'open deal', 'open deals'),
                    },
                    {
                      label: 'Won',
                      value: fmtCurrency(dealSummary.wonValue),
                      note: plural(dealSummary.won, 'won deal', 'won deals'),
                    },
                    {
                      label: 'Projects',
                      value: dealSummary.projects,
                      note: dealSummary.awaitingHandoff > 0
                        ? `${plural(dealSummary.awaitingHandoff, 'won deal', 'won deals')} not handed off yet`
                        : 'Started from these deals',
                    },
                  ]}
                />
              )}

              <div className={BOX}>
                {deals.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                    <Handshake className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">No deals for this company yet.</p>
                    <Button asChild variant="outline" className="mt-3">
                      <Link to="/crm/deals">Open deals</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead>
                        <tr className="h-10 border-b border-border text-xs text-muted-foreground">
                          <th className="px-4 text-left font-medium">Deal</th>
                          <th className="px-4 text-right font-medium">Value</th>
                          <th className="px-4 text-left font-medium">Status</th>
                          <th className="px-4 text-left font-medium">Project</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deals.map((d) => {
                          const pill = dealStatusPill(d);
                          const handoff = dealHandoffState(d);
                          return (
                            <tr
                              key={d.id}
                              className="h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                            >
                              <td className="px-4 font-medium text-foreground">
                                <Link to={`/crm/deals/${d.id}`} className="hover:text-primary hover:underline">
                                  {d.name}
                                </Link>
                              </td>
                              <td className="whitespace-nowrap px-4 text-right tabular-nums">{fmtCurrency(d.value)}</td>
                              <td className="px-4">
                                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                              </td>
                              <td className="whitespace-nowrap px-4">
                                {handoff === 'project' ? (
                                  <Link to={`/project/${d.projectId}`} className="text-primary hover:underline">
                                    Open project
                                  </Link>
                                ) : handoff === 'awaiting' ? (
                                  <StatusPill tone="warning">Not handed off yet</StatusPill>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <Section title="Leads" meta={contacts.length}>
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                  <User className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">No leads at this company yet.</p>
                  <Button asChild variant="outline" className="mt-3">
                    <Link to="/crm/contacts">Open leads</Link>
                  </Button>
                </div>
              ) : contacts.map((c) => (
                <Link
                  key={c.id}
                  to={`/crm/contacts/${c.id}`}
                  className={`${ROW} flex min-h-12 items-center gap-3 transition-colors hover:bg-muted/40`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                    <User className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.firstName} {c.lastName ?? ''}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.jobTitle ?? c.email ?? '—'}</p>
                  </div>
                </Link>
              ))}
            </Section>

            <Section title="Notes" meta={notes.length}>
              <div className="space-y-2 px-4 py-3">
                <Textarea
                  rows={3}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Type a note…"
                  aria-label="Add note"
                  disabled={busy}
                />
                <div className="flex justify-end">
                  <Button onClick={handleAddNote} disabled={busy || !noteBody.trim()}>
                    {busy && <Loader2 className="animate-spin" aria-hidden />}Save note
                  </Button>
                </div>
              </div>
              {notes.length > 0 && (
                <div className="border-t border-border">
                  {notes.slice(0, 5).map((n) => (
                    <div key={n.id} className={ROW}>
                      <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Timeline">
              {activities.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
              ) : activities.slice(0, 20).map((a) => (
                <div key={a.id} className={ROW}>
                  <p className="break-words text-sm">{a.description ?? a.type}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="capitalize">{a.type.replace(/_/g, ' ')}</span> · {formatDateTime(a.createdAt)}
                  </p>
                </div>
              ))}
            </Section>

            {tasks.length > 0 && (
              <Section title="Follow-ups" meta={tasks.length}>
                {tasks.slice(0, 5).map((t) => {
                  const status = FOLLOW_UP_STATUS[t.status];
                  return (
                    <div key={t.id} className={`${ROW} flex min-h-12 items-center justify-between gap-3`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t.dueDate ? formatDateTime(t.dueDate) : 'No due date'}
                        </p>
                      </div>
                      <StatusPill tone={status?.tone ?? 'neutral'}>
                        {status?.label ?? t.status.replace('_', ' ')}
                      </StatusPill>
                    </div>
                  );
                })}
              </Section>
            )}
          </div>
        </div>
      </div>

      <EditCompanyDialog company={company} open={showEdit} onOpenChange={setShowEdit} onSaved={refresh} />

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              Leads and deals linked here will lose the reference. This can't be undone.
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

const EditCompanyDialog: React.FC<{
  company: CrmCompany;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ company, open, onOpenChange, onSaved }) => {
  const fieldId = useId();
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? '');
  const [industry, setIndustry] = useState(company.industry ?? '');
  const [phone, setPhone] = useState(company.phone ?? '');
  const [email, setEmail] = useState(company.email ?? '');
  const [city, setCity] = useState(company.city ?? '');
  const [country, setCountry] = useState(company.country ?? '');
  const [companySize, setCompanySize] = useState(company.companySize ?? '');
  const [annualRevenue, setAnnualRevenue] = useState<string>(company.annualRevenue?.toString() ?? '');
  const [notes, setNotes] = useState(company.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(company.name);
      setWebsite(company.website ?? '');
      setIndustry(company.industry ?? '');
      setPhone(company.phone ?? '');
      setEmail(company.email ?? '');
      setCity(company.city ?? '');
      setCountry(company.country ?? '');
      setCompanySize(company.companySize ?? '');
      setAnnualRevenue(company.annualRevenue?.toString() ?? '');
      setNotes(company.notes ?? '');
    }
  }, [open, company]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateCompany(company.id, {
        name: name.trim(),
        website: website.trim() || null,
        industry: industry.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        city: city.trim() || null,
        country: country.trim() || null,
        companySize: companySize.trim() || null,
        annualRevenue: annualRevenue ? Number(annualRevenue) : null,
        notes: notes.trim() || null,
      });
      toast.success('Company updated');
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit company</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className={FIELD}>
            <Label htmlFor={`${fieldId}-name`}>Name *</Label>
            <Input id={`${fieldId}-name`} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-website`}>Website</Label>
              <Input id={`${fieldId}-website`} value={website} onChange={(e) => setWebsite(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-industry`}>Industry</Label>
              <Input id={`${fieldId}-industry`} value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-phone`}>Phone</Label>
              <Input id={`${fieldId}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-email`}>Email</Label>
              <Input id={`${fieldId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-city`}>City</Label>
              <Input id={`${fieldId}-city`} value={city} onChange={(e) => setCity(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-country`}>Country</Label>
              <Input id={`${fieldId}-country`} value={country} onChange={(e) => setCountry(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-size`}>Size</Label>
              <Input id={`${fieldId}-size`} value={companySize} onChange={(e) => setCompanySize(e.target.value)} placeholder="1-10, 11-50, 51-200…" disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-revenue`}>Annual revenue</Label>
              <Input id={`${fieldId}-revenue`} type="number" min={0} value={annualRevenue} onChange={(e) => setAnnualRevenue(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${fieldId}-notes`}>Notes</Label>
            <Textarea id={`${fieldId}-notes`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmCompanyDetailPage;
