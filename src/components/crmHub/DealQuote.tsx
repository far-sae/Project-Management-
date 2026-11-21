import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  EMPTY_LINE, MAX_LINES, lineTotal, quoteNumber, quoteTotal, readLines, toDrafts, validUntil, type DealLine, type LineDraft,
} from '@/lib/crmQuote';
import { saveDealQuote } from '@/services/supabase/crmHub/deals';
import type { CrmDeal } from '@/types/crmHub';

/**
 * The quote of a deal: what is offered, line by line, and what it comes to.
 * It can be opened as a page to print or to save as a PDF and send.
 */

interface Props {
  deal: CrmDeal;
  /** An amount in the deal's own currency, as the page writes money. */
  format: (amount: number) => string;
  /** Who the quote is from and for, as printed on it. */
  from: string;
  customer: string;
  onSaved: () => void | Promise<void>;
}

const day = (date: Date): string => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export const DealQuote: React.FC<Props> = ({ deal, format, from, customer, onSaved }) => {
  const [drafts, setDrafts] = useState<LineDraft[]>([]);
  const [setValue, setSetValue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState(false);

  // The saved lines, whenever the deal is loaded again.
  const saved = deal.lineItems;
  useEffect(() => { setDrafts(saved.length > 0 ? toDrafts(saved) : []); }, [saved]);

  const read = useMemo(() => readLines(drafts), [drafts]);
  const total = quoteTotal(read.lines);
  const changed = JSON.stringify(read.lines) !== JSON.stringify(saved);

  const edit = (index: number, patch: Partial<LineDraft>) => setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    if (read.problem) return;
    setBusy(true);
    try {
      await saveDealQuote(deal.id, read.lines, setValue && read.lines.length > 0 ? total : undefined);
      toast.success(read.lines.length === 0 ? 'Quote cleared' : setValue ? 'Quote saved, and the deal value set to its total' : 'Quote saved');
      await onSaved();
    } catch (err) {
      toast.error(publicMessage(err, 'The quote could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const today = new Date();

  return (
    <section className="rounded-lg border border-border bg-card" aria-label="Quote">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Quote</h2>
        <div className="flex items-center gap-2">
          {saved.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowing(true)}>
              <Printer aria-hidden />Open to print
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setDrafts((rows) => [...rows, EMPTY_LINE])} disabled={busy || drafts.length >= MAX_LINES}>
            <Plus aria-hidden />Add line
          </Button>
        </div>
      </header>

      {drafts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No quote yet. Add the things you are offering, with a quantity and a price, and print it or save it as a PDF to send.
        </p>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-1.5 font-medium">What</th>
                  <th scope="col" className="w-24 pb-1.5 pl-2 font-medium">Quantity</th>
                  <th scope="col" className="w-32 pb-1.5 pl-2 font-medium">Price each</th>
                  <th scope="col" className="w-32 pb-1.5 pl-2 text-right font-medium">Total</th>
                  <th scope="col" className="w-9 pb-1.5"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((row, index) => {
                  const one = readLines([row]);
                  return (
                    <tr key={index}>
                      <td className="py-1">
                        <Input value={row.description} onChange={(e) => edit(index, { description: e.target.value })} disabled={busy} aria-label={`Line ${index + 1}: what`} placeholder="For example: Website design" />
                      </td>
                      <td className="py-1 pl-2">
                        <Input value={row.quantity} onChange={(e) => edit(index, { quantity: e.target.value })} disabled={busy} inputMode="decimal" aria-label={`Line ${index + 1}: quantity`} />
                      </td>
                      <td className="py-1 pl-2">
                        <Input value={row.unitPrice} onChange={(e) => edit(index, { unitPrice: e.target.value })} disabled={busy} inputMode="decimal" aria-label={`Line ${index + 1}: price each`} />
                      </td>
                      <td className="py-1 pl-2 text-right tabular-nums">{one.lines[0] ? format(lineTotal(one.lines[0])) : '—'}</td>
                      <td className="py-1 pl-1">
                        <Button size="sm" variant="ghost" className="w-8 px-0 text-muted-foreground" onClick={() => setDrafts((rows) => rows.filter((_, i) => i !== index))} disabled={busy} aria-label={`Remove line ${index + 1}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <th scope="row" colSpan={3} className="pt-2 text-right text-sm font-medium">Total</th>
                  <td className="pt-2 pl-2 text-right text-sm font-semibold tabular-nums">{format(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {read.problem && <p role="alert" className="text-sm text-destructive">{read.problem}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={setValue} onChange={(e) => setSetValue(e.target.checked)} disabled={busy} />
              Set the deal value to this total
            </label>
            <Button onClick={() => void save()} disabled={busy || !!read.problem || !changed}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Save quote
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showing} onOpenChange={setShowing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="quote-screen-only">
            <DialogTitle>Quote {quoteNumber(deal.id)}</DialogTitle>
            <DialogDescription>Print it, or choose “Save as PDF” in the print window to send it by email.</DialogDescription>
          </DialogHeader>

          {/* Only this part is printed. */}
          <style>{'@media print { body * { visibility: hidden !important; } .quote-print, .quote-print * { visibility: visible !important; } .quote-print { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 24px; } .quote-screen-only { display: none !important; } }'}</style>
          <div className="quote-print flex flex-col gap-6 rounded-lg border border-border bg-background p-6 text-foreground">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{from}</p>
                <p className="text-sm text-muted-foreground">Quote {quoteNumber(deal.id)}</p>
              </div>
              <div className="text-right text-sm">
                <p>{day(today)}</p>
                <p className="text-muted-foreground">Valid until {day(validUntil(today))}</p>
              </div>
            </div>
            <div className="text-sm">
              <p className="text-muted-foreground">For</p>
              <p className="font-medium">{customer}</p>
              <p className="text-muted-foreground">{deal.name}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 font-medium">What</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Quantity</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Price each</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {saved.map((line: DealLine, index: number) => (
                  <tr key={index} className="border-b border-border/60">
                    <td className="py-1.5 pr-2">{line.description}</td>
                    <td className="py-1.5 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">{format(line.unitPrice)}</td>
                    <td className="py-1.5 text-right tabular-nums">{format(lineTotal(line))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3} className="pt-2 text-right font-medium">Total</th>
                  <td className="pt-2 text-right font-semibold tabular-nums">{format(quoteTotal(saved))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <DialogFooter className="quote-screen-only">
            <Button variant="outline" onClick={() => setShowing(false)}>Close</Button>
            <Button onClick={() => window.print()}><Printer aria-hidden />Print or save as PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
