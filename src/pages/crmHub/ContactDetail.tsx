import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarPlus, Check, ChevronLeft, Copy, Handshake, History, Loader2, Mail,
  MoreHorizontal, Pencil, Phone, Plus, StickyNote, Trash2, Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  getContact, updateContact, deleteContact,
} from '@/services/supabase/crmHub/contacts';
import { listActivities, logActivity } from '@/services/supabase/crmHub/activities';
import { listNotes, createNote } from '@/services/supabase/crmHub/notes';
import { listTasks, createTask } from '@/services/supabase/crmHub/tasks';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { listDealStages, seedDefaultDealStages } from '@/services/supabase/crmHub/dealStages';
import { getCompany } from '@/services/supabase/crmHub/companies';
import {
  LIFECYCLE_STAGES, LEAD_STATUSES, TASK_PRIORITIES,
} from '@/types/crmHub';
import type {
  CrmContact, CrmActivity, CrmNote, CrmTask, CrmDeal, CrmCompany, CrmDealStage,
  ActivityType, LifecycleStage, LeadStatus, TaskPriority, TaskStatus,
} from '@/types/crmHub';
import type { Project } from '@/types';
import type { TaskAssignee } from '@/types/task';
import {
  LEAD_STEPS, dealBadge, leadName, leadStep, leadStepPatch, type LeadStep,
} from '@/lib/crmFlow';
import { followUpBucket, localYmd } from '@/lib/crmFollowUps';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { PersonPrivacy } from '@/components/crmHub/PersonPrivacy';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { PriorityPill, UrgentBadge } from '@/components/common/TaskBadges';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ContactTagPicker } from '@/components/crmHub/ContactTagPicker';
import { ClientAccountsTab } from '@/components/crmHub/ClientAccountsTab';
import { ConvertLeadDialog } from '@/components/crmHub/ConvertLeadDialog';
import { CustomFieldsEditor } from '@/components/crmHub/CustomFieldsEditor';
import { rowsProblem } from '@/lib/crmFieldTypes';
import { useFieldDefs } from '@/services/supabase/crmHub/fieldDefs';
import { OwnerField } from '@/components/crmHub/OwnerField';
import { UnqualifiedDialog, unqualifiedNote } from '@/components/crmHub/UnqualifiedDialog';
import { localInputValue, loggedDescription, occurredAtFrom } from '@/lib/crmLoggedActivity';
import { OUTCOME_LABEL, OUTCOMES, type CallOutcome } from '../../../api/_voice/shared/types';
import { CallDialog } from '@/components/crmHub/CallDialog';
import { CallRecording, recordedCallId } from '@/components/crmHub/CallRecording';
import { useCalling } from '@/hooks/useCalling';
import {
  customFieldLabel, customFieldRows, readCustomFieldRows, type CustomFieldRow,
} from '@/lib/customFields';
import { LeadAutomationCard } from '@/components/automation/LeadAutomationCard';
import { useCrmCompanies, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { useDealMoney } from '@/hooks/useDealMoney';
import { useProjects } from '@/hooks/useProjects';
import { useStayInWorkspace } from '@/hooks/useStayInWorkspace';

const PAGE_BODY = 'flex w-full flex-col gap-6 px-4 py-6 lg:px-6';
const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
/** One row of a list inside a section box. */
const ROW = 'border-b border-border/60 px-4 py-2.5 last:border-0';
/** One labelled field in a dialog form. */
const FIELD = 'flex flex-col gap-1.5';
/** Two fields side by side; stacked on phones. */
const FIELD_ROW = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
const NONE = '__none__';
/** How many notes / follow-ups show before "Show all". */
const SHORT_LIST = 5;

type ManualStep = 'new' | 'contacted' | 'qualified' | 'customer' | 'unqualified';

/** Select value standing in for "no deal" (Radix has no empty value). */
const NO_DEAL = '__none__';

/** The steps drawn in the bar, in order. "Unqualified" sits beside the bar. */
const BAR_STEPS: LeadStep[] = ['new', 'contacted', 'qualified', 'deal', 'customer'];
/** Leads that can still be turned into their first deal. */
const CONVERTIBLE: LeadStep[] = ['new', 'contacted', 'qualified'];
/** Why a step in the bar cannot be clicked. */
const AUTOMATIC_STEP_TITLE: Partial<Record<LeadStep, string>> = {
  deal: 'Set for you when you convert this lead to a deal.',
};

/** "Customer" is set for you when a deal is won, and by hand for somebody who is a client already. */
const isManualStep = (step: LeadStep): step is ManualStep =>
  step === 'new' || step === 'contacted' || step === 'qualified' || step === 'customer' || step === 'unqualified';

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const formatDateTime = (date: Date): string =>
  date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const formatDate = (date: Date): string => date.toLocaleDateString(undefined, { dateStyle: 'medium' });

type LeadTab = 'all' | 'note' | 'call' | 'email' | 'meeting' | 'accounts';
const LEAD_TABS: { key: LeadTab; label: string }[] = [
  { key: 'all', label: 'Timeline' },
  { key: 'note', label: 'Notes' },
  { key: 'call', label: 'Calls' },
  { key: 'email', label: 'Emails' },
  { key: 'meeting', label: 'Meetings' },
  { key: 'accounts', label: 'Accounts' },
];

/** What the timeline calls each kind of activity; anything else is shown as typed. */
const ACTIVITY_LABEL: Partial<Record<ActivityType, string>> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  task_completed: 'Follow-up completed',
  contact_created: 'Lead created',
  company_created: 'Company created',
  deal_created: 'Deal created',
  deal_updated: 'Deal updated',
  deal_stage_changed: 'Deal moved',
  deal_won: 'Deal won',
  deal_lost: 'Deal lost',
};

