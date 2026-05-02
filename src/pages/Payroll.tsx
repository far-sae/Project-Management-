import React, { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Wallet, Plus, Loader2, ChevronLeft, Lock, ShieldAlert, CheckCircle2,
  Trash2,
} from 'lucide-react';
import { usePayrollRuns, usePayrollRunDetail } from '@/hooks/usePayroll';
import { useEmployees } from '@/hooks/useEmployees';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import {
  PayrollItem, PayrollRun, PayrollStatus,
} from '@/services/supabase/payroll';
import { format } from 'date-fns';
import { toast } from 'sonner';

const statusBadge = (s: PayrollStatus) => {
  if (s === 'paid') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
        Paid
      </Badge>
    );
  }
  if (s === 'finalized') {
    return (
      <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30">
        Finalized
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
      Draft
    </Badge>
  );
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const NewRunDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (runId: string) => void;
}> = ({ open, onOpenChange, onCreated }) => {
  const { create } = usePayrollRuns();
  const { profiles } = useEmployees();
  const [periodStart, setPeriodStart] = useState(daysAgoIso(13));
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [payDate, setPayDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodStart || !periodEnd) return;
    if (new Date(periodStart) > new Date(periodEnd)) {
      toast.error('Period start must be before period end');
      return;
    }
    if (profiles.length === 0) {
      toast.error('Set up employees in HR first');
      return;
    }
    setBusy(true);
    try {
      const { run } = await create({
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        payDate: payDate ? new Date(payDate) : null,
        notes: notes.trim() || null,
        employees: profiles,
      });
      toast.success('Draft payroll created');
      onOpenChange(false);
      onCreated(run.runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create run');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New payroll run</DialogTitle>
          <DialogDescription>
            We'll pull clocked time and approved expense reimbursements from
            this date range to build a draft payslip per employee.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-start">Period start</Label>
              <Input
                id="pr-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-end">Period end</Label>
              <Input
                id="pr-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-paydate">Pay date (optional)</Label>
            <Input
              id="pr-paydate"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-notes">Notes</Label>
            <Textarea
              id="pr-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const RunDetail: React.FC<{ runId: string; onBack: () => void }> = ({
  runId,
  onBack,
}) => {
  const {
    run, items, loading, reload, updateItem,
    canEdit, canFinalize, canMarkPaid, canUnmarkPaid, isOwner,
  } = usePayrollRunDetail(runId);
  const { updateRun, remove } = usePayrollRuns();
  const fmt = useFormatMoney();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [editForm, setEditForm] = useState({
    regularHours: '',
    overtimeHours: '',
    hourlyRate: '',
    salaryAmount: '',
    bonus: '',
    deduction: '',
    taxWithholding: '',
    expenseReimbursementTotal: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Hoisted above the early-return below so the hook order is stable across
  // renders (React #310 fired when this lived after the loading guard).
  const [confirmUnmark, setConfirmUnmark] = useState(false);

  if (loading || !run) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalsCurrency = run.currency || 'USD';

  const openEdit = (item: PayrollItem) => {
    setEditing(item);
    setEditForm({
      regularHours: String(item.regularHours),
      overtimeHours: String(item.overtimeHours),
      hourlyRate: String(item.hourlyRate),
      salaryAmount: String(item.salaryAmount),
      bonus: String(item.bonus),
      deduction: String(item.deduction),
      taxWithholding: String(item.taxWithholding),
      expenseReimbursementTotal: String(item.expenseReimbursementTotal),
      notes: item.notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const num = (s: string) => {
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
      };
      await updateItem(editing.itemId, {
        regularHours: num(editForm.regularHours),
        overtimeHours: num(editForm.overtimeHours),
        hourlyRate: num(editForm.hourlyRate),
        salaryAmount: num(editForm.salaryAmount),
        bonus: num(editForm.bonus),
        deduction: num(editForm.deduction),
        taxWithholding: num(editForm.taxWithholding),
        expenseReimbursementTotal: num(editForm.expenseReimbursementTotal),
        notes: editForm.notes.trim() || null,
      });
      toast.success('Payslip updated');
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: PayrollStatus) => {
    setBusy(status);
    try {
      await updateRun(runId, { status });
      const wasUnmark = run?.status === 'paid' && status === 'finalized';
      toast.success(
        wasUnmark
          ? 'Reverted to finalized — run is editable again'
          : status === 'finalized' ? 'Run finalized'
          : status === 'paid' ? 'Run marked as paid'
          : 'Status updated',
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    try {
      await remove(runId);
      toast.success('Payroll run deleted');
      onBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Runs
          </Button>
          <div>
            <h2 className="text-lg font-semibold">
              {format(run.periodStart, 'MMM d')} – {format(run.periodEnd, 'MMM d, yyyy')}
            </h2>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {statusBadge(run.status)}
              {run.payDate && <span>Pay {format(run.payDate, 'MMM d, yyyy')}</span>}
              {run.finalizedAt && (
                <span>Finalized {format(run.finalizedAt, 'MMM d')} by {run.finalizedByName ?? '—'}</span>
              )}
              {run.paidAt && (
                <span>Paid {format(run.paidAt, 'MMM d')} by {run.paidByName ?? '—'}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canFinalize && (
            <Button onClick={() => setStatus('finalized')} disabled={busy === 'finalized'}>
              {busy === 'finalized' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Finalize
            </Button>
          )}
          {canMarkPaid && (
            <Button onClick={() => setStatus('paid')} disabled={busy === 'paid'}>
              {busy === 'paid' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as paid
            </Button>
          )}
          {canUnmarkPaid && (
            <Button
              variant="outline"
              onClick={() => setConfirmUnmark(true)}
              disabled={busy === 'finalized'}
            >
              {busy === 'finalized' && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Unmark as paid
            </Button>
          )}
          {(run.status === 'draft' || isOwner) && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Gross</p>
            <p className="text-lg font-bold">{fmt(run.totalGross, totalsCurrency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Reimbursements</p>
            <p className="text-lg font-bold">{fmt(run.totalReimbursement, totalsCurrency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Deductions</p>
            <p className="text-lg font-bold">{fmt(run.totalDeduction, totalsCurrency)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Net pay</p>
            <p className="text-lg font-bold text-primary">{fmt(run.totalNet, totalsCurrency)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Items table */}
      <Card>
        <CardContent className="pt-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No payslips on this run. Add employees in HR and recreate.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3 text-right">Hours</th>
                    <th className="py-2 pr-3 text-right">Rate</th>
                    <th className="py-2 pr-3 text-right">Gross</th>
                    <th className="py-2 pr-3 text-right">Reimb.</th>
                    <th className="py-2 pr-3 text-right">Deductions</th>
                    <th className="py-2 pr-3 text-right">Net</th>
                    <th className="py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.itemId} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{i.userName ?? 'Unknown'}</div>
                        {i.jobTitle && (
                          <div className="text-xs text-muted-foreground">{i.jobTitle}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {i.payType === 'hourly'
                          ? `${i.regularHours.toFixed(2)}${i.overtimeHours > 0 ? ` + ${i.overtimeHours.toFixed(2)} OT` : ''}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {i.payType === 'hourly'
                          ? fmt(i.hourlyRate, i.currency)
                          : fmt(i.salaryAmount, i.currency)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {fmt(i.grossPay, i.currency)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {fmt(i.expenseReimbursementTotal, i.currency)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {fmt(i.deduction + i.taxWithholding, i.currency)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold">
                        {fmt(i.netPay, i.currency)}
                      </td>
                      <td className="py-2 text-right">
                        {canEdit ? (
                          <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>
                            Edit
                          </Button>
                        ) : (
                          <span title="Editing is restricted to owner + admin">
                            <Lock className="w-3.5 h-3.5 text-muted-foreground inline" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit item dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit payslip · {editing?.userName ?? ''}</DialogTitle>
            <DialogDescription>
              Tweak hours, rate, bonus or deductions. Gross + net recalculate
              automatically.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {run.status === 'finalized' && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    This run is finalized. Edits made here are post-finalization
                    corrections — totals will recalculate and the run will keep
                    its finalized status. Save only after you've reviewed the
                    new amounts.
                  </span>
                </div>
              )}
              {run.status === 'paid' && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    This run is <strong>paid</strong>. Editing now records a
                    correction against an already-disbursed payslip — the run
                    stays marked paid and totals recompute. If money needs to
                    be adjusted on the books, prefer "Unmark as paid" first,
                    edit, then re-mark.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {editing.payType === 'hourly' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>Regular hours</Label>
                      <Input
                        type="number" min="0" step="0.25"
                        value={editForm.regularHours}
                        onChange={(e) => setEditForm((f) => ({ ...f, regularHours: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Overtime hours</Label>
                      <Input
                        type="number" min="0" step="0.25"
                        value={editForm.overtimeHours}
                        onChange={(e) => setEditForm((f) => ({ ...f, overtimeHours: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Hourly rate</Label>
                      <Input
                        type="number" min="0" step="0.01"
                        value={editForm.hourlyRate}
                        onChange={(e) => setEditForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5 col-span-2">
                    <Label>Salary for period</Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={editForm.salaryAmount}
                      onChange={(e) => setEditForm((f) => ({ ...f, salaryAmount: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Bonus</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={editForm.bonus}
                    onChange={(e) => setEditForm((f) => ({ ...f, bonus: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reimbursements</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={editForm.expenseReimbursementTotal}
                    onChange={(e) => setEditForm((f) => ({ ...f, expenseReimbursementTotal: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Deduction</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={editForm.deduction}
                    onChange={(e) => setEditForm((f) => ({ ...f, deduction: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tax withholding</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={editForm.taxWithholding}
                    onChange={(e) => setEditForm((f) => ({ ...f, taxWithholding: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete payroll run?</DialogTitle>
            <DialogDescription>
              This permanently removes the run and all payslips inside it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUnmark} onOpenChange={setConfirmUnmark}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unmark as paid?</DialogTitle>
            <DialogDescription>
              Reverts this run from <strong>paid</strong> back to{' '}
              <strong>finalized</strong> so payslips become editable again.
              Use this when payment was reversed, the wrong run was marked
              paid, or amounts need recalculating before payment ledgers
              close. Payslip values aren't changed by this action.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnmark(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setConfirmUnmark(false);
                await setStatus('finalized');
              }}
              disabled={busy === 'finalized'}
            >
              {busy === 'finalized' && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Unmark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const Payroll: React.FC = () => {
  const { runs, loading, canView, canCreate } = usePayrollRuns();
  const fmt = useFormatMoney();
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Allow ?run= deep-link
  useEffect(() => {
    const url = new URL(window.location.href);
    const param = url.searchParams.get('run');
    if (param) setOpenRunId(param);
  }, []);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) => b.periodEnd.getTime() - a.periodEnd.getTime(),
      ),
    [runs],
  );

  const renderRunRow = (r: PayrollRun) => (
    <li key={r.runId}>
      <button
        type="button"
        onClick={() => setOpenRunId(r.runId)}
        className="w-full text-left rounded-lg border border-border bg-card hover:bg-secondary/40 transition-colors p-3 flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {format(r.periodStart, 'MMM d')} – {format(r.periodEnd, 'MMM d, yyyy')}
            </span>
            {statusBadge(r.status)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Created by {r.createdByName ?? 'Unknown'} on{' '}
            {format(r.createdAt, 'MMM d')}
            {r.payDate && ` · Pay date ${format(r.payDate, 'MMM d')}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Net</div>
          <div className="font-mono font-semibold">
            {fmt(r.totalNet, r.currency)}
          </div>
        </div>
      </button>
    </li>
  );

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {!canView ? (
            <Card>
              <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                Payroll is visible to organization owners and admins only.
              </CardContent>
            </Card>
          ) : openRunId ? (
            <RunDetail runId={openRunId} onBack={() => setOpenRunId(null)} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                    <Wallet className="w-6 h-6 text-primary" /> Payroll
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Period-based payslips. Pulls hours from Time Tracking and
                    approved Expenses automatically.
                  </p>
                </div>
                {canCreate && (
                  <Button onClick={() => setShowCreate(true)}>
                    <Plus className="w-4 h-4 mr-2" /> New payroll
                  </Button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : sortedRuns.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-10 text-sm text-muted-foreground">
                    No payroll runs yet. Click <strong>New payroll</strong> to
                    build one for a date range.
                  </CardContent>
                </Card>
              ) : (
                <ul className="space-y-2">
                  {sortedRuns.map(renderRunRow)}
                </ul>
              )}
            </>
          )}
        </div>
      </main>

      <NewRunDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(runId) => setOpenRunId(runId)}
      />
    </div>
  );
};

export default Payroll;
