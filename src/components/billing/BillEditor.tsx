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
import type { QuoteLineItem } from '@/services/supabase/quotes';
import { computeQuoteTotals } from '@/services/supabase/quotes';
import {
  Bill, BillStatus, createBill, updateBill,
} from '@/services/supabase/bills';
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
  existing: Bill | null;
  userId: string | null;
  userName: string | null;
  onSaved: () => Promise<void> | void;
  workspaces?: { workspaceId: string; name: string }[];
  defaultWorkspaceId?: string | null;
  projects?: { projectId: string; name: string; workspaceId: string }[];
  defaultProjectId?: string | null;
}

const blankLine = (): QuoteLineItem => ({ description: '', qty: 1, unitPrice: 0, lineTotal: 0 });

export const BillEditor: React.FC<Props> = ({
  open, onOpenChange, organizationId, existing, userId, userName, onSaved,
  workspaces, defaultWorkspaceId, projects, defaultProjectId,
}) => {
  const [vendorName, setVendorName] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [reference, setReference] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<QuoteLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<BillStatus>('draft');
  const [amountPaid, setAmountPaid] = useState(0);
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setVendorName(existing.vendorName ?? '');
      setVendorEmail(existing.vendorEmail ?? '');
      setReference(existing.reference ?? '');
      setCurrency(existing.currency);
      setLines(existing.lineItems.length > 0 ? existing.lineItems : [blankLine()]);
      setTaxRate(existing.taxRate);
      setDiscount(existing.discount);
      setIssuedAt(existing.issuedAt.toISOString().slice(0, 10));
      setDueAt(existing.dueAt ? existing.dueAt.toISOString().slice(0, 10) : '');
      setNotes(existing.notes ?? '');
      setStatus(existing.status);
      setAmountPaid(existing.amountPaid);
      setWorkspaceId(existing.workspaceId ?? '');
      setProjectId(existing.projectId ?? '');
    } else {
      setVendorName('');
      setVendorEmail('');
      setReference('');
      setCurrency('USD');
      setLines([blankLine()]);
      setTaxRate(0);
      setDiscount(0);
      setIssuedAt(new Date().toISOString().slice(0, 10));
      setDueAt('');
      setNotes('');
      setStatus('draft');
      setAmountPaid(0);
      setWorkspaceId(defaultWorkspaceId ?? '');
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
    if (!vendorName.trim()) { toast.error('Vendor name is required'); return; }
    setBusy(true);
    try {
      if (existing) {
        await updateBill(organizationId, existing.billId, {
          vendorName: vendorName.trim(),
          vendorEmail: vendorEmail.trim() || null,
          reference: reference.trim() || null,
          currency, lineItems: valid, taxRate, discount, notes,
          dueAt: dueAt ? new Date(dueAt) : null, status, amountPaid,
          workspaceId: workspaceId || null,
          projectId: projectId || null,
        });
      } else {
        await createBill(organizationId, userId, userName, {
          vendorName: vendorName.trim(),
          vendorEmail: vendorEmail.trim() || null,
          reference: reference.trim() || null,
          currency, lineItems: valid, taxRate, discount,
          notes, issuedAt: new Date(issuedAt),
          dueAt: dueAt ? new Date(dueAt) : null,
          workspaceId: workspaceId || null,
          projectId: projectId || null,
        });
      }
      toast.success(existing ? 'Bill saved' : 'Bill created');
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
            {existing ? `Edit ${existing.billNumber}` : 'New bill'}
          </DialogTitle>
          <DialogDescription>
            Totals recompute from the line items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Vendor name *</Label>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Supplier / contractor" disabled={busy} />
            </div>
            <div>
              <Label className="text-xs">Vendor email (optional)</Label>
              <Input type="email" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)} placeholder="vendor@example.com" disabled={busy} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Reference (vendor's invoice number, optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. INV-2026-001" disabled={busy} />
          </div>

          {workspaces && workspaces.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Workspace (optional)</Label>
                <Select
                  value={workspaceId || '__none__'}
                  onValueChange={(v) => {
                    const next = v === '__none__' ? '' : v;
                    setWorkspaceId(next);
                    setProjectId('');
                  }}
                  disabled={busy}
                >
                  <SelectTrigger><SelectValue placeholder="No workspace" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {workspaces.map((w) => (
                      <SelectItem key={w.workspaceId} value={w.workspaceId}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                    {(projects ?? [])
                      .filter((p) => !workspaceId || p.workspaceId === workspaceId)
                      .map((p) => (
                        <SelectItem key={p.projectId} value={p.projectId}>{p.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-[100px_1fr_1fr] gap-2">
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
                  <Select value={status} onValueChange={(v) => setStatus(v as BillStatus)} disabled={busy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {existing ? 'Save changes' : 'Create bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
