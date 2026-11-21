import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ChevronLeft, Handshake, Linkedin, Loader2, Mail, MoreHorizontal, Pencil, Phone, Plus, StickyNote, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useCrmDealStages } from '@/hooks/useCrmHub';
import { useDealMoney } from '@/hooks/useDealMoney';
import { supabase } from '@/services/supabase/config';
import { getCompany, deleteCompany } from '@/services/supabase/crmHub/companies';
import { listContacts } from '@/services/supabase/crmHub/contacts';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { listActivities } from '@/services/supabase/crmHub/activities';
import { createTask, listTasks } from '@/services/supabase/crmHub/tasks';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import type {
  CrmCompany, CrmContact, CrmDeal, CrmActivity, CrmTask, CrmNote,
} from '@/types/crmHub';
import {
  companyAddressLines, companyDealSummary, companyDomain, companyRelationship, dealHandoffState,
  dealStatusPill, websiteHref,
} from '@/lib/crmCompany';
import { ACTIVITY_LABEL } from '@/lib/crmActivityLabel';
import { LEAD_STEPS, leadName, leadStep } from '@/lib/crmFlow';
import { cn } from '@/lib/utils';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { CompanyFormDialog } from '@/components/crmHub/CompanyFormDialog';
import { Button } from '@/components/ui/button';
import { CallDialog } from '@/components/crmHub/CallDialog';
import { CallRecording, recordedCallId } from '@/components/crmHub/CallRecording';
import { useCalling } from '@/hooks/useCalling';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useStayInWorkspace } from '@/hooks/useStayInWorkspace';
import { AgreementsPanel } from '@/components/signroom/agreements/AgreementsPanel';
import { InvoicesPanel } from '@/components/signroom/billing/InvoicesPanel';
import { CompanyAccountPanel } from '@/components/signroom/billing/CompanyAccountPanel';
import { BillingPlansPanel } from '@/components/signroom/billing/BillingPlansPanel';

const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
/** One row of a list inside a card. */
const ROW = 'border-b border-border/60 px-4 py-2.5 last:border-0';
/** How many rows a card on the right shows before "Show all". */
const SHORT_LIST = 5;

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const dateTime = (date: Date): string => format(date, 'd MMM yyyy, HH:mm');
const startOfToday = (): number => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

