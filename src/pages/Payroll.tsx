import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { HrScopeLine } from '@/components/hr/HrScopeLine';
import { usePayrollRuns, usePayrollRunDetail } from '@/hooks/usePayroll';
import { useEmployees } from '@/hooks/useEmployees';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useHrWorkspacePeople } from '@/hooks/useHrWorkspacePeople';
import {
  PayrollItem, PayrollRun, PayrollStatus, computeRunTotals, getPayrollRun,
} from '@/services/supabase/payroll';
import { format } from 'date-fns';
import { toast } from 'sonner';

const statusBadge = (s: PayrollStatus) => {
  if (s === 'paid') return <StatusPill tone="success">Paid</StatusPill>;
  if (s === 'finalized') return <StatusPill tone="info">Finalized</StatusPill>;
  return <StatusPill tone="warning">Draft</StatusPill>;
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
  // A run is one record for the whole company, whichever workspace is showing.
  const showingPartOfCompany = useHrWorkspacePeople().scopedUserIds !== null;
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
            {showingPartOfCompany &&
              ' A run covers the whole company, not only the people showing.'}
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
              {busy && <Loader2 className="animate-spin" aria-hidden />}
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

  // A run is one record for the whole company. With a workspace selected only
  // its people's payslips show, and the totals are worked out from those.
  const hrScope = useHrWorkspacePeople();
  const { inScope } = hrScope;
  const scoped = hrScope.scopedUserIds !== null;
  const shownItems = useMemo(
    () => (scoped ? items.filter((i) => inScope(i.userId)) : items),
    [scoped, items, inScope],
  );
  const shownTotals = useMemo(() => (scoped ? computeRunTotals(shownItems) : null), [scoped, shownItems]);

  if (loading || !run || hrScope.waiting) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading payroll run" />
      </div>
    );
  }

  const totalsCurrency = run.currency || 'USD';
  const totals = shownTotals ?? run;

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
            <ChevronLeft aria-hidden /> Runs
          </Button>
        </div>
        <PageHeader
          title={
            <span className="tabular-nums">
              {format(run.periodStart, 'MMM d')} – {format(run.periodEnd, 'MMM d, yyyy')}
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {statusBadge(run.status)}
              {run.payDate && <span>Pay {format(run.payDate, 'MMM d, yyyy')}</span>}
              {run.finalizedAt && (
                <span>Finalized {format(run.finalizedAt, 'MMM d')} by {run.finalizedByName ?? '—'}</span>
              )}
              {run.paidAt && (
                <span>Paid {format(run.paidAt, 'MMM d')} by {run.paidByName ?? '—'}</span>
              )}
            </span>
          }
          actions={
            <>
              {canUnmarkPaid && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmUnmark(true)}
                  disabled={busy === 'finalized'}
                >
                  {busy === 'finalized' && <Loader2 className="animate-spin" aria-hidden />}
                  Unmark as paid
                </Button>
              )}
              {(run.status === 'draft' || isOwner) && (
                <Button
                  variant="outline"
                  className="text-destructive hover:bg-destructive-soft hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              )}
              {canFinalize && (
                <Button onClick={() => setStatus('finalized')} disabled={busy === 'finalized'}>
                  {busy === 'finalized' && <Loader2 className="animate-spin" aria-hidden />}
                  Finalize
                </Button>
              )}
              {canMarkPaid && (
                <Button onClick={() => setStatus('paid')} disabled={busy === 'paid'}>
                  {busy === 'paid' ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 aria-hidden />
                  )}
                  Mark as paid
                </Button>
              )}
            </>
          }
        />
      </div>

      {/* Totals */}
      <div className="flex flex-col gap-2">
        <StatStrip
          items={[
            { label: 'Gross', value: fmt(totals.totalGross, totalsCurrency) },
            { label: 'Reimbursements', value: fmt(totals.totalReimbursement, totalsCurrency) },
            { label: 'Deductions', value: fmt(totals.totalDeduction, totalsCurrency) },
            { label: 'Net pay', value: fmt(totals.totalNet, totalsCurrency) },
          ]}
        />
        {scoped && hrScope.figureNote && (
          <p className="text-xs text-muted-foreground">
            {hrScope.figureNote}. Finalizing, marking as paid or deleting applies to the whole run.
          </p>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-hidden rounded-lg border border-border">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <Wallet className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No payslips on this run.</p>
            <p className="text-xs text-muted-foreground">Add employees in HR and recreate.</p>
          </div>
        ) : shownItems.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <Wallet className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Nobody here is on this run.</p>
            <p className="text-xs text-muted-foreground">
              Its payslips are for people in other workspaces. Switch to All workspaces to see them.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                  <th scope="col" className="px-4 font-medium">Employee</th>
                  <th scope="col" className="px-4 text-right font-medium">Hours</th>
                  <th scope="col" className="px-4 text-right font-medium">Rate</th>
                  <th scope="col" className="px-4 text-right font-medium">Gross</th>
                  <th scope="col" className="px-4 text-right font-medium">Reimb.</th>
                  <th scope="col" className="px-4 text-right font-medium">Deductions</th>
                  <th scope="col" className="px-4 text-right font-medium">Net</th>
                  <th scope="col" className="px-4 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownItems.map((i) => (
                  <tr
                    key={i.itemId}
                    className="h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-1.5">
                      <div className="font-medium">{i.userName ?? 'Unknown'}</div>
                      {i.jobTitle && (
                        <div className="text-xs text-muted-foreground">{i.jobTitle}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums">
                      {i.payType === 'hourly'
                        ? `${i.regularHours.toFixed(2)}${i.overtimeHours > 0 ? ` + ${i.overtimeHours.toFixed(2)} OT` : ''}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums">
                      {i.payType === 'hourly'
                        ? fmt(i.hourlyRate, i.currency)
                        : fmt(i.salaryAmount, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums">
                      {fmt(i.grossPay, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums">
                      {fmt(i.expenseReimbursementTotal, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums">
                      {fmt(i.deduction + i.taxWithholding, i.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right font-semibold tabular-nums">
                      {fmt(i.netPay, i.currency)}
                    </td>
                    <td className="px-4 text-right">
                      {canEdit ? (
                        <Button size="sm" variant="ghost" onClick={() => openEdit(i)}>
                          Edit
                        </Button>
                      ) : (
                        <span title="Editing is restricted to owner + admin">
                          <Lock className="inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-xs text-warning-soft-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    This run is finalized. Edits made here are post-finalization
                    corrections — totals will recalculate and the run will keep
                    its finalized status. Save only after you've reviewed the
                    new amounts.
                  </span>
                </div>
              )}
              {run.status === 'paid' && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-2.5 text-xs text-destructive-soft-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
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
              {saving && <Loader2 className="animate-spin" aria-hidden />}
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
                <Loader2 className="animate-spin" aria-hidden />
              )}
              Unmark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const Payroll: React.FC<{
  /** Rendered inside another page (the HR tabs): no page header bar of its own. */
  embedded?: boolean;
}> = ({ embedded = false }) => {
  const { organizationId, runs, loading, canView, canCreate } = usePayrollRuns();
  const fmt = useFormatMoney();
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // With a workspace selected, a run's net pay in the list is the net pay of
  // that workspace's people. The saved total on a run is for the whole
  // company, so the payslips are read to work it out.
  const hrScope = useHrWorkspacePeople();
  const { inScope } = hrScope;
  const scoped = hrScope.scopedUserIds !== null;
  const [itemsByRun, setItemsByRun] = useState<Map<string, PayrollItem[]>>(() => new Map());
  useEffect(() => {
    if (!scoped || !canView || !organizationId) return;
    let cancelled = false;
    void Promise.all(
      runs.map(async (r) => [r.runId, (await getPayrollRun(organizationId, r.runId)).items] as const),
    ).then((pairs) => {
      if (!cancelled) setItemsByRun(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [scoped, canView, organizationId, runs]);

  /** Net pay to show for a run; `null` while the workspace's share is being worked out. */
  const netFor = (r: PayrollRun): number | null => {
    if (!scoped) return r.totalNet;
    const items = itemsByRun.get(r.runId);
    return items ? computeRunTotals(items.filter((i) => inScope(i.userId))).totalNet : null;
  };

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

  const renderRunRow = (r: PayrollRun) => {
    const net = netFor(r);
    return (
    <li key={r.runId} className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpenRunId(r.runId)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular-nums">
              {format(r.periodStart, 'MMM d')} – {format(r.periodEnd, 'MMM d, yyyy')}
            </span>
            {statusBadge(r.status)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Created by {r.createdByName ?? 'Unknown'} on{' '}
            {format(r.createdAt, 'MMM d')}
            {r.payDate && ` · Pay date ${format(r.payDate, 'MMM d')}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-medium text-muted-foreground">Net</div>
          <div className="font-semibold tabular-nums">
            {net === null ? <span className="text-muted-foreground">—</span> : fmt(net, r.currency)}
          </div>
        </div>
      </button>
    </li>
    );
  };

  const body = (
    <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
      {!canView ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-12 text-center">
          <ShieldAlert className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            Payroll is visible to organization owners and admins only.
          </p>
        </div>
      ) : openRunId ? (
        <RunDetail runId={openRunId} onBack={() => setOpenRunId(null)} />
      ) : (
        <>
          <PageHeader
            title="Payroll"
            description="Period-based payslips. Pulls hours from Time Tracking and approved Expenses automatically."
            actions={
              canCreate && (
                <Button onClick={() => setShowCreate(true)}>
                  <Plus aria-hidden /> New payroll
                </Button>
              )
            }
          />

          {(hrScope.label || hrScope.error) && (
            <div className="-mt-3 flex flex-col gap-0.5">
              <HrScopeLine scope={hrScope} />
              {scoped && (
                <p className="text-xs text-muted-foreground">
                  Each run covers the whole company. Net pay here is for the people showing.
                </p>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            {loading || hrScope.waiting ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading payroll runs" />
              </div>
            ) : sortedRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <Wallet className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">No payroll runs yet.</p>
                <p className="text-xs text-muted-foreground">
                  Click <strong className="font-medium text-foreground">New payroll</strong> to
                  build one for a date range.
                </p>
              </div>
            ) : (
              <ul>{sortedRuns.map(renderRunRow)}</ul>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {embedded ? (
        body
      ) : (
        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <AppHeader left={<span className="text-sm font-semibold">Payroll</span>} />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{body}</div>
        </main>
      )}

      <NewRunDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={(runId) => setOpenRunId(runId)}
      />
    </>
  );
};

export default Payroll;
