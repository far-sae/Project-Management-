// The window for income that has no invoice and no service: a cash sale, a
// refund, interest. It can be typed in, or read from a photo or PDF of the
// receipt: the server reads the amount, the date and who paid, and fills the
// boxes for the person to check. Nothing is saved until Save is pressed, and
// the receipt itself is not kept.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import type { IncomeEntry } from '@/lib/income';
import { publicMessage } from '@/lib/publicError';
import { shrinkImage } from '@/lib/shrinkImage';
import { createIncomeEntry, updateIncomeEntry, type IncomeInput } from '@/services/supabase/income';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** How money can have arrived. The same list as a payment on a client's service. */
export const INCOME_METHODS = ['Bank transfer', 'Card', 'Cash', 'Cheque', 'PayPal', 'Other'];

/** What the server reads off a receipt (api/_signroom/receiptReader.ts). An empty value was not found. */
interface ReceiptReading {
  found: boolean;
  amount: string;
  currency: string;
  receivedOn: string;
  payer: string;
  reference: string;
  method: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  workspaceId: string;
  /** The entry being changed. Null: a new one. */
  entry: IncomeEntry | null;
  onSaved: () => void | Promise<void>;
}

interface Form {
  title: string;
  payer: string;
  amount: string;
  currency: string;
  receivedOn: string;
  method: string;
  reference: string;
  notes: string;
}

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

type Reading = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'problem'; text: string };

export const IncomeEntryDialog: React.FC<Props> = ({ open, onOpenChange, organizationId, workspaceId, entry, onSaved }) => {
  const id = useId();
  const { client } = useSignroom();
  const companyCurrency = useOrgCurrency();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Reading>({ kind: 'idle' });
  const fileBox = useRef<HTMLInputElement>(null);

  // Each time the window opens it starts from the entry it was opened for, or from an empty one.
  useEffect(() => {
    if (!open) return;
    setReading({ kind: 'idle' });
    setForm(entry
      ? {
          title: entry.title, payer: entry.payer, amount: String(entry.amount), currency: entry.currency, receivedOn: entry.receivedOn,
          method: entry.method ?? '', reference: entry.reference ?? '', notes: entry.notes ?? '',
        }
      : { title: '', payer: '', amount: '', currency: companyCurrency, receivedOn: today(), method: '', reference: '', notes: '' });
    // Only when it opens, or opens for another entry: typing must not be thrown away by a re-render.
  }, [open, entry?.id]);

  const ready = Boolean(form && form.title.trim() && Number(form.amount) > 0 && form.receivedOn && /^[A-Z]{3}$/.test(form.currency));

  /** Reads a receipt and fills in what it shows. What was not found is left as it was typed. */
  const readReceipt = async (file: File | undefined) => {
    if (fileBox.current) fileBox.current.value = '';
    if (!file || !form) return;
    setReading({ kind: 'busy' });
    try {
      const found = await client.upload<ReceiptReading>('income/read-receipt', await shrinkImage(file));
      if (!found.found) {
        setReading({ kind: 'problem', text: 'No payment could be read from this file. Type it in below.' });
        return;
      }
      setForm((old) => (old ? {
        ...old,
        title: found.title || old.title,
        payer: found.payer || old.payer,
        amount: found.amount || old.amount,
        currency: found.currency || old.currency,
        receivedOn: found.receivedOn || old.receivedOn,
        method: found.method || old.method,
        reference: found.reference || old.reference,
      } : old));
      setReading({ kind: 'done', text: found.amount ? 'Filled in from the receipt. Check it before you save.' : 'Some of it was read from the receipt. Fill in the amount, and check the rest.' });
    } catch (error) {
      setReading({ kind: 'problem', text: publicMessage(error instanceof Error ? error : null, 'The receipt could not be read. You can type it in below.') });
    }
  };

  const save = async () => {
    if (!form || !ready) return;
    const input: IncomeInput = {
      title: form.title.trim(), payer: form.payer.trim(), amount: Math.round(Number(form.amount) * 100) / 100, currency: form.currency,
      receivedOn: form.receivedOn, method: form.method || null, reference: form.reference.trim() || null, notes: form.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (entry) await updateIncomeEntry(entry.id, input);
      else await createIncomeEntry({ organizationId, workspaceId, ...input });
      onOpenChange(false);
      toast.success(entry ? 'Income saved' : 'Income added');
      await onSaved();
    } catch (error) {
      toast.error(publicMessage(error, entry ? 'The income could not be saved. Please try again.' : 'The income could not be added. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Form>) => setForm((old) => (old ? { ...old, ...patch } : old));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onOpenChange(false); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit income' : 'Add income'}</DialogTitle>
          <DialogDescription>
            For money that has no invoice: a cash sale, a refund, interest. A payment on an invoice or on a client&apos;s service is counted by itself.
          </DialogDescription>
        </DialogHeader>
        {form && (
          <div className="space-y-3">
            <div className="rounded-md border border-dashed border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" disabled={reading.kind === 'busy' || busy} onClick={() => fileBox.current?.click()}>
                  {reading.kind === 'busy' ? <Loader2 className="animate-spin" aria-hidden /> : <ScanLine aria-hidden />}
                  {reading.kind === 'busy' ? 'Reading the receipt…' : 'Read it from a receipt'}
                </Button>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">A photo or a PDF. The amount, the date and who paid are filled in for you to check. The file is not kept.</p>
              </div>
              <input
                ref={fileBox} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1}
                aria-label="Receipt (photo or PDF)" onChange={(e) => void readReceipt(e.target.files?.[0])}
              />
              {(reading.kind === 'done' || reading.kind === 'problem') && (
                <p role="status" className={`mt-2 text-sm ${reading.kind === 'problem' ? 'text-destructive' : 'text-success'}`}>{reading.text}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-title`}>What for</Label>
              <Input id={`${id}-title`} maxLength={160} placeholder="Cash sale, refund, interest…" value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-payer`}>From</Label>
              <Input id={`${id}-payer`} maxLength={160} placeholder="Who paid" value={form.payer} onChange={(e) => set({ payer: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-amount`}>Amount</Label>
                <Input id={`${id}-amount`} type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-currency`}>Currency</Label>
                <CurrencySelect id={`${id}-currency`} value={form.currency} onValueChange={(currency) => set({ currency })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-date`}>Received on</Label>
                <Input id={`${id}-date`} type="date" value={form.receivedOn} onChange={(e) => set({ receivedOn: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-method`}>Method</Label>
                <select
                  id={`${id}-method`} value={form.method} onChange={(e) => set({ method: e.target.value })}
                  className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm md:h-9"
                >
                  <option value="">Not said</option>
                  {INCOME_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-reference`}>Reference</Label>
                <Input id={`${id}-reference`} maxLength={80} placeholder="Receipt or bank reference" value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-notes`}>Notes</Label>
              <Textarea id={`${id}-notes`} maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IncomeEntryDialog;