/** A bordered card with a title row. */
const Card: React.FC<{
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, count, action, children }) => {
  const headingId = useId();
  return (
    <section className={BOX} aria-labelledby={headingId}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
          {count != null && <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
};

/** One labelled fact in "About this company". */
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
);

const NOT_SET = <span className="text-muted-foreground">—</span>;

export const CrmCompanyDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [openRecord, setOpenRecord] = useState<{ id: string; workspaceId: string | null } | null>(null);
  useStayInWorkspace(openRecord?.id, openRecord?.workspaceId, '/crm/companies');
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { format: money } = useCrmCurrency();
  const { formatDeal, formatDealConverted, allInCompany } = useDealMoney();
  const { items: stages } = useCrmDealStages();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
  // Ringing the company from the browser: owners and admins, once a phone provider is set up.
  const calling = useCalling();
  const [showCall, setShowCall] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDue, setFollowUpDue] = useState('');
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [showAllDeals, setShowAllDeals] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    try {
      const c = await getCompany(id);
      if (!c) { setNotFound(true); return; }
      setCompany(c);
      setOpenRecord({ id: c.id, workspaceId: c.workspaceId });
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
      toast.error(publicMessage(err, 'Could not load the company'));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `company_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  /** Totals are in the company currency, whatever currency each deal is in. */
  const dealSummary = useMemo(() => companyDealSummary(allInCompany(deals)), [deals, allInCompany]);
  const stageName = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);

  const openTasks = useMemo(
    () => tasks
      .filter((t) => t.status !== 'completed')
      .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity)),
    [tasks],
  );

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote(
        { organizationId: orgId, workspaceId: company?.workspaceId ?? null, body: noteBody.trim(), companyId: id },
        user?.userId ?? null,
      );
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not save the note'));
    } finally {
      setBusy(false);
    }
  };

  const handleAddFollowUp = async () => {
    if (!orgId || !user || !company?.workspaceId || !followUpTitle.trim()) return;
    setBusy(true);
    try {
      await createTask(
        {
          organizationId: orgId,
          workspaceId: company.workspaceId,
          projectId: null,
          title: followUpTitle.trim(),
          dueDate: followUpDue ? new Date(`${followUpDue}T09:00:00`).toISOString() : null,
          companyId: id,
          assignedTo: user.userId,
        },
        user.userId,
        { actorId: user.userId },
      );
      toast.success('Follow-up added');
      setFollowUpTitle('');
      setFollowUpDue('');
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not add the follow-up'));
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
      toast.error(publicMessage(err, 'Could not delete the company'));
      setBusy(false);
    }
  };

  const writeNote = () => {
    setTab('notes');
    // The notes tab mounts on the next frame.
    requestAnimationFrame(() => noteRef.current?.focus());
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

  const relationship = companyRelationship(company, { wonDeals: dealSummary.won, openDeals: dealSummary.open });
  const domain = companyDomain(company.website);
  const siteHref = websiteHref(company.website);
  const linkedinHref = websiteHref(company.linkedinUrl);
  const addressLines = companyAddressLines(company);
  const customFields = Object.entries(company.customFields ?? {});
  const owner = (organization?.members ?? []).find((m) => m.userId === company.ownerId);
  const ownerLabel = !company.ownerId
    ? null
    : company.ownerId === user?.userId ? 'You' : owner?.displayName ?? 'Former teammate';
  const lastActivity = activities[0]?.createdAt ?? null;
  const today = startOfToday();
  const shownLeads = showAllLeads ? contacts : contacts.slice(0, SHORT_LIST);
  const shownDeals = showAllDeals ? deals : deals.slice(0, SHORT_LIST);

  const timeline = (rows: CrmActivity[]) => rows.map((a) => (
    <div key={a.id} className={ROW}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium text-foreground">{ACTIVITY_LABEL[a.type] ?? a.type}</p>
        <time className="text-xs tabular-nums text-muted-foreground" dateTime={a.createdAt.toISOString()}>
          {dateTime(a.createdAt)}
        </time>
      </div>
      {a.description && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted-foreground">{a.description}</p>}
      {calling.mayListen && recordedCallId(a) && <CallRecording callId={recordedCallId(a) as string} />}
    </div>
  ));

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="flex flex-col gap-3">
          <Button variant="ghost" size="sm" asChild className="-ml-2.5 self-start text-muted-foreground">
            <Link to="/crm/companies"><ChevronLeft aria-hidden />Companies</Link>
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
              <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-secondary text-lg font-semibold text-muted-foreground">
                {company.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{company.name}</h1>
                  <StatusPill
                    tone={relationship.tone}
                    title={relationship.chosen ? undefined : 'Worked out from this company’s deals'}
                  >
                    {relationship.label}
                  </StatusPill>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {domain && siteHref && (
                    <a href={siteHref} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                      {domain}
                    </a>
                  )}
                  {[company.industry, [company.city, company.country].filter(Boolean).join(', ')]
                    .filter(Boolean)
                    .map((part) => <span key={part}>{domain ? '· ' : ''}{part}</span>)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={writeNote}><StickyNote aria-hidden />Note</Button>
              {company.email && (
                <Button variant="outline" asChild>
                  <a href={`mailto:${company.email}`}><Mail aria-hidden />Email</a>
                </Button>
              )}
              {company.phone && (calling.inApp ? (
                <Button variant="outline" onClick={() => setShowCall(true)}><Phone aria-hidden />Call</Button>
              ) : (
                <Button variant="outline" asChild>
                  <a href={`tel:${company.phone}`}><Phone aria-hidden />Call</a>
                </Button>
              ))}
              <Button onClick={() => setShowEdit(true)}><Pencil aria-hidden />Edit</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="outline" aria-label="More actions"><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setShowDelete(true)}>
                    Delete company
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_23rem]">
          {/* LEFT: what is known about the company */}
          <Card title="About this company">
            <dl className="flex flex-col gap-3.5 px-4 py-4">
              <Fact label="Website">
                {domain && siteHref
                  ? <a href={siteHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{domain}</a>
                  : NOT_SET}
              </Fact>
              <Fact label="Industry">{company.industry ?? NOT_SET}</Fact>
              <Fact label="Type">
                {relationship.label}
                {!relationship.chosen && <span className="text-muted-foreground"> (from the deals)</span>}
              </Fact>
              <Fact label="Company owner">{ownerLabel ?? NOT_SET}</Fact>
              <Fact label="Phone">
                {company.phone
                  ? <a href={`tel:${company.phone}`} className="tabular-nums hover:underline">{company.phone}</a>
                  : NOT_SET}
              </Fact>
              <Fact label="Email">
                {company.email
                  ? <a href={`mailto:${company.email}`} className="hover:underline">{company.email}</a>
                  : NOT_SET}
              </Fact>
              <Fact label="LinkedIn">
                {linkedinHref ? (
                  <a href={linkedinHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <Linkedin className="h-3.5 w-3.5" aria-hidden />Company page
                  </a>
                ) : NOT_SET}
              </Fact>
              <Fact label="Address">
                {addressLines.length > 0
                  ? addressLines.map((line) => <span key={line} className="block">{line}</span>)
                  : NOT_SET}
              </Fact>
              <Fact label="Employees">{company.companySize ?? NOT_SET}</Fact>
              <Fact label="Annual revenue">
                {company.annualRevenue != null ? <span className="tabular-nums">{money(company.annualRevenue)}</span> : NOT_SET}
              </Fact>
              <Fact label="Added">{format(company.createdAt, 'd MMM yyyy')}</Fact>
              <Fact label="Last activity">
                {lastActivity ? formatDistanceToNow(lastActivity, { addSuffix: true }) : NOT_SET}
              </Fact>
            </dl>
            {company.notes && (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-1 text-xs text-muted-foreground">About</p>
                <p className="whitespace-pre-wrap break-words text-sm">{company.notes}</p>
              </div>
            )}
            {customFields.length > 0 && (
              <dl className="flex flex-col gap-3 border-t border-border px-4 py-3">
                {customFields.map(([key, value]) => (
                  <Fact key={key} label={key.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())}>{value}</Fact>
                ))}
              </dl>
            )}
          </Card>

          {/* MIDDLE: the story so far */}
          <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-col gap-4">
            <TabsList className="self-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity <span className="ml-1.5 tabular-nums text-muted-foreground">{activities.length}</span></TabsTrigger>
              <TabsTrigger value="notes">Notes <span className="ml-1.5 tabular-nums text-muted-foreground">{notes.length}</span></TabsTrigger>
              <TabsTrigger value="account">Account</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0 flex flex-col gap-6">
              <StatStrip
                items={[
                  { label: 'Open pipeline', value: money(dealSummary.openValue), note: plural(dealSummary.open, 'open deal', 'open deals') },
                  { label: 'Won', value: money(dealSummary.wonValue), note: plural(dealSummary.won, 'won deal', 'won deals') },
                  { label: 'Leads', value: contacts.length, note: 'People at this company' },
                  {
                    label: 'Projects',
                    value: dealSummary.projects,
                    note: dealSummary.awaitingHandoff > 0
                      ? `${plural(dealSummary.awaitingHandoff, 'won deal', 'won deals')} not handed off yet`
                      : 'Started from these deals',
                  },
                ]}
              />

              <Card title="Next follow-ups" count={openTasks.length}>
                {openTasks.length === 0
                  ? <Empty>Nothing to follow up. Add one on the right.</Empty>
                  : openTasks.slice(0, 3).map((t) => {
                    const overdue = t.dueDate != null && t.dueDate.getTime() < today;
                    return (
                      <div key={t.id} className={cn(ROW, 'flex min-h-12 items-center justify-between gap-3')}>
                        <p className="min-w-0 truncate text-sm font-medium">{t.title}</p>
                        {t.dueDate
                          ? <StatusPill tone={overdue ? 'danger' : 'neutral'}>{overdue ? 'Overdue · ' : ''}{format(t.dueDate, 'd MMM')}</StatusPill>
                          : <span className="text-xs text-muted-foreground">No date</span>}
                      </div>
                    );
                  })}
              </Card>

              <Card
                title="Latest activity"
                action={activities.length > 5 && (
                  <Button variant="ghost" size="sm" onClick={() => setTab('activity')}>See all</Button>
                )}
              >
                {activities.length === 0
                  ? <Empty>Nothing has happened with this company yet.</Empty>
                  : timeline(activities.slice(0, 5))}
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <Card title="Activity" count={activities.length}>
                {activities.length === 0
                  ? <Empty>Nothing has happened with this company yet.</Empty>
                  : timeline(activities)}
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-0">
              <Card title="Notes" count={notes.length}>
                <div className="flex flex-col gap-2 px-4 py-3">
                  <Textarea
                    ref={noteRef}
                    rows={3}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="What did you learn or agree?"
                    aria-label="New note"
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
                    {notes.map((n) => (
                      <div key={n.id} className={ROW}>
                        <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">{dateTime(n.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* What they have been invoiced, what they have paid and what is outstanding. */}
            <TabsContent value="account" className="mt-0">
              <div className="flex flex-col gap-4">
                <CompanyAccountPanel companyId={company.id} />
                {/* Retainers and one-off fees agreed with this company, month by month. */}
                <BillingPlansPanel companyId={company.id} companyName={company.name} />
              </div>
            </TabsContent>
          </Tabs>

          {/* RIGHT: what is linked to the company */}
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 2xl:col-start-3">
            <Card
              title="Leads"
              count={contacts.length}
              action={<Button variant="ghost" size="sm" asChild><Link to="/crm/contacts"><Plus aria-hidden />Add</Link></Button>}
            >
              {contacts.length === 0 ? <Empty>No leads at this company yet.</Empty> : shownLeads.map((c) => {
                const step = LEAD_STEPS[leadStep(c)];
                return (
                  <Link
                    key={c.id}
                    to={`/crm/contacts/${c.id}`}
                    className={cn(ROW, 'flex min-h-12 items-center gap-3 transition-colors hover:bg-muted/40')}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                      <User className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{leadName(c)}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.jobTitle ?? c.email ?? '—'}</p>
                    </div>
                    <StatusPill tone={step.tone}>{step.label}</StatusPill>
                  </Link>
                );
              })}
              {contacts.length > SHORT_LIST && (
                <div className="border-t border-border/60 px-2 py-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllLeads((v) => !v)}>
                    {showAllLeads ? 'Show fewer' : `Show all ${contacts.length} leads`}
                  </Button>
                </div>
              )}
            </Card>

            <Card
              title="Deals"
              count={deals.length}
              action={<Button variant="ghost" size="sm" asChild><Link to="/crm/deals"><Plus aria-hidden />Add</Link></Button>}
            >
              {deals.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                  <Handshake className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">No deals with this company yet.</p>
                </div>
              ) : shownDeals.map((d) => {
                const pill = dealStatusPill(d);
                const handoff = dealHandoffState(d);
                const converted = formatDealConverted(d);
                return (
                  <div key={d.id} className={cn(ROW, 'flex flex-col gap-1')}>
                    <div className="flex items-baseline justify-between gap-3">
                      <Link to={`/crm/deals/${d.id}`} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                        {d.name}
                      </Link>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{formatDeal(d)}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={pill.tone}>
                          {d.status === 'open' ? stageName.get(d.stageId) ?? pill.label : pill.label}
                        </StatusPill>
                        {handoff === 'project' && (
                          <Link to={`/project/${d.projectId}`} className="text-xs text-primary hover:underline">Open project</Link>
                        )}
                        {handoff === 'awaiting' && <StatusPill tone="warning">Not handed off yet</StatusPill>}
                      </span>
                      {converted && <span className="text-xs tabular-nums text-muted-foreground">{converted}</span>}
                    </div>
                  </div>
                );
              })}
              {deals.length > SHORT_LIST && (
                <div className="border-t border-border/60 px-2 py-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllDeals((v) => !v)}>
                    {showAllDeals ? 'Show fewer' : `Show all ${deals.length} deals`}
                  </Button>
                </div>
              )}
            </Card>

            <AgreementsPanel companyId={company.id} />
            <InvoicesPanel companyId={company.id} />

            <Card title="Follow-ups" count={openTasks.length}>
              <form
                className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3"
                onSubmit={(e) => { e.preventDefault(); void handleAddFollowUp(); }}
              >
                <Input
                  value={followUpTitle}
                  onChange={(e) => setFollowUpTitle(e.target.value)}
                  placeholder="Call back, send the quote…"
                  aria-label="New follow-up"
                  className="min-w-40 flex-1"
                  disabled={busy}
                />
                <Input
                  type="date"
                  value={followUpDue}
                  onChange={(e) => setFollowUpDue(e.target.value)}
                  aria-label="Due date"
                  className="w-36"
                  disabled={busy}
                />
                <Button type="submit" variant="outline" disabled={busy || !followUpTitle.trim()}>Add</Button>
              </form>
              {openTasks.length === 0 ? <Empty>No open follow-ups.</Empty> : openTasks.slice(0, SHORT_LIST).map((t) => {
                const overdue = t.dueDate != null && t.dueDate.getTime() < today;
                return (
                  <div key={t.id} className={cn(ROW, 'flex min-h-11 items-center justify-between gap-3')}>
                    <p className="min-w-0 truncate text-sm">{t.title}</p>
                    <span className={cn('shrink-0 text-xs tabular-nums', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t.dueDate ? format(t.dueDate, 'd MMM') : 'No date'}
                    </span>
                  </div>
                );
              })}
              {tasks.length > 0 && (
                <div className="border-t border-border/60 px-2 py-1.5">
                  <Button variant="ghost" size="sm" asChild><Link to="/crm/tasks">Open follow-ups</Link></Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      <CompanyFormDialog open={showEdit} onOpenChange={setShowEdit} company={company} onSaved={refresh} />

      {company.phone && (
        <CallDialog
          open={showCall}
          onOpenChange={setShowCall}
          name={company.name}
          phone={company.phone}
          target={{ companyId: company.id }}
          setup={calling.setup}
          onLogged={() => void refresh()}
        />
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {company.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its leads and deals stay, but lose the link to this company. This can&apos;t be undone.
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

export default CrmCompanyDetailPage;
