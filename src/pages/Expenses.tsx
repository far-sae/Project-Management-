import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/common/StatusPill';
import { StatStrip } from '@/components/common/StatStrip';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Loader2, Paperclip, FileText, Check, X, Trash2, Edit,
  ExternalLink, Filter,
} from 'lucide-react';
import { HrScopeLine } from '@/components/hr/HrScopeLine';
import { useExpenses } from '@/hooks/useExpenses';
import { useHrWorkspacePeople } from '@/hooks/useHrWorkspacePeople';
import { useAuth } from '@/context/AuthContext';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useProjects } from '@/hooks/useProjects';
import { useAllTasks } from '@/hooks/useAllTasks';
import {
  Expense, ExpenseStatus, uploadExpenseInvoice,
} from '@/services/supabase/expenses';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];
const CATEGORIES = ['Materials', 'Tools', 'Fuel', 'Travel', 'Subcontractor', 'Other'];

type FormState = {
  title: string;
  description: string;
  category: string;
  amount: string;
  currency: string;
  vendor: string;
  projectId: string;
  taskId: string;
  incurredOn: string;
};

const blankForm: FormState = {
  title: '',
  description: '',
  category: 'Materials',
  amount: '',
  currency: 'USD',
  vendor: '',
  projectId: 'none',
  taskId: 'none',
  incurredOn: new Date().toISOString().slice(0, 10),
};

const statusBadge = (s: ExpenseStatus) => {
  switch (s) {
    case 'approved':
      return (
        <StatusPill tone="success" dot={false}>
          <Check className="h-3 w-3" /> Approved
        </StatusPill>
      );
    case 'rejected':
      return (
        <StatusPill tone="danger" dot={false}>
          <X className="h-3 w-3" /> Rejected
        </StatusPill>
      );
    default:
      return (
        <StatusPill tone="warning">Pending</StatusPill>
      );
  }
};

