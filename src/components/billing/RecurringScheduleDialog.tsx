import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { QuoteLineItem } from '@/services/supabase/quotes';
import { computeQuoteTotals } from '@/services/supabase/quotes';
import {
  InvoiceSchedule, ScheduleFrequency,
  createSchedule, updateSchedule,
} from '@/services/supabase/invoiceSchedules';
import { toast } from 'sonner';

const fmtMoney = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
  } catch { return `${c} ${n.toFixed(2)}`; }
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  clients: { clientId: string; name: string; workspaceId: string }[];
  existing: InvoiceSchedule | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
}

const blankLine = (): QuoteLineItem => ({ description: '', qty: 1, unitPrice: 0, lineTotal: 0 });

export const RecurringScheduleDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, clients, existing, userId, userName, onSaved,
}) => {
  const [pickedClientId, setPickedClientId] = useState('');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('monthly');
  const [nextRunDate, setNextRunDate] = useState('');
  const [dueDays, setDueDays] = useState(14);
  const [currency, setCurrency] = useState('USD');
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<QuoteLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setPickedClientId(existing.clientId);
      setFrequency(existing.frequency);
      setNextRunDate(existing.nextRunDate.toISOString().slice(0, 10));
      setDueDays(existing.dueDays);
      setCurrency(existing.currency);
      setTitle(existing.title ?? '');
      setLines(existing.lineItems.length > 0 ? existing.lineItems : [blankLine()]);
      setTaxRate(existing.taxRate);
      setDiscount(existing.discount);
      setNotes(existing.notes ?? '');
      setTerms(existing.terms ?? '');
    } else {
      setPickedClientId('');
      setFrequency('monthly');
      setNextRunDate('');
      setDueDays(14);
      setCurrency('USD');
      setTitle('');
      setLines([blankLine()]);
      setTaxRate(0);
      setDiscount(0);
      setNotes('');
      setTerms('');
    }
  }, [open, existing]);

  const totals = useMemo(
    () => computeQuoteTotals(lines, taxRate, discount),
    [lines, taxRate, discount],
  );

  const updateLine = (i: number, patch: Partial<QuoteLineItem>) => {
    setLines((prev) => prev.map((li, idx) => {
      if (idx !== i) return li;
      const next = { ...li, ...patch };
      next.lineTotal = +(Math.max(0, next.qty || 0) * Math.max(0, next.unitPrice || 0)).toFixed(2);
      return next;
    }));
  };

  const handleSave = async () => {
    const valid = lines.filter((l) => l.description.trim() && l.qty > 0);
    if (valid.length === 0) { toast.error('Add at least one line item'); return; }
    if (!existing && !pickedClientId) { toast.error('Pick an account for this schedule'); return; }
    if (!nextRunDate) { toast.error('Set a next run date'); return; }
    setBusy(true);
    try {
      const clientId = existing?.clientId ?? pickedClientId;
      const ws = clients.find((c) => c.clientId === clientId)?.workspaceId ?? null;
      if (existing) {
        await updateSchedule(organizationId, existing.scheduleId, {
          title: title || null,
          currency,
          lineItems: valid,
          taxRate,
          discount,
          notes: notes || null,
          terms: terms || null,
          frequency,
          dueDays,
          nextRunDate: new Date(nextRunDate),
        });
      } else {
        await createSchedule(organizationId, userId, userName, {
          clientId,
          workspaceId: ws,
          title: title || null,
          currency,
          lineItems: valid,
          taxRate,
          discount,
          notes: notes || null,
          terms: terms || null,
          frequency,
          dueDays,
          nextRunDate: new Date(nextRunDate),
        });
      }
      toast.success(existing ? 'Schedule updated' : 'Recurring schedule created');
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            {existing ? 'Edit recurring schedule' : 'New recurring invoice'}
          </DialogTitle>
          <DialogDescription>
            The worker auto-issues an invoice on each run date and advances the schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {!existing && (
            <div>
              <Label className="text-xs">Account</Label>
              <Select value={pickedClientId} onValueChange={setPickedClientId} disabled={busy}>
                <SelectTrigger><SelectValue placeholder="Select an account…" /></SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.clientId} value={c.clientId}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-[1fr_100px_120px_80px] gap-2">
            <div>
              <Label className="text-xs">Title (optional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 4))} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Next run date</Label>
              <Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Due days</Label>
              <Input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))} disabled={busy} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleFrequency)} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Line items</Label>
            <div className="rounded-md border divide-y">
              <div className="grid grid-cols-[1fr_60px_100px_100px_30px] gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground bg-muted/40">
                <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit</span><span className="text-right">Total</span><span />
              </div>
              {lines.map((li, i) => (
                <div key={i} className="grid grid-cols-[1fr_60px_100px_100px_30px] gap-2 p-1.5 items-center">
                  <Input value={li.description} onChange={(e) => updateLine(i, { description: e.target.value })} placeholder="Service or product" disabled={busy} />
                  <Input type="number" min={0} value={li.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} className="text-right" disabled={busy} />
                  <Input type="number" min={0} step="0.01" value={li.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} className="text-right" disabled={busy} />
                  <div className="text-right text-sm tabular-nums px-1">{fmtMoney(li.lineTotal, currency)}</div>
                  <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive p-1" disabled={busy || lines.length <= 1}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setLines((p) => [...p, blankLine()])} disabled={busy}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add line
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Discount</Label>
              <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Tax %</Label>
              <Input type="number" min={0} step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} disabled={busy} />
            </div>
          </div>

          <div className="rounded-md border p-2 text-xs space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(totals.subtotal, currency)}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{fmtMoney(discount, currency)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmtMoney(totals.taxAmount, currency)}</span></div>}
            <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total per invoice</span><span>{fmtMoney(totals.total, currency)}</span></div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} disabled={busy} />
          </div>
          <div>
            <Label className="text-xs">Terms</Label>
            <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} maxLength={2000} disabled={busy} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {existing ? 'Save changes' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
