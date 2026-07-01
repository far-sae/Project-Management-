import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Loader2, Check, Circle, CircleDashed, Pencil,
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

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Filled pill badges for priority (matches the screenshot).
const priorityBadge: Record<TaskPriority, string> = {
  low: 'bg-slate-500/25 text-slate-200 border-slate-500/30',
  medium: 'bg-slate-500/25 text-slate-200 border-slate-500/30',
  high: 'bg-orange-500 text-white border-orange-500',
  urgent: 'bg-red-500 text-white border-red-500',
};

// Outline pill badges for status.
const statusBadge: Record<TaskStatus, string> = {
  pending: 'border-slate-500/40 text-slate-300 bg-transparent',
  in_progress: 'border-blue-500/40 text-blue-400 bg-transparent',
  completed: 'border-emerald-500/40 text-emerald-400 bg-transparent',
};

const StatusCircle: React.FC<{ status: TaskStatus; onClick: () => void; busy: boolean }> = ({ status, onClick, busy }) => {
  if (busy) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (status === 'completed') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="grid place-items-center w-5 h-5 rounded-full bg-primary text-primary-foreground hover:opacity-80"
        title="Mark pending"
      >
        <Check className="w-3 h-3" />
      </button>
    );
  }
  if (status === 'in_progress') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="grid place-items-center w-5 h-5 rounded-full ring-2 ring-primary text-primary hover:bg-primary/10"
        title="Mark completed"
      >
        <CircleDashed className="w-3 h-3" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid place-items-center w-5 h-5 rounded-full border border-muted-foreground/40 hover:border-primary hover:text-primary text-muted-foreground"
      title="Mark in progress"
    >
      <Circle className="w-3 h-3 opacity-0" />
    </button>
  );
};

