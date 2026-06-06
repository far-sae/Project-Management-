import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, FileDown, Send, Trash2, Wallet, AlertTriangle, CheckCircle2, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KpiTile } from '@/components/dashboards/KpiTile';
import {
  Invoice, InvoiceStatus, invoiceTotals, isOverdue,
  updateInvoice, unmarkInvoicePaid, deleteInvoice, sendInvoice,
} from '@/services/supabase/invoices';
import { downloadInvoicePdf } from '@/components/billing/invoicePdf';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft:   'bg-muted text-muted-foreground border-border',
  sent:    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  paid:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  void:    'bg-muted text-muted-foreground border-border line-through',
};
const STATUSES: (InvoiceStatus | 'all')[] = ['all', 'draft', 'sent', 'paid', 'overdue', 'void'];

interface Props {
  invoices: Invoice[];
  loading: boolean;
  orgId: string;
  orgName: string;
  clientName: (id: string) => string;
  fmt: (n: number, c?: string) => string;
  onEdit: (inv: Invoice) => void;
  onChanged: () => Promise<void> | void;
}

export const InvoicesTab: React.FC<Props> = ({ invoices, loading, orgId, orgName, clientName, fmt, onEdit, onChanged }) => {
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const totals = useMemo(() => invoiceTotals(invoices, new Date()), [invoices]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoices.filter((i) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') { if (!isOverdue(i)) return false; }
        else if (i.status !== statusFilter) return false;
      }
      if (term) {
        const hay = `${i.invoiceNumber} ${i.title ?? ''} ${clientName(i.clientId)}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search, clientName]);

  const run = async (id: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusyId(id);
    try { await fn(); if (ok) toast.success(ok); await onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };

  const pdf = async (inv: Invoice) => {
    try { await downloadInvoicePdf(inv, { name: orgName }, clientName(inv.clientId)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not build PDF'); }
  };

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Outstanding" value={fmt(totals.outstanding, undefined)} accent icon={Wallet} />
        <KpiTile label="Overdue" value={fmt(totals.overdue, undefined)} icon={AlertTriangle} />
        <KpiTile label="Paid (30d)" value={fmt(totals.paidLast30, undefined)} icon={CheckCircle2} />
        <KpiTile label="Drafts" value={totals.counts.draft.toLocaleString()} icon={FileText} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | 'all')}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Search number, title, account…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <div className="py-10 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading invoices…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No invoices match. Create one with “New invoice”.
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Invoice</th>
                <th className="text-left font-semibold px-3 py-2">Account</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="text-left font-semibold px-3 py-2">Issued</th>
                <th className="text-left font-semibold px-3 py-2">Due</th>
                <th className="text-right font-semibold px-3 py-2">Total</th>
                <th className="text-right font-semibold px-3 py-2">Balance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((inv) => {
                const overdue = isOverdue(inv);
                const shownStatus: InvoiceStatus = overdue && inv.status !== 'void' && inv.status !== 'paid' ? 'overdue' : inv.status;
                const balance = Math.max(0, inv.total - inv.amountPaid);
                const busy = busyId === inv.invoiceId;
                return (
                  <tr key={inv.invoiceId} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button className="font-medium hover:underline" onClick={() => onEdit(inv)}>{inv.invoiceNumber}</button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{clientName(inv.clientId)}</td>
                    <td className="px-3 py-2"><Badge className={cn('text-[10px] capitalize', STATUS_TONE[shownStatus])}>{shownStatus}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground">{format(inv.issuedAt, 'PP')}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.dueAt ? format(inv.dueAt, 'PP') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(inv.total, inv.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{balance > 0 ? fmt(balance, inv.currency) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2" title="Download PDF" onClick={() => pdf(inv)} disabled={busy}>
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                        {inv.status !== 'paid' && inv.status !== 'void' && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" title="Email to client" onClick={() => run(inv.invoiceId, () => sendInvoice(orgId, inv.invoiceId), `Emailed ${inv.invoiceNumber}`)} disabled={busy}>
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {inv.status === 'paid' ? (
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" title="Revert to sent" onClick={() => run(inv.invoiceId, () => unmarkInvoicePaid(orgId, inv.invoiceId), `Unmarked ${inv.invoiceNumber}`)} disabled={busy}>
                            <RotateCcw className="w-3.5 h-3.5" /> Unmark paid
                          </Button>
                        ) : inv.status !== 'void' && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => run(inv.invoiceId, () => updateInvoice(orgId, inv.invoiceId, { status: 'paid', amountPaid: inv.total }), `Marked ${inv.invoiceNumber} paid`)} disabled={busy}>
                            Mark paid
                          </Button>
                        )}
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(inv)} disabled={busy}>Edit</Button>
                        <button className="text-muted-foreground hover:text-destructive p-1" title="Delete" onClick={() => { if (confirm(`Delete ${inv.invoiceNumber}? This cannot be undone.`)) void run(inv.invoiceId, () => deleteInvoice(orgId, inv.invoiceId)); }} disabled={busy}>
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
