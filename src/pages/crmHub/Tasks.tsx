import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  Plus, Trash2, Loader2, Check, Circle, CircleDashed, Pencil, ListChecks,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  useCrmTasks, useCrmContacts, useCrmCompanies, useCrmDeals, useWorkspaceForCreate,
} from '@/hooks/useCrmHub';
import { createTask, updateTask, deleteTask } from '@/services/supabase/crmHub/tasks';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/types/crmHub';
import type { TaskPriority, TaskStatus, CrmTask } from '@/types/crmHub';
import { useProjects } from '@/hooks/useProjects';
import type { TaskAssignee } from '@/types/task';
import { sharedTaskStatusFor } from '@/lib/crmWorkspace';
import {
  FOLLOW_UP_BUCKETS, FOLLOW_UP_BUCKET_LABEL, followUpCounts, groupFollowUps, localYmd,
} from '@/lib/crmFollowUps';
import type { FollowUpBucket } from '@/lib/crmFollowUps';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import type { StatusTone } from '@/components/common/StatusPill';
import { PriorityPill, UrgentBadge } from '@/components/common/TaskBadges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_TONE: Record<TaskStatus, StatusTone> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'success',
};

/** Select value standing in for "nothing chosen" (Radix has no empty value). */
const NONE = '__none__';

/** 28px square icon button in a table row (touch-sized on phones). */
const ROW_ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';

const StatusCircle: React.FC<{ status: TaskStatus; onClick: () => void; busy: boolean }> = ({ status, onClick, busy }) => {
  if (busy) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Saving" />;
  if (status === 'completed') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-80"
        title="Mark pending"
        aria-label="Mark pending"
      >
        <Check className="h-3 w-3" aria-hidden />
      </button>
    );
  }
  if (status === 'in_progress') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="grid h-5 w-5 place-items-center rounded-full text-primary ring-2 ring-primary hover:bg-primary/10"
        title="Mark completed"
        aria-label="Mark completed"
      >
        <CircleDashed className="h-3 w-3" aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-5 w-5 place-items-center rounded-full border border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary"
      title="Mark in progress"
      aria-label="Mark in progress"
    >
      <Circle className="h-3 w-3 opacity-0" aria-hidden />
    </button>
  );
};

/** "18 Nov 2026, 14:30" in the viewer's own time zone. */
const formatDue = (d: Date): string => format(d, 'd MMM yyyy, HH:mm');

/** A saved date as the value of a `datetime-local` field (viewer's time zone). */
const toDueInput = (d: Date): string => format(d, "yyyy-MM-dd'T'HH:mm");

/**
 * A `datetime-local` value as a full timestamp. The field has no time zone,
 * so it is read as the viewer's local time and saved with its offset.
 */
const fromDueInput = (value: string): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const nextStatus = (s: TaskStatus): TaskStatus =>
  s === 'pending' ? 'in_progress' : s === 'in_progress' ? 'completed' : 'pending';

