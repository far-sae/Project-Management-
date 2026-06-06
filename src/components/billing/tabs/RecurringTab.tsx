import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Trash2, Repeat, Activity, TrendingUp, CalendarClock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiTile } from '@/components/dashboards/KpiTile';
import { computeQuoteTotals } from '@/services/supabase/quotes';
import {
  InvoiceSchedule, ScheduleFrequency, deleteSchedule, updateSchedule,
} from '@/services/supabase/invoiceSchedules';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Per-cycle total of a schedule (same math the worker uses to issue it).
const cycleAmount = (s: InvoiceSchedule): number =>
  computeQuoteTotals(s.lineItems, s.taxRate, s.discount).total;

// Normalize a per-cycle amount to a monthly figure (for "monthly recurring").
const MONTHLY_FACTOR: Record<ScheduleFrequency, number> = {
  weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12,
};

interface Props {
  schedules: InvoiceSchedule[];
  loading: boolean;
  orgId: string;
  clientName: (id: string) => string;
  fmt: (n: number, c?: string) => string;
  onEdit: (s: InvoiceSchedule) => void;
  onNew: () => void;
  onChanged: () => Promise<void> | void;
}

export const RecurringTab: React.FC<Props> = ({ schedules, loading, orgId, clientName, fmt, onEdit, onNew, onChanged }) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const active = schedules.filter((s) => s.enabled);
    const monthly = active.reduce((sum, s) => sum + cycleAmount(s) * MONTHLY_FACTOR[s.frequency], 0);
    const nextRun = active
      .map((s) => s.nextRunDate)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { activeCount: active.length, monthly, nextRun };
  }, [schedules]);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try { await fn(); await onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground flex items-start gap-2">
        <Repeat className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Recurring invoices</span> bill a client automatically on a set
          schedule. TaskCalendar issues and emails the next invoice on each run date — set it once and get paid every period.
        </span>
      </div>

      {schedules.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiTile label="Active schedules" value={stats.activeCount.toLocaleString()} accent icon={Activity} />
          <KpiTile label="Monthly recurring" value={fmt(stats.monthly, undefined)} icon={TrendingUp} />
          <KpiTile label="Next run" value={stats.nextRun ? format(stats.nextRun, 'PP') : '—'} icon={CalendarClock} />
        </div>
      )}

      {loading ? (
        <div className="py-10 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading schedules…
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Repeat className="w-8 h-8 mx-auto text-muted-foreground/60" />
          <h3 className="mt-3 font-medium">No recurring invoices yet</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Put your regular clients on autopilot — pick a client, set the line items and a cadence, and an invoice goes
            out every period without you lifting a finger.
          </p>
          <Button className="mt-4" onClick={onNew}><Plus className="w-4 h-4 mr-1.5" /> New recurring invoice</Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Account</th>
                <th className="text-left font-semibold px-3 py-2">Title</th>
                <th className="text-right font-semibold px-3 py-2">Amount / cycle</th>
                <th className="text-left font-semibold px-3 py-2">Frequency</th>
                <th className="text-left font-semibold px-3 py-2">Next run</th>
                <th className="text-left font-semibold px-3 py-2">Last generated</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {schedules.map((s) => {
                const busy = busyId === s.scheduleId;
                return (
                  <tr key={s.scheduleId} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{clientName(s.clientId)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.title ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(cycleAmount(s), s.currency)}</td>
                    <td className="px-3 py-2 capitalize">{s.frequency}</td>
                    <td className="px-3 py-2 text-muted-foreground">{format(s.nextRunDate, 'PP')}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.lastRunAt ? format(s.lastRunAt, 'PP') : '—'}</td>
                    <td className="px-3 py-2">
                      <button
                        className={cn('text-xs px-2 py-0.5 rounded-full border font-medium',
                          s.enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border')}
                        disabled={busy}
                        onClick={() => run(s.scheduleId, () => updateSchedule(orgId, s.scheduleId, { enabled: !s.enabled }))}
                      >
                        {s.enabled ? 'Active' : 'Paused'}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(s)} disabled={busy}>Edit</Button>
                        <button className="text-muted-foreground hover:text-destructive p-1" title="Delete"
                          onClick={() => { if (confirm('Delete this recurring schedule? This cannot be undone.')) void run(s.scheduleId, () => deleteSchedule(orgId, s.scheduleId)); }}
                          disabled={busy}>
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
