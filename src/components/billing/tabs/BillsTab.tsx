import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Trash2, Wallet, AlertTriangle, CheckCircle2, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiTile } from '@/components/dashboards/KpiTile';
import {
  Bill, BillStatus, billTotals, isBillOverdue, updateBill, unmarkBillPaid, deleteBill,
} from '@/services/supabase/bills';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const BILL_STATUS_TONE: Record<BillStatus, string> = {
  draft:   'bg-muted text-muted-foreground border-border',
  open:    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  paid:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  void:    'bg-muted text-muted-foreground border-border line-through',
};
const STATUSES: (BillStatus | 'all')[] = ['all', 'draft', 'open', 'paid', 'overdue', 'void'];

interface Props {
  bills: Bill[];
  loading: boolean;
  orgId: string;
  fmt: (n: number, c?: string) => string;
  onEdit: (b: Bill) => void;
  onChanged: () => Promise<void> | void;
}

export const BillsTab: React.FC<Props> = ({ bills, loading, orgId, fmt, onEdit, onChanged }) => {
  const [statusFilter, setStatusFilter] = useState<BillStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const totals = useMemo(() => billTotals(bills, new Date()), [bills]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') { if (!isBillOverdue(b)) return false; }
        else if (b.status !== statusFilter) return false;
      }
      if (term) {
        const hay = `${b.billNumber} ${b.vendorName} ${b.reference ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [bills, statusFilter, search]);

  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusyId(id);
    try { await fn(); if (ok) toast.success(ok); await onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Payable" value={fmt(totals.payable, undefined)} accent icon={Wallet} />
        <KpiTile label="Overdue" value={fmt(totals.overdue, undefined)} icon={AlertTriangle} />
        <KpiTile label="Paid (30d)" value={fmt(totals.paidLast30, undefined)} icon={CheckCircle2} />
        <KpiTile label="Drafts" value={totals.counts.draft.toLocaleString()} icon={FileText} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as BillStatus | 'all')}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Search bill #, vendor, reference…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <div className="py-10 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bills…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No bills match. Track money you owe with “New bill”.
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Bill #</th>
                <th className="text-left font-semibold px-3 py-2">Vendor</th>
                <th className="text-left font-semibold px-3 py-2">Reference</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="text-left font-semibold px-3 py-2">Issued</th>
                <th className="text-left font-semibold px-3 py-2">Due</th>
                <th className="text-right font-semibold px-3 py-2">Total</th>
                <th className="text-right font-semibold px-3 py-2">Balance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const overdueBill = isBillOverdue(b);
                const shownStatus: BillStatus = overdueBill && b.status !== 'void' && b.status !== 'paid' ? 'overdue' : b.status;
                const balance = Math.max(0, b.total - b.amountPaid);
                const busy = busyId === b.billId;
                return (
                  <tr key={b.billId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button className="font-medium hover:underline" onClick={() => onEdit(b)}>{b.billNumber}</button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{b.vendorName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{b.reference ?? '—'}</td>
                    <td className="px-3 py-2"><Badge className={cn('text-[10px] capitalize', BILL_STATUS_TONE[shownStatus])}>{shownStatus}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground">{format(b.issuedAt, 'PP')}</td>
                    <td className="px-3 py-2 text-muted-foreground">{b.dueAt ? format(b.dueAt, 'PP') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(b.total, b.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{balance > 0 ? fmt(balance, b.currency) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {b.status === 'paid' ? (
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" title="Revert to open" onClick={() => run(b.billId, () => unmarkBillPaid(orgId, b.billId), `Unmarked ${b.billNumber}`)} disabled={busy}>
                            <RotateCcw className="w-3.5 h-3.5" /> Unmark paid
                          </Button>
                        ) : b.status !== 'void' && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => run(b.billId, () => updateBill(orgId, b.billId, { status: 'paid', amountPaid: b.total }), `Marked ${b.billNumber} paid`)} disabled={busy}>
                            Mark paid
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(b)} disabled={busy}>Edit</Button>
                        <button className="text-muted-foreground hover:text-destructive p-1" title="Delete" onClick={() => { if (confirm(`Delete ${b.billNumber}? This cannot be undone.`)) void run(b.billId, () => deleteBill(orgId, b.billId)); }} disabled={busy}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
