import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Loader2, Check, Circle, CircleDashed } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import {
  useCrmTasks, useCrmContacts, useCrmCompanies, useCrmDeals,
} from '@/hooks/useCrmHub';
import { createTask, updateTask, deleteTask } from '@/services/supabase/crmHub/tasks';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/types/crmHub';
import type { TaskPriority, TaskStatus, CrmTask } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const priorityColor: Record<TaskPriority, string> = {
  low: 'bg-slate-500/10 text-slate-500',
  medium: 'bg-blue-500/10 text-blue-500',
  high: 'bg-amber-500/10 text-amber-500',
  urgent: 'bg-destructive/10 text-destructive',
};

const StatusIcon: React.FC<{ status: TaskStatus }> = ({ status }) => {
  if (status === 'completed') return <Check className="w-4 h-4 text-emerald-500" />;
  if (status === 'in_progress') return <CircleDashed className="w-4 h-4 text-amber-500" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
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

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dealId, setDealId] = useState('');

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName ?? ''}`.trim()])),
    [contacts],
  );
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d.name])), [deals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tasks, search, statusFilter]);

  const resetForm = () => {
    setTitle(''); setDescription(''); setDueDate('');
    setPriority('medium'); setStatus('pending');
    setContactId(''); setCompanyId(''); setDealId('');
  };

  const handleCreate = async () => {
    if (!organization) return;
    if (!title.trim()) { toast.error('Title is required'); return; }
    setBusy(true);
    try {
      await createTask(
        {
          organizationId: organization.organizationId,
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
              Follow-ups tied to a contact, company, or deal.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" /> New task
          </Button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or description…"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaskStatus | 'all')}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{filtered.length} task{filtered.length === 1 ? '' : 's'}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                {search || statusFilter !== 'all' ? 'No tasks match your filters.' : 'No tasks yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((t) => {
                  const linkedLabel = t.dealId
                    ? `Deal · ${dealById.get(t.dealId) ?? '(deleted)'}`
                    : t.contactId
                    ? `Contact · ${contactById.get(t.contactId) ?? '(deleted)'}`
                    : t.companyId
                    ? `Company · ${companyById.get(t.companyId) ?? '(deleted)'}`
                    : null;
                  const overdue = t.dueDate && t.status !== 'completed' && t.dueDate.getTime() < Date.now();
                  return (
                    <div
                      key={t.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => void handleAdvance(t)}
                        disabled={statusBusyId === t.id}
                        className="mt-1 shrink-0"
                        title="Cycle status"
                      >
                        {statusBusyId === t.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        ) : (
                          <StatusIcon status={t.status} />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`font-medium text-sm ${t.status === 'completed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                            {t.title}
                          </div>
                          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${priorityColor[t.priority]}`}>
                            {t.priority}
                          </span>
                          {overdue && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                              overdue
                            </span>
                          )}
                        </div>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          {t.dueDate && <span>Due {t.dueDate.toLocaleDateString()}</span>}
                          {linkedLabel && <span>{linkedLabel}</span>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDelete(t.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
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
                <Input id="tdue" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={busy} />
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
                <Label>Contact</Label>
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
                <Label>Company</Label>
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
                <Label>Deal</Label>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
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

export default CrmTasksPage;
