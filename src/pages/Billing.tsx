import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Plus, Loader2, FileDown, Send, Trash2, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { KpiTile } from '@/components/dashboards/KpiTile';
import { InvoiceEditor } from '@/components/billing/InvoiceEditor';
import {
  Invoice, InvoiceStatus, listOrgInvoices, invoiceTotals, isOverdue,
  updateInvoice, deleteInvoice, sendInvoice,
} from '@/services/supabase/invoices';
import { getOrganizationClients, type Client } from '@/services/supabase/clients';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { downloadInvoicePdf } from '@/components/billing/invoicePdf';
import { listOrgSchedules, deleteSchedule, updateSchedule, type InvoiceSchedule } from '@/services/supabase/invoiceSchedules';
import { RecurringScheduleDialog } from '@/components/billing/RecurringScheduleDialog';
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

export const Billing: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const fmt = useFormatMoney();
  const orgId = organization?.organizationId ?? '';

  const [tab, setTab] = useState<'invoices' | 'recurring'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [schedules, setSchedules] = useState<InvoiceSchedule[]>([]);
  const [openSchedule, setOpenSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<InvoiceSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [openEditor, setOpenEditor] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const clientName = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c) => m.set(c.clientId, c.name));
    return (id: string) => m.get(id) ?? '—';
  }, [clients]);

  const load = async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [inv, cls] = await Promise.all([
        listOrgInvoices(orgId),
        getOrganizationClients(orgId),
      ]);
      setInvoices(inv);
      setClients(cls);
      const sched = await listOrgSchedules(orgId);
      setSchedules(sched);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [orgId]);

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

  const markPaid = async (inv: Invoice) => {
    setBusyId(inv.invoiceId);
    try {
      await updateInvoice(orgId, inv.invoiceId, { status: 'paid', amountPaid: inv.total });
      toast.success(`Marked ${inv.invoiceNumber} paid`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusyId(null); }
  };

  const send = async (inv: Invoice) => {
    setBusyId(inv.invoiceId);
    try {
      await sendInvoice(orgId, inv.invoiceId);
      toast.success(`Emailed ${inv.invoiceNumber} to the client`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Send failed'); }
    finally { setBusyId(null); }
  };

  const remove = async (inv: Invoice) => {
    if (!confirm(`Delete ${inv.invoiceNumber}? This cannot be undone.`)) return;
    setBusyId(inv.invoiceId);
    try { await deleteInvoice(orgId, inv.invoiceId); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setBusyId(null); }
  };

  const pdf = async (inv: Invoice) => {
    try {
      await downloadInvoicePdf(inv, { name: organization?.name ?? 'Company' }, clientName(inv.clientId));
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not build PDF'); }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" /> Billing
          </h1>
          <p className="text-sm text-muted-foreground">All invoices across your accounts.</p>
        </div>
        {tab === 'invoices' && (
          <Button onClick={() => { setEditing(null); setOpenEditor(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New invoice
          </Button>
        )}
        {tab === 'recurring' && (
          <Button onClick={() => { setEditingSchedule(null); setOpenSchedule(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New recurring invoice
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b">
        {(['invoices', 'recurring'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t === 'invoices' ? 'Invoices' : 'Recurring'}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label="Outstanding" value={fmt(totals.outstanding)} accent />
            <KpiTile label="Overdue" value={fmt(totals.overdue)} />
            <KpiTile label="Paid (30d)" value={fmt(totals.paidLast30)} />
            <KpiTile label="Drafts" value={totals.counts.draft.toLocaleString()} />
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
              No invoices match. Create one with "New invoice".
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
                    return (
                      <tr key={inv.invoiceId} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <button className="font-medium hover:underline" onClick={() => { setEditing(inv); setOpenEditor(true); }}>
                            {inv.invoiceNumber}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{clientName(inv.clientId)}</td>
                        <td className="px-3 py-2">
                          <Badge className={cn('text-[10px] capitalize', STATUS_TONE[shownStatus])}>{shownStatus}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{format(inv.issuedAt, 'PP')}</td>
                        <td className="px-3 py-2 text-muted-foreground">{inv.dueAt ? format(inv.dueAt, 'PP') : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(inv.total, inv.currency)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{balance > 0 ? fmt(balance, inv.currency) : '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2" title="Download PDF" onClick={() => pdf(inv)} disabled={busyId === inv.invoiceId}>
                              <FileDown className="w-3.5 h-3.5" />
                            </Button>
                            {inv.status !== 'paid' && inv.status !== 'void' && (
                              <Button size="sm" variant="ghost" className="h-7 px-2" title="Email to client" onClick={() => send(inv)} disabled={busyId === inv.invoiceId}>
                                <Send className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {inv.status !== 'paid' && inv.status !== 'void' && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markPaid(inv)} disabled={busyId === inv.invoiceId}>
                                Mark paid
                              </Button>
                            )}
                            <button className="text-muted-foreground hover:text-destructive p-1" title="Delete" onClick={() => remove(inv)} disabled={busyId === inv.invoiceId}>
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
      )}

      {tab === 'recurring' && (
        <>
          {loading ? (
            <div className="py-10 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading schedules…
            </div>
          ) : schedules.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No recurring schedules yet. Create one with "New recurring invoice".
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Account</th>
                    <th className="text-left font-semibold px-3 py-2">Title</th>
                    <th className="text-left font-semibold px-3 py-2">Frequency</th>
                    <th className="text-left font-semibold px-3 py-2">Next run</th>
                    <th className="text-left font-semibold px-3 py-2">Enabled</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {schedules.map((s) => (
                    <tr key={s.scheduleId} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{clientName(s.clientId)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{s.title ?? '—'}</td>
                      <td className="px-3 py-2 capitalize">{s.frequency}</td>
                      <td className="px-3 py-2 text-muted-foreground">{format(s.nextRunDate, 'PP')}</td>
                      <td className="px-3 py-2">
                        <button
                          className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', s.enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border')}
                          onClick={async () => {
                            try {
                              await updateSchedule(orgId, s.scheduleId, { enabled: !s.enabled });
                              await load();
                            } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed'); }
                          }}
                        >
                          {s.enabled ? 'Active' : 'Paused'}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSchedule(s); setOpenSchedule(true); }}>
                            Edit
                          </Button>
                          <button
                            className="text-muted-foreground hover:text-destructive p-1"
                            title="Delete"
                            onClick={async () => {
                              if (!confirm('Delete this recurring schedule? This cannot be undone.')) return;
                              try {
                                await deleteSchedule(orgId, s.scheduleId);
                                await load();
                              } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <InvoiceEditor
        open={openEditor}
        onOpenChange={(o) => { setOpenEditor(o); if (!o) setEditing(null); }}
        organizationId={orgId}
        clients={clients}
        existing={editing}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
      <RecurringScheduleDialog
        open={openSchedule}
        onOpenChange={(o) => { setOpenSchedule(o); if (!o) setEditingSchedule(null); }}
        organizationId={orgId}
        clients={clients}
        existing={editingSchedule}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
    </div>
  );
};

export default Billing;
