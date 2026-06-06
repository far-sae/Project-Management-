import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, FileText, Trash2 } from 'lucide-react';
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
import type { Client } from '@/services/supabase/clients';
import type { QuoteLineItem } from '@/services/supabase/quotes';
import { computeQuoteTotals } from '@/services/supabase/quotes';
import {
  Invoice, InvoiceStatus, createInvoice, updateInvoice,
} from '@/services/supabase/invoices';
import { toast } from 'sonner';

const fmtMoney = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(n);
  } catch { return `${c} ${n.toFixed(2)}`; }
};

interface EditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Fixed account (client drawer). Omit on the hub and pass `clients` instead. */
  client?: Client | null;
  /** Selectable accounts for the hub "New invoice" flow (ignored when editing
   *  or when a fixed `client` is given). */
  clients?: Pick<Client, 'clientId' | 'name' | 'workspaceId'>[];
  existing: Invoice | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
  projects?: { projectId: string; name: string; workspaceId: string }[];
  defaultProjectId?: string | null;
}

const blankLine = (): QuoteLineItem => ({ description: '', qty: 1, unitPrice: 0, lineTotal: 0 });

export const InvoiceEditor: React.FC<EditorProps> = ({
  open, onOpenChange, organizationId, client, clients, existing, userId, userName, onSaved,
  projects, defaultProjectId,
}) => {
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<QuoteLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due upon receipt.');
  const [status, setStatus] = useState<InvoiceStatus>('draft');
  const [amountPaid, setAmountPaid] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pickedClientId, setPickedClientId] = useState('');
  const [projectId, setProjectId] = useState<string>('');

  // The account this invoice belongs to: the fixed prop, the existing
  // invoice's client, or the hub-picked one.
  const effectiveClientId =
    client?.clientId ?? existing?.clientId ?? pickedClientId;
  const effectiveWorkspaceId =
    client?.workspaceId ??
    clients?.find((c) => c.clientId === pickedClientId)?.workspaceId ??
    null;

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title ?? '');
      setCurrency(existing.currency);
      setLines(existing.lineItems.length > 0 ? existing.lineItems : [blankLine()]);
      setTaxRate(existing.taxRate);
      setDiscount(existing.discount);
      setIssuedAt(existing.issuedAt.toISOString().slice(0, 10));
      setDueAt(existing.dueAt ? existing.dueAt.toISOString().slice(0, 10) : '');
      setNotes(existing.notes ?? '');
      setTerms(existing.terms ?? '');
      setStatus(existing.status);
      setAmountPaid(existing.amountPaid);
      setProjectId(existing.projectId ?? '');
    } else {
      setTitle('');
      setCurrency('USD');
      setLines([blankLine()]);
      setTaxRate(0);
      setDiscount(0);
      setIssuedAt(new Date().toISOString().slice(0, 10));
      setDueAt('');
      setNotes('');
      setTerms('Payment due upon receipt.');
      setStatus('draft');
      setAmountPaid(0);
      setPickedClientId('');
      setProjectId(defaultProjectId ?? '');
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
    if (!existing && !effectiveClientId) { toast.error('Pick an account for this invoice'); return; }
    setBusy(true);
    try {
      if (existing) {
        await updateInvoice(organizationId, existing.invoiceId, {
          title, currency, lineItems: valid, taxRate, discount, notes, terms,
          dueAt: dueAt ? new Date(dueAt) : null, status, amountPaid,
          projectId: projectId || null,
        });
      } else {
        await createInvoice(organizationId, userId, userName, {
          clientId: effectiveClientId,
          workspaceId: effectiveWorkspaceId,
          projectId: projectId || null,
          title: title || null, currency, lineItems: valid, taxRate, discount,
          notes, terms, issuedAt: new Date(issuedAt),
          dueAt: dueAt ? new Date(dueAt) : null,
        });
      }
      toast.success(existing ? 'Invoice saved' : 'Invoice created');
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
            <FileText className="w-5 h-5 text-primary" />
            {existing ? `Edit ${existing.invoiceNumber}` : 'New invoice'}
          </DialogTitle>
          <DialogDescription>
            {client ? <>For account <strong>{client.name}</strong>. </> : null}
            Totals recompute from the line items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {!existing && !client && clients && (
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
          {projects && projects.length > 0 && (
            <div>
              <Label className="text-xs">Project (optional)</Label>
              <Select
                value={projectId || '__none__'}
                onValueChange={(v) => setProjectId(v === '__none__' ? '' : v)}
                disabled={busy}
              >
                <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {(effectiveWorkspaceId
                    ? projects.filter((p) => p.workspaceId === effectiveWorkspaceId)
                    : projects
                  ).map((p) => (
                    <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-[1fr_100px_140px_140px] gap-2">
            <div>
              <Label className="text-xs">Title (optional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 4))} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Issued</Label>
              <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} disabled={busy || !!existing} />
            </div>
            <div>
              <Label className="text-xs">Due</Label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} disabled={busy} />
            </div>
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

          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Discount</Label>
              <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Tax %</Label>
              <Input type="number" min={0} step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} disabled={busy} />
            </div>
            {existing && (
              <>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)} disabled={busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="void">Void</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Paid</Label>
                  <Input type="number" min={0} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} disabled={busy} />
                </div>
              </>
            )}
          </div>

          <div className="rounded-md border p-2 text-xs space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(totals.subtotal, currency)}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{fmtMoney(discount, currency)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmtMoney(totals.taxAmount, currency)}</span></div>}
            <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total</span><span>{fmtMoney(totals.total, currency)}</span></div>
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
            {existing ? 'Save changes' : 'Create invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
