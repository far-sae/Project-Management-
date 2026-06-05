import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Client } from '@/services/supabase/clients';
import {
  Invoice, InvoiceStatus,
  deleteInvoice, listClientInvoices, updateInvoice,
} from '@/services/supabase/invoices';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InvoiceEditor } from '@/components/billing/InvoiceEditor';

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft:    'bg-muted text-muted-foreground border-border',
  sent:     'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  paid:     'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  overdue:  'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  void:     'bg-muted text-muted-foreground border-border line-through',
};

const fmtMoney = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
  } catch { return `${c} ${n.toFixed(2)}`; }
};

interface Props {
  organizationId: string;
  client: Client;
  canManage: boolean;
}

export const InvoicesPanel: React.FC<Props> = ({ organizationId, client, canManage }) => {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEditor, setOpenEditor] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setInvoices(await listClientInvoices(organizationId, client.clientId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [organizationId, client.clientId]);

  const totals = useMemo(() => {
    let billed = 0, paid = 0, outstanding = 0;
    for (const i of invoices) {
      if (i.status === 'void') continue;
      billed += i.total;
      paid += i.amountPaid;
      if (i.status !== 'paid') outstanding += Math.max(0, i.total - i.amountPaid);
    }
    return { billed, paid, outstanding };
  }, [invoices]);

  const handleMarkPaid = async (inv: Invoice) => {
    try {
      await updateInvoice(organizationId, inv.invoiceId, {
        status: 'paid',
        amountPaid: inv.total,
      });
      toast.success(`Marked ${inv.invoiceNumber} as paid`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleDelete = async (inv: Invoice) => {
    if (!confirm(`Delete invoice ${inv.invoiceNumber}? This cannot be undone.`)) return;
    try {
      await deleteInvoice(organizationId, inv.invoiceId);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Invoices ({invoices.length})
        </h3>
        {canManage && (
          <Button
            size="sm" variant="outline"
            onClick={() => { setEditing(null); setOpenEditor(true); }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> New invoice
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Billed" value={fmtMoney(totals.billed, invoices[0]?.currency ?? 'USD')} />
        <Stat label="Paid" value={fmtMoney(totals.paid, invoices[0]?.currency ?? 'USD')} tone="emerald" />
        <Stat label="Outstanding" value={fmtMoney(totals.outstanding, invoices[0]?.currency ?? 'USD')} tone={totals.outstanding > 0 ? 'amber' : 'muted'} />
      </div>

      {loading ? (
        <div className="py-6 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No invoices yet. Create one to track money owed for this account.
        </p>
      ) : (
        <div className="rounded-md border divide-y">
          {invoices.map((inv) => (
            <div key={inv.invoiceId} className="p-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => { setEditing(inv); setOpenEditor(true); }}
                  className="text-sm font-medium hover:underline"
                >
                  {inv.invoiceNumber}
                </button>
                <Badge className={cn('text-[10px] capitalize', STATUS_TONE[inv.status])}>
                  {inv.status}
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span>Issued {format(inv.issuedAt, 'PP')}</span>
                {inv.dueAt && <span>· Due {format(inv.dueAt, 'PP')}</span>}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-sm tabular-nums">
                  {fmtMoney(inv.total, inv.currency)}
                  {inv.amountPaid > 0 && inv.amountPaid < inv.total && (
                    <span className="text-muted-foreground"> ({fmtMoney(inv.amountPaid, inv.currency)} paid)</span>
                  )}
                </span>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {inv.status !== 'paid' && inv.status !== 'void' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleMarkPaid(inv)}>
                        Mark paid
                      </Button>
                    )}
                    <button
                      type="button" onClick={() => handleDelete(inv)}
                      className="text-muted-foreground hover:text-destructive p-1"
                      title="Delete invoice"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <InvoiceEditor
        open={openEditor}
        onOpenChange={(o) => { setOpenEditor(o); if (!o) setEditing(null); }}
        organizationId={organizationId}
        client={client}
        existing={editing}
        userId={user?.userId ?? null}
        userName={user?.displayName ?? null}
        onSaved={load}
      />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'emerald' | 'amber' | 'muted' }> = ({ label, value, tone }) => (
  <div className="rounded-md border p-2">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={cn(
      'text-sm font-semibold tabular-nums',
      tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400',
      tone === 'amber' && 'text-amber-600 dark:text-amber-400',
    )}>
      {value}
    </p>
  </div>
);