export const Expenses: React.FC<{
  /** Inside the HR tabs: the page's own header bar is left out. */
  embedded?: boolean;
}> = ({ embedded = false }) => {
  const { user } = useAuth();
  const {
    organizationId, expenses, loading, create, update, remove, canManage,
  } = useExpenses();
  const { projects } = useProjects();
  const { tasks } = useAllTasks();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<'me' | 'all'>('me');
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all');
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  // IDs the current reviewer just approved/rejected. We keep them visible
  // in the current filter even if their new status no longer matches the
  // selected statusFilter — otherwise an admin filtering by "Pending"
  // would see rows vanish the moment they click Approve, which feels like
  // a bug. Cleared whenever the filter is changed manually.
  const [recentlyActed, setRecentlyActed] = useState<Set<string>>(
    () => new Set(),
  );
  const orgCurrency = useOrgCurrency();
  const fmt = useFormatMoney();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Deep-link from a task panel: ?new=1&taskId=…&projectId=…&taskTitle=…
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const taskId = searchParams.get('taskId') ?? 'none';
    const projectId = searchParams.get('projectId') ?? 'none';
    const taskTitle = searchParams.get('taskTitle') ?? '';
    setForm((f) => ({
      ...blankForm,
      projectId,
      taskId,
      title: taskTitle ? `Expense for ${taskTitle}` : f.title,
    }));
    setShowCreate(true);
    // Strip the params so we don't re-open the dialog on refresh
    const next = new URLSearchParams(searchParams);
    ['new', 'taskId', 'projectId', 'projectName', 'taskTitle'].forEach((k) =>
      next.delete(k),
    );
    setSearchParams(next, { replace: true });
  }, []);

  const tasksForProject = useMemo(() => {
    if (form.projectId === 'none') return [];
    return tasks.filter((t) => t.projectId === form.projectId);
  }, [tasks, form.projectId]);

  // "All expenses" follows the workspace picked in the sidebar: only the
  // people in it are listed and totalled. "My expenses" is the person's own
  // and always shows.
  const hrScope = useHrWorkspacePeople();
  const { inScope } = hrScope;
  const teamIsScoped = hrScope.scopedUserIds !== null;
  // A workspace is selected but who is in it is not known yet.
  const teamWaiting = tab === 'all' && hrScope.waiting;

  const visible = useMemo(() => {
    if (teamWaiting) return [];
    let list = tab === 'me'
      ? expenses.filter((e) => e.userId === user?.userId)
      : teamIsScoped
        ? expenses.filter((e) => inScope(e.userId))
        : expenses;
    if (statusFilter !== 'all') {
      list = list.filter(
        (e) => e.status === statusFilter || recentlyActed.has(e.expenseId),
      );
    }
    list = list.filter((e) => inRange(e.incurredOn, dateRange));
    return list;
  }, [expenses, tab, statusFilter, user?.userId, dateRange, recentlyActed, teamWaiting, teamIsScoped, inScope]);

  // Group totals by the *resolved display currency*, not the raw stored
  // currency. Expenses entered before the org's preferred currency was set
  // are stamped 'USD' (the legacy default) and our display formatter
  // re-renders them in the org currency — so the totals strip needs to
  // bucket them the same way, otherwise you'd see "USD total ₹24,444" which
  // is the bug the user just hit.
  const totals = useMemo(() => {
    const resolveDisplayCurrency = (rowCurrency: string | null | undefined): string => {
      const trimmed = (rowCurrency ?? '').trim().toUpperCase();
      return trimmed && trimmed !== 'USD' ? trimmed : orgCurrency;
    };
    const byCurrency = new Map<string, number>();
    visible.forEach((e) => {
      if (e.status === 'rejected') return;
      const cur = resolveDisplayCurrency(e.currency);
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + e.amount);
    });
    return Array.from(byCurrency.entries());
  }, [visible, orgCurrency]);

  const resetForm = () => {
    // New expenses pre-fill the org's preferred currency. Editing an existing
    // expense overwrites this in openEdit() — historical entries keep their
    // original currency.
    setForm({ ...blankForm, currency: orgCurrency });
    setInvoiceFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setForm({
      title: expense.title,
      description: expense.description ?? '',
      category: expense.category ?? 'Materials',
      amount: String(expense.amount),
      currency: expense.currency,
      vendor: expense.vendor ?? '',
      projectId: expense.projectId ?? 'none',
      taskId: expense.taskId ?? 'none',
      incurredOn: expense.incurredOn.toISOString().slice(0, 10),
    });
    setInvoiceFile(null);
  };

  const closeCreateOrEdit = () => {
    setShowCreate(false);
    setEditing(null);
    resetForm();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.amount.trim() || !organizationId) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    setSubmitting(true);
    try {
      const invoice = invoiceFile
        ? await uploadExpenseInvoice(organizationId, invoiceFile)
        : null;

      const projectName = form.projectId !== 'none'
        ? projects.find((p) => p.projectId === form.projectId)?.name ?? null
        : null;
      const taskTitle = form.taskId !== 'none'
        ? tasks.find((t) => t.taskId === form.taskId)?.title ?? null
        : null;

      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category || null,
        amount,
        currency: form.currency,
        vendor: form.vendor.trim() || null,
        projectId: form.projectId !== 'none' ? form.projectId : null,
        projectName,
        taskId: form.taskId !== 'none' ? form.taskId : null,
        taskTitle,
        incurredOn: new Date(form.incurredOn),
        ...(invoice
          ? {
              invoiceUrl: invoice.invoiceUrl,
              invoicePath: invoice.invoicePath,
              invoiceName: invoice.invoiceName,
              invoiceType: invoice.invoiceType,
              invoiceSize: invoice.invoiceSize,
            }
          : {}),
      };

      if (editing) {
        await update(editing.expenseId, payload);
        toast.success('Expense updated');
      } else {
        await create(payload);
        toast.success('Expense submitted');
      }
      closeCreateOrEdit();
    } catch (err) {
      toast.error(publicMessage(err, 'Failed to save expense'));
    } finally {
      setSubmitting(false);
    }
  };

  const setStatus = async (
    expense: Expense, status: ExpenseStatus, reason?: string,
  ) => {
    try {
      await update(expense.expenseId, { status, statusReason: reason ?? null });
      // Pin this row in the current view so it doesn't disappear from a
      // "Pending"-filtered list the moment its status changes.
      setRecentlyActed((prev) => {
        const next = new Set(prev);
        next.add(expense.expenseId);
        return next;
      });
      toast.success(
        status === 'approved' ? 'Expense approved'
        : status === 'rejected' ? 'Expense rejected'
        : 'Status updated'
      );
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      toast.error(publicMessage(err, 'Failed to update status'));
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await remove(deleting.expenseId);
      toast.success('Expense deleted');
      setDeleting(null);
    } catch (err) {
      toast.error(publicMessage(err, 'Failed to delete'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const renderCard = (expense: Expense) => {
    const isMine = expense.userId === user?.userId;
    const canEditThis = (isMine && expense.status === 'pending') || canManage;
    const canDeleteThis = (isMine && expense.status === 'pending') || canManage;
    return (
      <Card key={expense.expenseId} className="overflow-hidden">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-foreground">{expense.title}</h3>
                {statusBadge(expense.status)}
                {expense.category && (
                  <Badge variant="outline">{expense.category}</Badge>
                )}
              </div>
              {expense.description && (
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                  {expense.description}
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                <span>By <strong className="text-foreground">{expense.userName ?? 'Unknown'}</strong></span>
                <span>{format(expense.incurredOn, 'MMM d, yyyy')}</span>
                {expense.vendor && <span>Vendor: {expense.vendor}</span>}
                {expense.projectName && <span>Project: {expense.projectName}</span>}
                {expense.taskTitle && <span>Task: {expense.taskTitle}</span>}
              </div>
              {expense.statusReason && (
                <p className="text-xs text-destructive mt-1">
                  Note: {expense.statusReason}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-semibold tabular-nums text-foreground">
                {fmt(expense.amount, expense.currency)}
              </p>
            </div>
          </div>

          {expense.invoiceUrl && (
            <a
              href={expense.invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <FileText className="w-4 h-4" />
              {expense.invoiceName ?? 'Invoice'}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
            {canManage && expense.status === 'pending' && (
              <>
                <Button
                  size="sm" variant="outline"
                  className="border-success/30 text-success-soft-foreground hover:bg-success-soft"
                  onClick={() => setStatus(expense, 'approved')}
                >
                  <Check className="w-4 h-4" /> Approve
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="border-destructive/30 text-destructive-soft-foreground hover:bg-destructive-soft"
                  onClick={() => setRejecting(expense)}
                >
                  <X className="w-4 h-4" /> Reject
                </Button>
              </>
            )}
            {canEditThis && (
              <Button size="sm" variant="ghost" onClick={() => openEdit(expense)}>
                <Edit className="w-4 h-4" /> Edit
              </Button>
            )}
            {canDeleteThis && (
              <Button
                size="sm" variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(expense)}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!embedded && <AppHeader left={<span className="text-sm font-semibold">Expenses</span>} />}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader
            title="Expenses"
            description={
              <>
                Submit material costs &amp; invoices, attach them to a task.
                {canManage && ' Owner + admin can review and approve.'}
              </>
            }
            actions={
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4" /> Add expense
              </Button>
            }
          />

          {/* Totals */}
          {totals.length > 0 && (
            <StatStrip items={totals.map(([cur, total]) => ({ label: `${cur} total`, value: fmt(total, cur) }))} />
          )}

          {/* Tabs and filter */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'me' | 'all')}>
              <TabsList>
                <TabsTrigger value="me">My expenses</TabsTrigger>
                {canManage && <TabsTrigger value="all">All expenses</TabsTrigger>}
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-2 flex-wrap">
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as 'all' | ExpenseStatus);
                  // Manual filter change implies the reviewer wants a clean
                  // view by status — drop the "stay visible" pins so the
                  // list matches the new filter exactly.
                  setRecentlyActed(new Set());
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {tab === 'all' && <HrScopeLine scope={hrScope} />}

          {/* List */}
          {loading || teamWaiting ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading expenses" />
            </div>
          ) : visible.length === 0 ? (
            <Card>
              <CardContent className="text-center py-10 text-sm text-muted-foreground">
                No expenses to show. Click <strong>Add expense</strong> to submit one.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">{visible.map(renderCard)}</div>
          )}
        </div>
        </div>
      </main>

      {/* Create / edit dialog */}
      <Dialog
        open={showCreate || !!editing}
        onOpenChange={(o) => !o && closeCreateOrEdit()}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit expense' : 'New expense'}</DialogTitle>
            <DialogDescription>
              Attach materials, fuel, travel costs, etc. to a task with an
              invoice/receipt.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-title">Title</Label>
              <Input
                id="exp-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. 2x4 lumber, drywall screws"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount">Amount</Label>
                <Input
                  id="exp-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-currency">Currency</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger id="exp-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-cat">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger id="exp-cat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-date">Date</Label>
                <Input
                  id="exp-date"
                  type="date"
                  value={form.incurredOn}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, incurredOn: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-vendor">Vendor / supplier</Label>
              <Input
                id="exp-vendor"
                value={form.vendor}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                placeholder="Home Depot, etc."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-project">Project</Label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, projectId: v, taskId: 'none' }))
                  }
                >
                  <SelectTrigger id="exp-project"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.projectId} value={p.projectId}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-task">Task</Label>
                <Select
                  value={form.taskId}
                  onValueChange={(v) => setForm((f) => ({ ...f, taskId: v }))}
                  disabled={form.projectId === 'none'}
                >
                  <SelectTrigger id="exp-task"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No task</SelectItem>
                    {tasksForProject.map((t) => (
                      <SelectItem key={t.taskId} value={t.taskId}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-desc">Description</Label>
              <Textarea
                id="exp-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={3}
                placeholder="Anything the reviewer should know"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exp-invoice">Invoice / receipt</Label>
              <Input
                ref={fileInputRef}
                id="exp-invoice"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
              />
              {invoiceFile ? (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  {invoiceFile.name}
                </p>
              ) : editing?.invoiceUrl ? (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  Current: {editing.invoiceName ?? 'invoice'}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreateOrEdit}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? 'Save' : 'Submit expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject reason */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject expense</DialogTitle>
            <DialogDescription>
              Optional note shown to the submitter.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (optional)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejecting && setStatus(rejecting, 'rejected', rejectReason || undefined)}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete expense?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{deleting?.title}</strong>. The
              attached invoice file will remain in storage.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
              aria-busy={deleteBusy}
            >
              {deleteBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Expenses;
