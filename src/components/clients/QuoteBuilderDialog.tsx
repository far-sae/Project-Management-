import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, FileText, Printer } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { Deal } from '@/services/supabase/deals';
import type { Client } from '@/services/supabase/clients';
import {
  Quote, QuoteLineItem,
  computeQuoteTotals, createQuote, updateQuote,
} from '@/services/supabase/quotes';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  deal: Deal;
  client?: Client | null;
  /** Pre-existing quote to edit; null = create. */
  existing?: Quote | null;
  onSaved?: (q: Quote) => void;
}

const blankLine = (): QuoteLineItem => ({
  description: '',
  qty: 1,
  unitPrice: 0,
  lineTotal: 0,
});

const recomputeLine = (li: QuoteLineItem): QuoteLineItem => ({
  ...li,
  lineTotal: +(Math.max(0, li.qty || 0) * Math.max(0, li.unitPrice || 0)).toFixed(2),
});

const fmtMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

export const QuoteBuilderDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, deal, client, existing, onSaved,
}) => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lines, setLines] = useState<QuoteLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due within 30 days of acceptance.');
  const [expiresAt, setExpiresAt] = useState('');
  const [status, setStatus] = useState<Quote['status']>('draft');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title);
      setCurrency(existing.currency);
      setLines(existing.lineItems.length > 0 ? existing.lineItems : [blankLine()]);
      setTaxRate(existing.taxRate);
      setDiscount(existing.discount);
      setNotes(existing.notes ?? '');
      setTerms(existing.terms ?? '');
      setExpiresAt(existing.expiresAt ? existing.expiresAt.toISOString().slice(0, 10) : '');
      setStatus(existing.status);
    } else {
      setTitle(`Proposal for ${deal.title}`);
      setCurrency(deal.currency ?? 'USD');
      setLines([blankLine()]);
      setTaxRate(0);
      setDiscount(0);
      setNotes('');
      setTerms('Payment due within 30 days of acceptance.');
      setExpiresAt('');
      setStatus('draft');
    }
  }, [open, existing, deal]);

  const totals = useMemo(
    () => computeQuoteTotals(lines, taxRate, discount),
    [lines, taxRate, discount],
  );

  const updateLine = (i: number, patch: Partial<QuoteLineItem>) => {
    setLines((prev) =>
      prev.map((li, idx) => (idx === i ? recomputeLine({ ...li, ...patch }) : li)),
    );
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Add a title');
      return;
    }
    const validLines = lines.filter((l) => l.description.trim() && l.qty > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one line item');
      return;
    }
    setBusy(true);
    try {
      let saved: Quote;
      if (existing) {
        saved = await updateQuote(organizationId, existing.quoteId, {
          title, currency, lineItems: validLines, taxRate, discount,
          notes, terms, expiresAt: expiresAt ? new Date(expiresAt) : null, status,
        });
      } else {
        saved = await createQuote(
          organizationId,
          user?.userId ?? null,
          user?.displayName ?? null,
          {
            dealId: deal.dealId,
            clientId: deal.clientId ?? client?.clientId ?? null,
            workspaceId: client?.workspaceId ?? null,
            title,
            status,
            currency,
            taxRate,
            discount,
            lineItems: validLines,
            notes,
            terms,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        );
      }
      toast.success(`Quote ${saved.quoteNumber} saved`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save quote');
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    // Open a minimal printable view in a new window so the user can save
    // it as PDF via the browser's print dialog. Cheap, dependency-free.
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Pop-ups blocked — allow them to print this quote.');
      return;
    }
    const linesHtml = lines.filter((l) => l.description).map((l) => `
      <tr>
        <td>${l.description}</td>
        <td style="text-align:right">${l.qty}</td>
        <td style="text-align:right">${fmtMoney(l.unitPrice, currency)}</td>
        <td style="text-align:right">${fmtMoney(l.lineTotal, currency)}</td>
      </tr>`).join('');
    w.document.write(`
<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,Segoe UI,sans-serif;color:#111;max-width:780px;margin:40px auto;padding:0 24px}
  h1{font-size:20px;margin:0 0 4px 0}
  .meta{color:#666;font-size:12px;margin-bottom:24px}
  .client{margin:12px 0 24px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
  th{background:#f7f7f7;font-size:11px;text-transform:uppercase;color:#666}
  .totals{margin-top:16px;float:right;width:280px}
  .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .totals .grand{border-top:2px solid #333;font-weight:bold;font-size:15px;margin-top:6px;padding-top:8px}
  .terms{margin-top:80px;font-size:11px;color:#444;white-space:pre-wrap;border-top:1px solid #eee;padding-top:8px}
</style></head><body>
  <h1>${title}</h1>
  <div class="meta">${existing?.quoteNumber ?? '(unsaved)'} · ${new Date().toLocaleDateString()}</div>
  <div class="client"><strong>${client?.name ?? deal.clientName ?? 'Client'}</strong></div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${linesHtml}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${fmtMoney(totals.subtotal, currency)}</span></div>
    ${discount > 0 ? `<div><span>Discount</span><span>−${fmtMoney(discount, currency)}</span></div>` : ''}
    ${taxRate > 0 ? `<div><span>Tax (${taxRate}%)</span><span>${fmtMoney(totals.taxAmount, currency)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${fmtMoney(totals.total, currency)}</span></div>
  </div>
  <div style="clear:both"></div>
  ${notes ? `<div class="terms"><strong>Notes</strong>\n${notes}</div>` : ''}
  ${terms ? `<div class="terms"><strong>Terms</strong>\n${terms}</div>` : ''}
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`);
    w.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {existing ? `Edit ${existing.quoteNumber}` : 'New quote'}
            <Badge variant="outline" className="ml-auto text-[10px]">
              {deal.title}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Build a quote with line items; totals recompute live. Print to save
            as PDF and send via email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px_120px] gap-2">
            <div>
              <Label className="text-xs">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Proposal for…"
                disabled={busy}
              />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 4))}
                disabled={busy}
              />
            </div>
            <div>
              <Label className="text-xs">Expires</Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Quote['status'])} disabled={busy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Line items</Label>
            <div className="rounded-md border divide-y">
              <div className="grid grid-cols-[1fr_60px_110px_110px_40px] gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/40">
                <span>Description</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit price</span>
                <span className="text-right">Total</span>
                <span />
              </div>
              {lines.map((li, i) => (
                <div key={i} className="grid grid-cols-[1fr_60px_110px_110px_40px] gap-2 p-1.5 items-center">
                  <Input
                    value={li.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Service or product"
                    disabled={busy}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={li.qty}
                    onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
                    className="text-right"
                    disabled={busy}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={li.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })}
                    className="text-right"
                    disabled={busy}
                  />
                  <div className="text-right text-sm tabular-nums px-1">
                    {fmtMoney(li.lineTotal, currency)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-destructive p-1"
                    disabled={busy || lines.length <= 1}
                    title="Remove line"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
              disabled={busy}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add line
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Discount</Label>
              <Input
                type="number" min={0} step="0.01"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                disabled={busy}
              />
            </div>
            <div>
              <Label className="text-xs">Tax rate (%)</Label>
              <Input
                type="number" min={0} step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value))}
                disabled={busy}
              />
            </div>
            <div className="rounded-md border p-2 text-xs space-y-0.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmtMoney(totals.subtotal, currency)}</span></div>
              {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{fmtMoney(discount, currency)}</span></div>}
              {taxRate > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmtMoney(totals.taxAmount, currency)}</span></div>}
              <div className="flex justify-between font-semibold border-t pt-1 mt-1"><span>Total</span><span>{fmtMoney(totals.total, currency)}</span></div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              disabled={busy}
            />
          </div>
          <div>
            <Label className="text-xs">Terms</Label>
            <Textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={2}
              maxLength={2000}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handlePrint} disabled={busy}>
            <Printer className="w-4 h-4 mr-2" /> Print / PDF
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {existing ? 'Save changes' : 'Create quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