const activityIcon = (t: ActivityType) => {
  if (t === 'note') return StickyNote;
  if (t === 'call') return Phone;
  if (t === 'email') return Mail;
  if (t === 'meeting') return Video;
  return MoreHorizontal;
};

const FOLLOW_UP_STATUS: Record<TaskStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

/** A bordered box with a title row; the page's lists and details live in these. */
const Section: React.FC<{
  title: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, meta, action, children }) => (
  <section className={BOX}>
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-1.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {meta != null && <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>}
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** One labelled value in the details list; an empty value shows a dash. */
const Detail: React.FC<{ label: string; wide?: boolean; children?: React.ReactNode }> = ({ label, wide, children }) => (
  <div className={cn('min-w-0', wide && 'col-span-2')}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 break-words text-sm text-foreground">
      {children == null || children === '' || children === false
        ? <span className="text-muted-foreground">—</span>
        : children}
    </dd>
  </div>
);

/**
 * Where the lead is: New → Contacted → Qualified → Deal open → Customer.
 * "Deal open" happens by converting the lead, so it cannot be clicked.
 * "Customer" happens by winning a deal, and can also be clicked: somebody who
 * is a client already needs no deal to be one.
 */
const LeadStepBar: React.FC<{
  step: LeadStep;
  busy: boolean;
  onPick: (step: ManualStep) => void;
}> = ({ step, busy, onPick }) => {
  const current = BAR_STEPS.indexOf(step); // -1 when the lead is unqualified
  return (
    <ol
      aria-label="Lead steps"
      className="flex min-w-0 max-w-3xl flex-1 basis-80 overflow-x-auto rounded-lg border border-border bg-card text-xs sm:text-sm"
    >
      {BAR_STEPS.map((s, i) => {
        const state = i === current ? 'current' : i < current ? 'done' : 'todo';
        const cell = cn(
          'flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap px-2 font-medium transition-colors sm:px-3 md:min-h-9',
          state === 'current' && 'bg-foreground text-background',
          state === 'done' && 'bg-secondary text-foreground',
          state === 'todo' && 'text-muted-foreground',
        );
        const content = (
          <>
            {state === 'done' && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {LEAD_STEPS[s].label}
            {state === 'done' && <span className="sr-only">(done)</span>}
          </>
        );
        return (
          <li
            key={s}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn('flex flex-1', i > 0 && 'border-l border-border')}
          >
            {isManualStep(s) ? (
              <button
                type="button"
                className={cn(
                  cell,
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none',
                  state === 'done' && 'hover:bg-foreground/10',
                  state === 'todo' && 'hover:bg-secondary hover:text-foreground',
                )}
                title={LEAD_STEPS[s].hint}
                disabled={busy || state === 'current'}
                onClick={() => onPick(s)}
              >
                {content}
              </button>
            ) : (
              <span className={cn(cell, 'cursor-default')} title={AUTOMATIC_STEP_TITLE[s]}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export const CrmContactDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [openRecord, setOpenRecord] = useState<{ id: string; workspaceId: string | null } | null>(null);
  useStayInWorkspace(openRecord?.id, openRecord?.workspaceId, '/crm/contacts');
  const { user } = useAuth();
  const { organization, isOwner } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { projects: allProjects } = useProjects();
  const { items: companies } = useCrmCompanies();
  const selectedWorkspaceId = useWorkspaceForCreate();
  const { formatDeal, formatDealConverted } = useDealMoney();

  const [contact, setContact] = useState<CrmContact | null>(null);
  const [company, setCompany] = useState<CrmCompany | null>(null);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [stages, setStages] = useState<CrmDealStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [stepBusy, setStepBusy] = useState(false);
  const [tab, setTab] = useState<LeadTab>('all');
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showAllFollowUps, setShowAllFollowUps] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // Ringing the lead from the browser: owners and admins, once a phone provider is set up.
  const calling = useCalling();
  const [showCall, setShowCall] = useState(false);
  const [showNewFollowUp, setShowNewFollowUp] = useState(false);
  /** A step picked for a lead that already has a deal: asked about first. */
  const [stepBack, setStepBack] = useState<ManualStep>('contacted');
  const [confirmStepBack, setConfirmStepBack] = useState(false);
  /** Asking why before a lead is marked unqualified; the reason waits here until the step is saved. */
  const [askUnqualified, setAskUnqualified] = useState(false);
  const unqualifiedReason = useRef('');
  const [logType, setLogType] = useState<ActivityType>('call');
  const [logBody, setLogBody] = useState('');
  /** When it happened (it is often logged afterwards), how a call went, and the deal it was about. */
  const [logWhen, setLogWhen] = useState('');
  const [logOutcome, setLogOutcome] = useState<CallOutcome>('connected');
  const [logDealId, setLogDealId] = useState('');
  const logFieldId = useId();

  // The lead's own workspace decides which pipeline and projects apply; an
  // old lead without one falls back to the workspace picked in the sidebar.
  const leadWorkspaceId = contact?.workspaceId ?? null;
  const followUpWorkspaceId = leadWorkspaceId ?? selectedWorkspaceId;
  const workspaceProjects = allProjects.filter((project) => project.workspaceId === contact?.workspaceId);
  const followUpProjects = leadWorkspaceId
    ? workspaceProjects
    : allProjects.filter((project) => project.workspaceId === followUpWorkspaceId);
  const taskAssignees: TaskAssignee[] = (organization?.members ?? [])
    .filter((member) => member.status === 'active')
    .map((member) => ({
      userId: member.userId,
      displayName: member.displayName || member.email,
      email: member.email,
      photoURL: member.photoURL,
    }));
  if (user && !taskAssignees.some((assignee) => assignee.userId === user.userId)) {
    taskAssignees.unshift({
      userId: user.userId,
      displayName: user.displayName || user.email,
      email: user.email,
      photoURL: user.photoURL,
    });
  }

  const refresh = React.useCallback(async () => {
    if (!id || !orgId) return;
    setLoading(true);
    try {
      const c = await getContact(id);
      if (!c) { setNotFound(true); return; }
      setNotFound(false);
      setContact(c);
      setOpenRecord({ id: c.id, workspaceId: c.workspaceId });
      const [notesRows, actRows, taskRows, dealRows] = await Promise.all([
        listNotes(orgId, { contactId: id }),
        listActivities(orgId, { contactId: id, limit: 100 }),
        listTasks(orgId, { contactId: id }),
        listDeals(orgId, { contactId: id }),
      ]);
      setNotes(notesRows);
      setActivities(actRows);
      setTasks(taskRows);
      setDeals(dealRows);
      if (c.companyId) {
        const co = await getCompany(c.companyId);
        setCompany(co);
      } else {
        setCompany(null);
      }
    } catch (err) {
      toast.error(publicMessage(err, 'Could not load the lead'));
    } finally {
      setLoading(false);
    }
  }, [id, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId || !id) return;
    const channel = supabase
      .channel(`crm-contact-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_notes', filter: `contact_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_activities', filter: `contact_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `contact_id=eq.${id}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_deals', filter: `contact_id=eq.${id}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, id, refresh]);

  // Pipeline stages of the lead's own workspace, for "Convert to deal".
  useEffect(() => {
    if (!orgId || !leadWorkspaceId) { setStages([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        let rows = await listDealStages(orgId, leadWorkspaceId);
        if (rows.length === 0) {
          await seedDefaultDealStages(orgId, leadWorkspaceId);
          rows = await listDealStages(orgId, leadWorkspaceId);
        }
        if (!cancelled) setStages(rows);
      } catch {
        if (!cancelled) setStages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, leadWorkspaceId]);

  const handleAddNote = async () => {
    if (!orgId || !noteBody.trim()) return;
    setBusy(true);
    try {
      await createNote({ organizationId: orgId, workspaceId: contact?.workspaceId ?? null, body: noteBody.trim(), contactId: id }, user?.userId ?? null);
      toast.success('Note added');
      setNoteBody('');
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not save note'));
    } finally {
      setBusy(false);
    }
  };

  const openLog = (type: ActivityType) => {
    setLogType(type);
    setLogBody('');
    setLogWhen(localInputValue(new Date()));
    setLogOutcome('connected');
    setLogDealId('');
    setShowLog(true);
  };

  const handleLog = async () => {
    const outcome = logType === 'call' ? logOutcome : null;
    const description = loggedDescription(logType, outcome, logBody);
    if (!orgId || !description) return;
    setBusy(true);
    try {
      const now = new Date();
      const occurredAt = occurredAtFrom(logWhen, now);
      await logActivity({
        organizationId: orgId,
        workspaceId: contact?.workspaceId ?? null,
        type: logType,
        description,
        contactId: id,
        dealId: logDealId || null,
        ...(outcome ? { metadata: { outcome } } : {}),
        // Sent only when it was moved back in time, so "just now" stays the database's own clock.
        ...(now.getTime() - occurredAt.getTime() > 60_000 ? { occurredAt } : {}),
      }, user?.userId ?? null);
      toast.success('Activity logged');
      setShowLog(false);
      setLogBody('');
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not log'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteContact(id);
      toast.success('Lead deleted');
      navigate('/crm/contacts');
    } catch (err) {
      toast.error(publicMessage(err, 'Could not delete the lead'));
      setBusy(false);
    }
  };

  const copyEmail = () => {
    if (!contact?.email) return;
    void navigator.clipboard.writeText(contact.email);
    toast.success('Email copied');
  };

  const saveStep = async (next: ManualStep, done?: string) => {
    if (!contact) return;
    setStepBusy(true);
    try {
      await updateContact(contact.id, leadStepPatch(next));
      const reason = next === 'unqualified' ? unqualifiedReason.current.trim() : '';
      unqualifiedReason.current = '';
      if (reason) {
        // The reason goes on the timeline. The lead is already marked, so a failure here is not worth an error.
        try {
          await logActivity(
            {
              organizationId: contact.organizationId,
              workspaceId: contact.workspaceId,
              type: 'note',
              description: unqualifiedNote(reason),
              contactId: contact.id,
              metadata: { unqualifiedReason: reason },
            },
            user?.userId ?? null,
          );
        } catch (err) {
          console.warn('[crm] could not log why the lead was marked unqualified', err);
        }
      }
      toast.success(done ?? (next === 'customer'
        ? `${leadName(contact)} marked as an existing client`
        : `${leadName(contact)} marked ${LEAD_STEPS[next].label.toLowerCase()}`));
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not update the lead'));
    } finally {
      setStepBusy(false);
    }
  };

  if (loading && contact?.id !== id) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading lead" />
      </main>
    );
  }

  if (notFound || !contact || contact.id !== id) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
        <p className="text-sm font-medium">Lead not found.</p>
        <Button asChild variant="outline">
          <Link to="/crm/contacts"><ChevronLeft aria-hidden />Back to leads</Link>
        </Button>
      </main>
    );
  }

  const fullName = leadName(contact);
  const step = leadStep(contact);
  const stepInfo = LEAD_STEPS[step];
  const hasDeal = step === 'deal' || step === 'customer';
  const canConvert = CONVERTIBLE.includes(step);
  const owner = (organization?.members ?? []).find((member) => member.userId === contact.ownerId);
  const customFields = Object.entries(contact.customFields ?? {});
  const projectNameById = new Map(allProjects.map((project) => [project.projectId, project.name]));
  const today = localYmd(new Date());

  // Stepping a lead back from "Deal open" or "Customer" cannot be undone
  // from the bar, so it is confirmed first.
  const pickStep = (next: ManualStep) => {
    // Marking somebody a client takes nothing away, so it is not asked about.
    if (hasDeal && next !== 'customer') {
      setStepBack(next);
      setConfirmStepBack(true);
    } else {
      void saveStep(next);
    }
  };

  // The lead's own company stays selectable even when it is outside the
  // workspace shown in the sidebar.
  const companyOptions = company && !companies.some((c) => c.id === company.id)
    ? [company, ...companies]
    : companies;

  const filteredActivities = activities.filter((a) => {
    if (tab === 'all') return true;
    return a.type === tab;
  });
  const visibleNotes = showAllNotes ? notes : notes.slice(0, SHORT_LIST);
  const visibleFollowUps = showAllFollowUps ? tasks : tasks.slice(0, SHORT_LIST);
  const logLabel = tab === 'all' || tab === 'accounts' ? 'activity' : tab;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className={PAGE_BODY}>
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2.5 self-start text-muted-foreground">
            <Link to="/crm/contacts"><ChevronLeft aria-hidden />Leads</Link>
          </Button>
          <PageHeader
            title={fullName}
            description={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {contact.jobTitle && <span>{contact.jobTitle}</span>}
                {contact.jobTitle && company && <span aria-hidden>·</span>}
                {company && (
                  <Link to={`/crm/companies/${company.id}`} className="text-foreground hover:underline">
                    {company.name}
                  </Link>
                )}
                <StatusPill tone={stepInfo.tone} title={stepInfo.hint}>{stepInfo.label}</StatusPill>
              </span>
            }
            actions={
              <>
                {canConvert && (
                  <Button onClick={() => setShowConvert(true)}>
                    <Handshake aria-hidden />Convert to deal
                  </Button>
                )}
                {hasDeal && (
                  <Button variant="outline" onClick={() => setShowConvert(true)}>
                    <Plus aria-hidden />{deals.length === 0 ? 'New deal' : 'Open another deal'}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowEdit(true)}>
                  <Pencil aria-hidden />Edit
                </Button>
                <PersonPrivacy
                  contact={contact}
                  companyName={company?.name ?? null}
                  isOwner={isOwner}
                  onErased={() => navigate('/crm/contacts')}
                />
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <LeadStepBar step={step} busy={stepBusy} onPick={pickStep} />
          {step === 'unqualified' ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="muted" title={LEAD_STEPS.unqualified.hint}>{LEAD_STEPS.unqualified.label}</StatusPill>
              <Button
                variant="outline"
                size="sm"
                disabled={stepBusy}
                onClick={() => void saveStep('contacted', `${fullName} re-opened`)}
              >
                Re-open lead
              </Button>
            </div>
          ) : step !== 'customer' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              title={LEAD_STEPS.unqualified.hint}
              disabled={stepBusy}
              onClick={() => setAskUnqualified(true)}
            >
              Mark unqualified
            </Button>
          )}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* MAIN: the timeline and its tabs first (what happened with this person), then follow-ups and notes, then the deals */}
          <div className="flex min-w-0 flex-col gap-6">
            <Tabs value={tab} onValueChange={(v) => setTab(v as LeadTab)} className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="min-w-0 max-w-full overflow-x-auto">
                  <TabsList>
                    {LEAD_TABS.map((t) => (
                      <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {tab !== 'accounts' && (
                  <Button
                    variant="outline"
                    className="mb-1.5"
                    onClick={() => openLog(tab === 'all' ? 'call' : tab)}
                  >
                    <Plus aria-hidden />Log {logLabel}
                  </Button>
                )}
              </div>

              <TabsContent value={tab} className="mt-0">
                {tab === 'accounts' ? (
                  contact.workspaceId && orgId ? (
                    <ClientAccountsTab
                      organizationId={orgId}
                      workspaceId={contact.workspaceId}
                      contactId={contact.id}
                      projects={workspaceProjects}
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      Assign this lead to a workspace before adding account records.
                    </div>
                  )
                ) : (
                  <div className={BOX}>
                    {filteredActivities.length === 0 ? (
                      <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                        <History className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-sm font-medium">No {tab === 'all' ? 'activity' : `${tab}s`} yet.</p>
                        <Button
                          variant="outline"
                          className="mt-3"
                          onClick={() => openLog(tab === 'all' ? 'call' : (tab as ActivityType))}
                        >
                          <Plus aria-hidden />{tab === 'all' ? 'Log activity' : `Log first ${tab}`}
                        </Button>
                      </div>
                    ) : filteredActivities.map((a) => {
                      const Icon = activityIcon(a.type);
                      return (
                        <div key={a.id} className={`${ROW} flex items-start gap-3`}>
                          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <p className="text-sm font-medium">{ACTIVITY_LABEL[a.type] ?? humanize(a.type)}</p>
                              <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                            </div>
                            {a.description && (
                              <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted-foreground">{a.description}</p>
                            )}
                            {calling.mayListen && recordedCallId(a) && <CallRecording callId={recordedCallId(a) as string} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <Section
              title="Follow-ups"
              meta={tasks.length}
              action={
                <Button variant="outline" size="sm" onClick={() => setShowNewFollowUp(true)}>
                  <Plus aria-hidden />New follow-up
                </Button>
              }
            >
              {tasks.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No follow-ups yet. Add one so the next step with this lead is not forgotten.
                </p>
              ) : (
                <>
                  <div>
                    {visibleFollowUps.map((t) => {
                      const status = FOLLOW_UP_STATUS[t.status];
                      const done = t.status === 'completed';
                      const overdue = followUpBucket(t, today) === 'overdue';
                      return (
                        <div key={t.id} className={`${ROW} flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1`}>
                          <div className="min-w-0">
                            <p className={cn('truncate text-sm font-medium', done && 'text-muted-foreground')}>{t.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {t.dueDate ? (
                                <span className={overdue ? 'text-destructive' : undefined}>
                                  {overdue ? 'Overdue · ' : 'Due '}{formatDate(t.dueDate)}
                                </span>
                              ) : 'No due date'}
                              {t.projectId && (
                                <>
                                  {' · '}
                                  <Link to={`/project/${t.projectId}`} className="hover:text-foreground hover:underline">
                                    {projectNameById.get(t.projectId) ?? 'Open project'}
                                  </Link>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {t.priority === 'urgent' && <UrgentBadge muted={done} />}
                            {t.priority === 'high' && <PriorityPill priority="high" muted={done} />}
                            <StatusPill tone={status?.tone ?? 'neutral'}>
                              {status?.label ?? humanize(t.status)}
                            </StatusPill>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {tasks.length > SHORT_LIST && (
                    <div className="border-t border-border/60 px-2 py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setShowAllFollowUps((v) => !v)}>
                        {showAllFollowUps ? 'Show fewer' : `Show all ${tasks.length} follow-ups`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="Notes" meta={notes.length}>
              <div className="flex flex-col gap-2 px-4 py-3">
                <Textarea
                  id="contact-note-composer"
                  rows={3}
                  placeholder="Add a note about this lead…"
                  aria-label="Add note"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
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
                  <div>
                    {visibleNotes.map((n) => (
                      <div key={n.id} className={ROW}>
                        <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                  {notes.length > SHORT_LIST && (
                    <div className="border-t border-border/60 px-2 py-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setShowAllNotes((v) => !v)}>
                        {showAllNotes ? 'Show fewer' : `Show all ${notes.length} notes`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Section>

            <Section title="Deals" meta={deals.length}>
              {deals.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
                  <Handshake className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm font-medium">{step === 'customer' ? 'An existing client, with no deal here.' : 'No deals yet.'}</p>
                  <p className="text-xs text-muted-foreground">
                    {step === 'unqualified'
                      ? 'Re-open the lead to convert it to a deal.'
                      : step === 'customer'
                        ? 'Nothing to convert. Add a deal only when there is new work for them.'
                        : 'Once the lead is worth pursuing, convert it to a deal in the pipeline.'}
                  </p>
                  {/* A client is never asked to be converted: they are past that. */}
                  {step !== 'unqualified' && step !== 'customer' && (
                    <Button variant="outline" className="mt-3" onClick={() => setShowConvert(true)}>
                      Convert to deal
                    </Button>
                  )}
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
                        const badge = dealBadge(d);
                        const converted = formatDealConverted(d);
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
                            <td className="whitespace-nowrap px-4 text-right tabular-nums">
                              {formatDeal(d)}
                              {converted && <span className="block text-xs text-muted-foreground">{converted}</span>}
                            </td>
                            <td className="px-4">
                              <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                            </td>
                            <td className="whitespace-nowrap px-4">
                              {d.projectId ? (
                                <Link to={`/project/${d.projectId}`} className="text-primary hover:underline">
                                  Open project
                                </Link>
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
            </Section>
          </div>

          {/* SIDE: details and tags. First on phones, so the lead can be called or emailed at once. */}
          <aside className="order-first flex min-w-0 flex-col gap-6 lg:order-none">
            <Section
              title="Details"
              action={
                <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)}>
                  <Pencil aria-hidden />Edit
                </Button>
              }
            >
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
                <Button variant="outline" size="sm" onClick={() => openLog('note')}>
                  <StickyNote aria-hidden />Note
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (contact.email) window.location.href = `mailto:${contact.email}`;
                    else openLog('email');
                  }}
                >
                  <Mail aria-hidden />Email
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (contact.phone && calling.inApp) setShowCall(true);
                    else if (contact.phone) window.location.href = `tel:${contact.phone}`;
                    else openLog('call');
                  }}
                >
                  <Phone aria-hidden />Call
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowNewFollowUp(true)}>
                  <CalendarPlus aria-hidden />Follow-up
                </Button>
                <Button variant="outline" size="sm" onClick={() => openLog('meeting')}>
                  <Video aria-hidden />Meeting
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3">
                <Detail label="Email" wide>
                  {contact.email && (
                    <span className="flex items-center gap-1">
                      <a href={`mailto:${contact.email}`} className="min-w-0 break-all text-primary hover:underline">
                        {contact.email}
                      </a>
                      <Button variant="ghost" size="icon" aria-label="Copy email" onClick={copyEmail}>
                        <Copy aria-hidden />
                      </Button>
                    </span>
                  )}
                </Detail>
                <Detail label="Phone">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="tabular-nums hover:underline">{contact.phone}</a>
                  )}
                </Detail>
                <Detail label="Job title">{contact.jobTitle}</Detail>
                <Detail label="Company">
                  {company && (
                    <Link to={`/crm/companies/${company.id}`} className="text-primary hover:underline">{company.name}</Link>
                  )}
                </Detail>
                <Detail label="Owner">{owner ? owner.displayName || owner.email : null}</Detail>
                <Detail label="Source">{contact.source}</Detail>
                <Detail label="Category">{contact.category}</Detail>
                <Detail label="Step">
                  <StatusPill tone={stepInfo.tone} title={stepInfo.hint}>{stepInfo.label}</StatusPill>
                </Detail>
                <Detail label="Added">{formatDate(contact.createdAt)}</Detail>
              </dl>
              {customFields.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                  <p className="text-xs font-medium text-foreground">Custom fields</p>
                  {customFields.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{customFieldLabel(k)}</span>
                      <span className="min-w-0 break-words text-right font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Tags">
              <div className="px-4 py-3">
                <ContactTagPicker contactId={contact.id} />
              </div>
            </Section>

            {/* Where this lead is in the automation; shows nothing when no agent is working on it. */}
            <LeadAutomationCard contactId={contact.id} />
          </aside>
        </div>
      </div>

      <ConvertLeadDialog
        lead={contact}
        stages={stages}
        companies={companyOptions}
        open={showConvert}
        onOpenChange={setShowConvert}
        onConverted={refresh}
      />

      <EditLeadDialog
        contact={contact}
        companies={companyOptions}
        open={showEdit}
        onOpenChange={setShowEdit}
        onSaved={refresh}
      />

      <NewFollowUpDialog
        lead={contact}
        organizationId={orgId}
        workspaceId={followUpWorkspaceId}
        projects={followUpProjects}
        assignees={taskAssignees}
        open={showNewFollowUp}
        onOpenChange={setShowNewFollowUp}
        onCreated={refresh}
      />

      {contact.phone && (
        <CallDialog
          open={showCall}
          onOpenChange={setShowCall}
          name={fullName}
          phone={contact.phone}
          target={{ contactId: contact.id }}
          setup={calling.setup}
          onLogged={() => void refresh()}
        />
      )}

      <Dialog open={showLog} onOpenChange={setShowLog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log {(ACTIVITY_LABEL[logType] ?? humanize(logType)).toLowerCase()}</DialogTitle>
            <DialogDescription>Adds it to {fullName}’s timeline.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className={FIELD}>
              <Label htmlFor={`${logFieldId}-type`}>Type</Label>
              <Select value={logType} onValueChange={(v) => setLogType(v as ActivityType)}>
                <SelectTrigger id={`${logFieldId}-type`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className={logType === 'call' ? FIELD_ROW : 'grid grid-cols-1 gap-3'}>
              <div className={FIELD}>
                <Label htmlFor={`${logFieldId}-when`}>When</Label>
                <Input
                  id={`${logFieldId}-when`}
                  type="datetime-local"
                  value={logWhen}
                  max={localInputValue(new Date())}
                  onChange={(e) => setLogWhen(e.target.value)}
                  disabled={busy}
                />
              </div>
              {logType === 'call' && (
                <div className={FIELD}>
                  <Label htmlFor={`${logFieldId}-outcome`}>How did it go?</Label>
                  <Select value={logOutcome} onValueChange={(v) => setLogOutcome(v as CallOutcome)}>
                    <SelectTrigger id={`${logFieldId}-outcome`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OUTCOMES.map((o) => <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {deals.length > 0 && (
              <div className={FIELD}>
                <Label htmlFor={`${logFieldId}-deal`}>About which deal</Label>
                <Select value={logDealId || NO_DEAL} onValueChange={(v) => setLogDealId(v === NO_DEAL ? '' : v)}>
                  <SelectTrigger id={`${logFieldId}-deal`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEAL}>No deal, just the lead</SelectItem>
                    {deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={FIELD}>
              <Label htmlFor={`${logFieldId}-body`}>What happened</Label>
              <Textarea
                id={`${logFieldId}-body`}
                rows={3}
                value={logBody}
                onChange={(e) => setLogBody(e.target.value)}
                placeholder={logType === 'call' ? 'Optional for a call: the outcome is already noted' : undefined}
                disabled={busy}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLog(false)} disabled={busy}>Cancel</Button>
            {/* A call needs no words: "No answer" says it all. Anything else needs something written. */}
            <Button onClick={handleLog} disabled={busy || (logType !== 'call' && !logBody.trim())}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}Log
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnqualifiedDialog
        open={askUnqualified}
        onOpenChange={setAskUnqualified}
        leadName={fullName}
        busy={stepBusy}
        onConfirm={(reason) => {
          unqualifiedReason.current = reason;
          setAskUnqualified(false);
          pickStep('unqualified');
        }}
      />

      <AlertDialog open={confirmStepBack} onOpenChange={setConfirmStepBack}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stepBack === 'unqualified'
                ? `Mark ${fullName} unqualified?`
                : `Move ${fullName} back to ${LEAD_STEPS[stepBack].label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {step === 'customer'
                ? 'This lead is a customer. After this it is treated as a lead again, and asked to be converted to a deal.'
                : 'This lead has a deal open. “Deal open” is set by converting the lead, so you cannot put the lead back on that step by hand.'}
              {' '}The lead’s deals are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stepBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={stepBusy} onClick={() => void saveStep(stepBack)}>
              {stepBack === 'unqualified' ? 'Mark unqualified' : 'Move back'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Deals and follow-ups linked to this lead stay, but lose the link to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

// ─── New follow-up ───────────────────────────────────────────────

/**
 * A follow-up on the lead. Without a project it is a sales follow-up kept
 * in the CRM; with one it also appears on that project's board.
 */
const NewFollowUpDialog: React.FC<{
  lead: CrmContact;
  organizationId: string | null;
  /** The workspace the follow-up is filed under. */
  workspaceId: string | null;
  projects: Project[];
  assignees: TaskAssignee[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void | Promise<void>;
}> = ({ lead, organizationId, workspaceId, projects, assignees, open, onOpenChange, onCreated }) => {
  const { user } = useAuth();
  const fieldId = useId();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [projectId, setProjectId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setTitle('');
    setDueDate('');
    setPriority('medium');
    setProjectId('');
    setAssigneeId('');
  }, [open]);

  const canSave = Boolean(organizationId && user && workspaceId && title.trim());

  const handleCreate = async () => {
    if (!organizationId || !user || !workspaceId || !title.trim()) return;
    // No project = a sales follow-up kept in the CRM only.
    const project = projectId ? projects.find((item) => item.projectId === projectId) : null;
    if (projectId && !project) { toast.error('Choose a project in this workspace'); return; }
    const assignee = assignees.find((item) => item.userId === assigneeId) ?? null;
    setBusy(true);
    try {
      await createTask({
        organizationId,
        workspaceId,
        projectId: project ? project.projectId : null,
        title: title.trim(),
        dueDate: dueDate || null,
        priority,
        contactId: lead.id,
        companyId: lead.companyId,
        assignedTo: assigneeId || null,
      }, user.userId, {
        actorId: user.userId,
        assignee,
        projectName: project?.name,
        sharedStatus: project
          ? [...(project.columns ?? [])].sort((a, b) => a.order - b.order)[0]?.id
          : undefined,
      });
      toast.success(project ? `Follow-up created. It is also on the ${project.name} board.` : 'Follow-up created');
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not create follow-up'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New follow-up for {lead.firstName || leadName(lead)}</DialogTitle>
          <DialogDescription>A reminder of the next step with this lead.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className={FIELD}>
            <Label htmlFor={`${fieldId}-title`}>Title</Label>
            <Input
              id={`${fieldId}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call back about the proposal"
              disabled={busy}
            />
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${fieldId}-project`}>Project (optional)</Label>
            <Select value={projectId || NONE} onValueChange={(v) => setProjectId(v === NONE ? '' : v)} disabled={busy}>
              <SelectTrigger id={`${fieldId}-project`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project (sales follow-up)</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {projectId ? 'Also appears on this project’s board' : 'Stays in the CRM only'}
            </p>
          </div>
          <div className={FIELD}>
            <Label htmlFor={`${fieldId}-assignee`}>Assignee</Label>
            <Select value={assigneeId || NONE} onValueChange={(v) => setAssigneeId(v === NONE ? '' : v)} disabled={busy}>
              <SelectTrigger id={`${fieldId}-assignee`}><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee.userId} value={assignee.userId}>{assignee.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-due`}>Due date</Label>
              <Input id={`${fieldId}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-priority`}>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} disabled={busy}>
                <SelectTrigger id={`${fieldId}-priority`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!workspaceId && (
            <p className="text-xs text-destructive">
              This lead is not in a workspace. Pick a workspace in the sidebar, then add the follow-up.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreate} disabled={busy || !canSave}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Create follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Edit lead ───────────────────────────────────────────────────

const EditLeadDialog: React.FC<{
  contact: CrmContact;
  companies: CrmCompany[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void | Promise<void>;
}> = ({ contact, companies, open, onOpenChange, onSaved }) => {
  const fieldId = useId();
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? '');
  const [companyId, setCompanyId] = useState(contact.companyId ?? '');
  const [source, setSource] = useState(contact.source ?? '');
  const [category, setCategory] = useState(contact.category ?? '');
  const [ownerId, setOwnerId] = useState(contact.ownerId ?? '');
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage>(contact.lifecycleStage);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>(contact.leadStatus);
  const [customRows, setCustomRows] = useState<CustomFieldRow[]>(() => customFieldRows(contact.customFields));
  const { defs: fieldDefs } = useFieldDefs(contact.workspaceId);
  const [customError, setCustomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCustomRows(customFieldRows(contact.customFields));
      setCustomError(null);
      setFirstName(contact.firstName);
      setLastName(contact.lastName ?? '');
      setEmail(contact.email ?? '');
      setPhone(contact.phone ?? '');
      setJobTitle(contact.jobTitle ?? '');
      setCompanyId(contact.companyId ?? '');
      setSource(contact.source ?? '');
      setCategory(contact.category ?? '');
      setOwnerId(contact.ownerId ?? '');
      setLifecycleStage(contact.lifecycleStage);
      setLeadStatus(contact.leadStatus);
    }
  }, [open, contact]);

  const handleSave = async () => {
    const custom = readCustomFieldRows(customRows);
    const customProblem = custom.error ?? rowsProblem(fieldDefs, customRows);
    setCustomError(customProblem);
    if (customProblem) return;
    setBusy(true);
    try {
      await updateContact(contact.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        jobTitle: jobTitle.trim() || null,
        companyId: companyId || null,
        source: source.trim() || null,
        category: category.trim() || null,
        customFields: custom.fields,
        // Sent only when changed, so saving something else never moves the lead to another person.
        ...(ownerId !== (contact.ownerId ?? '') ? { ownerId: ownerId || null } : {}),
        // Sent only when changed here, so a save never undoes the step bar.
        ...(lifecycleStage !== contact.lifecycleStage ? { lifecycleStage } : {}),
        ...(leadStatus !== contact.leadStatus ? { leadStatus } : {}),
      });
      toast.success('Lead updated');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(publicMessage(err, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-first`}>First name</Label>
              <Input id={`${fieldId}-first`} value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-last`}>Last name</Label>
              <Input id={`${fieldId}-last`} value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-email`}>Email</Label>
              <Input id={`${fieldId}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-phone`}>Phone</Label>
              <Input id={`${fieldId}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-job`}>Job title</Label>
              <Input id={`${fieldId}-job`} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-company`}>Company</Label>
              <Select value={companyId || NONE} onValueChange={(v) => setCompanyId(v === NONE ? '' : v)} disabled={busy}>
                <SelectTrigger id={`${fieldId}-company`}><SelectValue placeholder="No company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No company</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className={FIELD_ROW}>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-source`}>Where it came from</Label>
              <Input id={`${fieldId}-source`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Website, referral…" disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${fieldId}-category`}>Category</Label>
              <Input id={`${fieldId}-category`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" maxLength={64} disabled={busy} />
            </div>
          </div>
          <OwnerField id={`${fieldId}-owner`} value={ownerId} onChange={setOwnerId} disabled={busy} />
          <div className="border-t border-border pt-4">
            <CustomFieldsEditor
              rows={customRows}
              onChange={(rows) => { setCustomRows(rows); setCustomError(null); }}
              defs={fieldDefs}
              error={customError}
              disabled={busy}
            />
          </div>
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">
              Advanced
              <span className="ml-2 text-xs font-normal text-muted-foreground">Exact stage and status</span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
              <p className="text-xs text-muted-foreground">
                The step bar on the lead’s page sets these two for you. Change them here only if you need the exact value.
              </p>
              <div className={FIELD_ROW}>
                <div className={FIELD}>
                  <Label htmlFor={`${fieldId}-lifecycle`}>Lifecycle stage</Label>
                  <Select value={lifecycleStage} onValueChange={(v) => setLifecycleStage(v as LifecycleStage)} disabled={busy}>
                    <SelectTrigger id={`${fieldId}-lifecycle`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LIFECYCLE_STAGES.map((s) => (
                        <SelectItem key={s} value={s}>{s === 'evangelist' ? 'Existing client' : humanize(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${fieldId}-status`}>Lead status</Label>
                  <Select value={leadStatus} onValueChange={(v) => setLeadStatus(v as LeadStatus)} disabled={busy}>
                    <SelectTrigger id={`${fieldId}-status`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !firstName.trim()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CrmContactDetailPage;