const formatDue = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}, ${d.toLocaleTimeString(undefined, { hour12: false })}`;

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

  const resetForm = () => {
    setTitle(''); setDescription(''); setDueDate('');
    setPriority('medium'); setStatus('pending');
    setContactId(''); setCompanyId(''); setDealId('');
  };

  // When the edit dialog opens, prefill the shared form state from the task.
  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setDescription(editing.description ?? '');
    setDueDate(editing.dueDate ? editing.dueDate.toISOString().slice(0, 16) : '');
    setPriority(editing.priority);
    setStatus(editing.status);
    setContactId(editing.contactId ?? '');
    setCompanyId(editing.companyId ?? '');
    setDealId(editing.dealId ?? '');
  }, [editing]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tasks, statusFilter, priorityFilter]);

  const handleCreate = async () => {
    if (!organization) return;
    if (!title.trim()) { toast.error('Title is required'); return; }
    setBusy(true);
    try {
      await createTask(
        {
          organizationId: organization.organizationId,
          workspaceId,
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
          priority,
          status,
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
        },
        user?.userId ?? null,
      );
      toast.success('Task created');
      resetForm();
      setShowCreate(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!title.trim()) { toast.error('Title is required'); return; }
    setBusy(true);
    try {
      await updateTask(editing.id, {
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
        priority,
        status,
        contactId: contactId || null,
        companyId: companyId || null,
        dealId: dealId || null,
      });
      toast.success('Task updated');
      setEditing(null);
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update task');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async (task: CrmTask) => {
    setStatusBusyId(task.id);
    try {
      await updateTask(task.id, { status: nextStatus(task.status) });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update task');
    } finally {
      setStatusBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteTask(id);
      toast.success('Task deleted');
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Stay on top of follow-ups and deadlines.
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowCreate(true); }} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> New task
          </Button>
        </div>

        {/* Filters — two side-by-side dropdowns like the screenshot */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaskStatus | 'all')}>
            <SelectTrigger className="w-52 rounded-full bg-card/60 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as TaskPriority | 'all')}>
            <SelectTrigger className="w-52 rounded-full bg-card/60 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card/40 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {statusFilter !== 'all' || priorityFilter !== 'all' ? 'No tasks match your filters.' : 'No tasks yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="w-10 py-3 pl-6" />
                    <th className="py-3 pr-4 font-medium">Title</th>
                    <th className="py-3 pr-4 font-medium">Due</th>
                    <th className="py-3 pr-4 font-medium">Priority</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-6 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const overdue = t.dueDate && t.status !== 'completed' && t.dueDate.getTime() < Date.now();
                    return (
                      <tr
                        key={t.id}
                        className="border-b border-border/40 last:border-b-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="py-3 pl-6">
                          <StatusCircle
                            status={t.status}
                            onClick={() => void handleAdvance(t)}
                            busy={statusBusyId === t.id}
                          />
                        </td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => setEditing(t)}
                            className={`font-semibold text-left ${t.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'} hover:text-primary`}
                          >
                            {t.title}
                          </button>
                        </td>
                        <td className={`py-3 pr-4 ${overdue ? 'text-red-500 font-semibold' : 'text-foreground/80'}`}>
                          {t.dueDate ? formatDue(t.dueDate) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block px-3 py-0.5 rounded-full text-xs font-medium capitalize border ${priorityBadge[t.priority]}`}>
                            {t.priority}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-block px-3 py-0.5 rounded-full text-xs font-medium capitalize border ${statusBadge[t.status]}`}>
                            {humanize(t.status)}
                          </span>
                        </td>
                        <td className="py-3 pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(t)}
                              className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDelete(t.id)}
                              className="text-red-500 hover:text-red-600 h-8 w-8 p-0"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          <TaskFormFields
            title={title} setTitle={setTitle}
            description={description} setDescription={setDescription}
            dueDate={dueDate} setDueDate={setDueDate}
            priority={priority} setPriority={setPriority}
            status={status} setStatus={setStatus}
            contactId={contactId} setContactId={setContactId}
            companyId={companyId} setCompanyId={setCompanyId}
            dealId={dealId} setDealId={setDealId}
            contacts={contacts} companies={companies} deals={deals}
            busy={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog — same fields, prefilled from `editing` */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit task</DialogTitle></DialogHeader>
          <TaskFormFields
            title={title} setTitle={setTitle}
            description={description} setDescription={setDescription}
            dueDate={dueDate} setDueDate={setDueDate}
            priority={priority} setPriority={setPriority}
            status={status} setStatus={setStatus}
            contactId={contactId} setContactId={setContactId}
            companyId={companyId} setCompanyId={setCompanyId}
            dealId={dealId} setDealId={setDealId}
            contacts={contacts} companies={companies} deals={deals}
            busy={busy}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditing(null); resetForm(); }} disabled={busy}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
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
  contacts: { id: string; firstName: string; lastName: string | null }[];
  companies: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  busy: boolean;
}

const TaskFormFields: React.FC<FieldsProps> = ({
  title, setTitle, description, setDescription, dueDate, setDueDate,
  priority, setPriority, status, setStatus,
  contactId, setContactId, companyId, setCompanyId, dealId, setDealId,
  contacts, companies, deals, busy,
}) => (
  <div className="space-y-3">
    <div>
      <Label htmlFor="ttitle">Title *</Label>
      <Input id="ttitle" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
    </div>
    <div>
      <Label htmlFor="tdesc">Description</Label>
      <Textarea id="tdesc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} rows={2} />
    </div>
    <div className="grid grid-cols-3 gap-3">
      <div>
        <Label htmlFor="tdue">Due date</Label>
        <Input id="tdue" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
      </div>
      <div>
        <Label>Priority</Label>
        <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} disabled={busy}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{humanize(p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)} disabled={busy}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3">
      <div>
        <Label>Lead</Label>
        <Select value={contactId || '__none__'} onValueChange={(v) => setContactId(v === '__none__' ? '' : v)} disabled={busy}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName ?? ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Business</Label>
        <Select value={companyId || '__none__'} onValueChange={(v) => setCompanyId(v === '__none__' ? '' : v)} disabled={busy}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Contract</Label>
        <Select value={dealId || '__none__'} onValueChange={(v) => setDealId(v === '__none__' ? '' : v)} disabled={busy}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
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