export const CrmTasksPage: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { items: tasks, loading, refresh } = useCrmTasks();
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: deals } = useCrmDeals();
  const workspaceId = useWorkspaceForCreate();
  const { projects: allProjects } = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.workspaceId === workspaceId),
    [allProjects, workspaceId],
  );
  const assignees = useMemo<TaskAssignee[]>(() => {
    const members = organization?.members ?? [];
    const options = members
      .filter((member) => member.status === 'active')
      .map((member) => ({
        userId: member.userId,
        displayName: member.displayName || member.email,
        email: member.email,
        photoURL: member.photoURL,
      }));
    if (user && !options.some((option) => option.userId === user.userId)) {
      options.unshift({
        userId: user.userId,
        displayName: user.displayName || user.email,
        email: user.email,
        photoURL: user.photoURL,
      });
    }
    return options;
  }, [organization?.members, user]);

  const [bucketFilter, setBucketFilter] = useState<FollowUpBucket | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  // shared form state for both create + edit dialogs
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dealId, setDealId] = useState('');
  // Empty = a sales follow-up that lives in the CRM only.
  const [projectId, setProjectId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');

  const resetForm = () => {
    setTitle(''); setDescription(''); setDueDate('');
    setPriority('medium'); setStatus('pending');
    setContactId(''); setCompanyId(''); setDealId('');
    setProjectId(''); setAssignedTo(user?.userId ?? '');
  };

  // When the edit dialog opens, prefill the shared form state from the task.
  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setDescription(editing.description ?? '');
    setDueDate(editing.dueDate ? toDueInput(editing.dueDate) : '');
    setPriority(editing.priority);
    setStatus(editing.status);
    setContactId(editing.contactId ?? '');
    setCompanyId(editing.companyId ?? '');
    setDealId(editing.dealId ?? '');
    setProjectId(editing.projectId ?? '');
    setAssignedTo(editing.assignedTo ?? '');
  }, [editing]);

  const today = localYmd(new Date());

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, statusFilter, priorityFilter]);

  const counts = useMemo(() => followUpCounts(tasks, today), [tasks, today]);
  const groups = useMemo(() => groupFollowUps(filtered, today), [filtered, today]);
  const shownBuckets = (bucketFilter === 'all' ? FOLLOW_UP_BUCKETS : [bucketFilter])
    .filter((bucket) => groups[bucket].length > 0);
  const shownCount = shownBuckets.reduce((n, bucket) => n + groups[bucket].length, 0);
  const filtering = bucketFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all';

  const clearFilters = () => {
    setBucketFilter('all'); setStatusFilter('all'); setPriorityFilter('all');
  };

  const projectNameById = useMemo(
    () => new Map(allProjects.map((project) => [project.projectId, project.name])),
    [allProjects],
  );
  const contactNameById = useMemo(
    () => new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName ?? ''}`.trim()])),
    [contacts],
  );
  const companyNameById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealNameById = useMemo(() => new Map(deals.map((d) => [d.id, d.name])), [deals]);

  // The project of the follow-up being edited stays listed even when it is
  // not one of this workspace's projects, so the field never shows blank.
  const editProjects = useMemo(() => {
    const id = editing?.projectId;
    if (!id || projects.some((project) => project.projectId === id)) return projects;
    return [...projects, { projectId: id, name: projectNameById.get(id) ?? 'Project' }];
  }, [editing?.projectId, projects, projectNameById]);

  const openCreate = () => { resetForm(); setShowCreate(true); };

  const handleCreate = async () => {
    if (!organization || !user || !workspaceId) return;
    if (!title.trim()) { toast.error('Title is required'); return; }
    // No project = a sales follow-up kept in the CRM. With a project it is
    // also added to that project's board.
    const project = projectId ? projects.find((item) => item.projectId === projectId) : null;
    if (projectId && !project) { toast.error('Choose a project in this workspace'); return; }
    const assignee = assignees.find((item) => item.userId === assignedTo) ?? null;
    setBusy(true);
    try {
      await createTask(
        {
          organizationId: organization.organizationId,
          workspaceId,
          projectId: project ? project.projectId : null,
          title: title.trim(),
          description: description.trim() || null,
          dueDate: fromDueInput(dueDate),
          priority,
          status,
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
          assignedTo: assignedTo || null,
        },
        user.userId,
        {
          actorId: user.userId,
          assignee,
          projectName: project?.name,
          sharedStatus: project ? sharedTaskStatusFor(project.columns, status) : undefined,
        },
      );
      toast.success('Follow-up created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create follow-up');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!title.trim()) { toast.error('Title is required'); return; }
    setBusy(true);
    try {
      const project = projects.find((item) => item.projectId === editing.projectId);
      const assignee = assignees.find((item) => item.userId === assignedTo) ?? null;
      await updateTask(editing.id, {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: fromDueInput(dueDate),
        priority,
        status,
        contactId: contactId || null,
        companyId: companyId || null,
        dealId: dealId || null,
        assignedTo: assignedTo || null,
      }, { assignee, sharedStatus: sharedTaskStatusFor(project?.columns, status) });
      toast.success('Follow-up updated');
      setEditing(null);
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update follow-up');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (task: CrmTask) => {
    setStatusBusyId(task.id);
    try {
      const next = nextStatus(task.status);
      const project = projects.find((item) => item.projectId === task.projectId);
      await updateTask(task.id, { status: next }, { sharedStatus: sharedTaskStatusFor(project?.columns, next) });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update follow-up');
    } finally {
      setStatusBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteTask(id);
      toast.success('Follow-up deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete follow-up');
    } finally {
      setBusy(false);
    }
  };

  /** The lead, company and deal a follow-up is about, as links. */
  const linkedRecords = (t: CrmTask) => {
    const links: { key: string; to: string; kind: string; name: string }[] = [];
    if (t.contactId) {
      links.push({ key: 'lead', to: `/crm/contacts/${t.contactId}`, kind: 'Lead', name: contactNameById.get(t.contactId) || 'Lead' });
    }
    if (t.companyId) {
      links.push({ key: 'company', to: `/crm/companies/${t.companyId}`, kind: 'Company', name: companyNameById.get(t.companyId) || 'Company' });
    }
    if (t.dealId) {
      links.push({ key: 'deal', to: `/crm/deals/${t.dealId}`, kind: 'Deal', name: dealNameById.get(t.dealId) || 'Deal' });
    }
    return links;
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Follow-ups"
          description="Calls, emails and next steps for your leads, companies and deals. A follow-up linked to a project also appears on that project's board."
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              New follow-up
            </Button>
          }
        />

        <StatStrip
          items={[
            {
              label: 'Overdue',
              value: counts.overdue,
              note: 'Due before today, still open',
              tone: counts.overdue > 0 ? 'danger' : 'default',
            },
            { label: 'Due today', value: counts.today },
            { label: 'Upcoming', value: counts.upcoming, note: 'Due from tomorrow' },
            { label: 'No date', value: counts.no_date, note: 'Open, not scheduled' },
          ]}
        />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={bucketFilter} onValueChange={(v) => setBucketFilter(v as FollowUpBucket | 'all')}>
                <SelectTrigger className="w-40" aria-label="Show follow-ups by due date">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All follow-ups</SelectItem>
                  {FOLLOW_UP_BUCKETS.map((bucket) => (
                    <SelectItem key={bucket} value={bucket}>{FOLLOW_UP_BUCKET_LABEL[bucket]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaskStatus | 'all')}>
                <SelectTrigger className="w-40" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as TaskPriority | 'all')}>
                <SelectTrigger className="w-40" aria-label="Filter by priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filtering && !loading && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {shownCount} of {tasks.length} shown
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading follow-ups…
              </div>
            ) : shownCount === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <ListChecks className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                {tasks.length === 0 ? (
                  <>
                    <p className="text-sm font-medium">No follow-ups yet.</p>
                    <p className="text-xs text-muted-foreground">
                      Add the next call, email or step for a lead, company or deal.
                    </p>
                    <Button className="mt-3" onClick={openCreate}>
                      <Plus aria-hidden />
                      New follow-up
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">No follow-ups match these filters.</p>
                    <Button variant="outline" className="mt-3" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-left text-sm">
                  <thead>
                    <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                      <th scope="col" className="w-12 pl-4">
                        <span className="sr-only">Progress</span>
                      </th>
                      <th scope="col" className="px-4 font-medium">Follow-up</th>
                      <th scope="col" className="px-4 font-medium">Due</th>
                      <th scope="col" className="px-4 font-medium">Priority</th>
                      <th scope="col" className="px-4 font-medium">Status</th>
                      <th scope="col" className="px-4 font-medium">Project</th>
                      <th scope="col" className="px-4 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  {shownBuckets.map((bucket) => (
                    <tbody key={bucket} className="border-b border-border last:border-0">
                      <tr className="h-8 border-b border-border/60 bg-surface-2">
                        <th
                          scope="colgroup"
                          colSpan={7}
                          className={cn(
                            'px-4 text-xs font-medium',
                            bucket === 'overdue' ? 'text-destructive' : 'text-foreground',
                          )}
                        >
                          {FOLLOW_UP_BUCKET_LABEL[bucket]}
                          <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                            {groups[bucket].length}
                          </span>
                        </th>
                      </tr>
                      {groups[bucket].map((t) => {
                        const overdue = bucket === 'overdue';
                        const done = t.status === 'completed';
                        const links = linkedRecords(t);
                        return (
                          <tr
                            key={t.id}
                            className={cn(
                              'h-12 border-b border-border/60 transition-colors last:border-0',
                              overdue ? 'bg-destructive-soft' : 'hover:bg-muted/40',
                            )}
                          >
                            <td className="pl-4">
                              <StatusCircle
                                status={t.status}
                                onClick={() => void handleAdvance(t)}
                                busy={statusBusyId === t.id}
                              />
                            </td>
                            <td className="max-w-[24rem] px-4 py-2">
                              <button
                                type="button"
                                onClick={() => setEditing(t)}
                                className={cn(
                                  'block max-w-full truncate text-left font-medium hover:underline',
                                  done ? 'text-muted-foreground line-through' : 'text-foreground',
                                )}
                                title={t.title}
                              >
                                {t.title}
                              </button>
                              {links.length > 0 && (
                                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                                  {links.map((link) => (
                                    <Link
                                      key={link.key}
                                      to={link.to}
                                      className="max-w-[12rem] truncate hover:text-foreground hover:underline"
                                      title={`${link.kind}: ${link.name}`}
                                    >
                                      {link.name}
                                    </Link>
                                  ))}
                                </p>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 tabular-nums">
                              {t.dueDate ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className={cn(overdue && 'font-medium text-destructive-soft-foreground', done && 'text-muted-foreground')}>
                                    {formatDue(t.dueDate)}
                                  </span>
                                  {overdue && <StatusPill tone="danger">Overdue</StatusPill>}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4">
                              {t.priority === 'urgent'
                                ? <UrgentBadge muted={done} />
                                : <PriorityPill priority={t.priority} muted={done} />}
                            </td>
                            <td className="px-4">
                              <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
                            </td>
                            <td className="max-w-[14rem] px-4">
                              {t.projectId ? (
                                <Link
                                  to={`/project/${t.projectId}`}
                                  className="block truncate text-foreground hover:underline"
                                  title="Open the project board"
                                >
                                  {projectNameById.get(t.projectId) ?? 'Open project'}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground" title="Sales follow-up, not on a project board">
                                  <span aria-hidden>—</span>
                                  <span className="sr-only">No project</span>
                                </span>
                              )}
                            </td>
                            <td className="px-4">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={ROW_ICON_BUTTON}
                                  onClick={() => setEditing(t)}
                                  title="Edit"
                                  aria-label={`Edit ${t.title}`}
                                >
                                  <Pencil aria-hidden />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={cn(ROW_ICON_BUTTON, 'hover:bg-destructive-soft hover:text-destructive')}
                                  onClick={() => setConfirmDelete(t.id)}
                                  title="Delete"
                                  aria-label={`Delete ${t.title}`}
                                >
                                  <Trash2 aria-hidden />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New follow-up</DialogTitle></DialogHeader>
          <TaskFormFields
            title={title} setTitle={setTitle}
            description={description} setDescription={setDescription}
            dueDate={dueDate} setDueDate={setDueDate}
            priority={priority} setPriority={setPriority}
            status={status} setStatus={setStatus}
            contactId={contactId} setContactId={setContactId}
            companyId={companyId} setCompanyId={setCompanyId}
            dealId={dealId} setDealId={setDealId}
            projectId={projectId} setProjectId={setProjectId}
            assignedTo={assignedTo} setAssignedTo={setAssignedTo}
            contacts={contacts} companies={companies} deals={deals}
            projects={projects} assignees={assignees}
            projectDisabled={false}
            busy={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — same fields, prefilled from `editing` */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit follow-up</DialogTitle></DialogHeader>
          <TaskFormFields
            title={title} setTitle={setTitle}
            description={description} setDescription={setDescription}
            dueDate={dueDate} setDueDate={setDueDate}
            priority={priority} setPriority={setPriority}
            status={status} setStatus={setStatus}
            contactId={contactId} setContactId={setContactId}
            companyId={companyId} setCompanyId={setCompanyId}
            dealId={dealId} setDealId={setDealId}
            projectId={projectId} setProjectId={setProjectId}
            assignedTo={assignedTo} setAssignedTo={setAssignedTo}
            contacts={contacts} companies={companies} deals={deals}
            projects={editProjects} assignees={assignees}
            projectDisabled
            busy={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); resetForm(); }} disabled={busy}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this follow-up?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && void handleDelete(confirmDelete)}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

// ─── Shared form fields for Create + Edit dialogs ─────────────────

interface FieldsProps {
  title: string; setTitle: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  dueDate: string; setDueDate: (v: string) => void;
  priority: TaskPriority; setPriority: (v: TaskPriority) => void;
  status: TaskStatus; setStatus: (v: TaskStatus) => void;
  contactId: string; setContactId: (v: string) => void;
  companyId: string; setCompanyId: (v: string) => void;
  dealId: string; setDealId: (v: string) => void;
  projectId: string; setProjectId: (v: string) => void;
  assignedTo: string; setAssignedTo: (v: string) => void;
  contacts: { id: string; firstName: string; lastName: string | null }[];
  companies: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  projects: { projectId: string; name: string }[];
  assignees: TaskAssignee[];
  projectDisabled: boolean;
  busy: boolean;
}

const TaskFormFields: React.FC<FieldsProps> = ({
  title, setTitle, description, setDescription, dueDate, setDueDate,
  priority, setPriority, status, setStatus,
  contactId, setContactId, companyId, setCompanyId, dealId, setDealId,
  projectId, setProjectId, assignedTo, setAssignedTo,
  contacts, companies, deals, projects, assignees, projectDisabled, busy,
}) => (
  <div className="space-y-3">
    <div className="space-y-1.5">
      <Label htmlFor="ttitle">Title *</Label>
      <Input id="ttitle" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="tproject">Project (optional)</Label>
        <Select
          value={projectId || NONE}
          onValueChange={(v) => setProjectId(v === NONE ? '' : v)}
          disabled={busy || projectDisabled}
        >
          <SelectTrigger id="tproject"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No project (sales follow-up)</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.projectId} value={project.projectId}>{project.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {projectId ? "Also appears on this project's board" : 'Stays in the CRM only'}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tassignee">Assignee</Label>
        <Select value={assignedTo || NONE} onValueChange={(value) => setAssignedTo(value === NONE ? '' : value)} disabled={busy}>
          <SelectTrigger id="tassignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {assignees.map((assignee) => (
              <SelectItem key={assignee.userId} value={assignee.userId}>{assignee.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="tdesc">Description</Label>
      <Textarea id="tdesc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} rows={2} />
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="tdue">Due date</Label>
        <Input id="tdue" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tpriority">Priority</Label>
        <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} disabled={busy}>
          <SelectTrigger id="tpriority"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tstatus">Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)} disabled={busy}>
          <SelectTrigger id="tstatus"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="tlead">Lead</Label>
        <Select value={contactId || NONE} onValueChange={(v) => setContactId(v === NONE ? '' : v)} disabled={busy}>
          <SelectTrigger id="tlead"><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName ?? ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tcompany">Company</Label>
        <Select value={companyId || NONE} onValueChange={(v) => setCompanyId(v === NONE ? '' : v)} disabled={busy}>
          <SelectTrigger id="tcompany"><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tdeal">Deal</Label>
        <Select value={dealId || NONE} onValueChange={(v) => setDealId(v === NONE ? '' : v)} disabled={busy}>
          <SelectTrigger id="tdeal"><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {deals.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
);

export default CrmTasksPage;
