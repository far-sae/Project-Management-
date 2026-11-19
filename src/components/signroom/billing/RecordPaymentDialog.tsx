// Record money that has arrived for an issued invoice. Each payment makes its own receipt.
import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { balance } from '../../../../api/_signroom/shared/invoiceMath';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { billingToday, formatMinor } from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FIELD, Tick } from './shared';

export interface PaymentInput { amount: string; paidOn: string; method: string; reference: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
  busy: boolean;
  onRecord: (payment: PaymentInput) => void;
}

export const RecordPaymentDialog: React.FC<Props> = ({ open, onOpenChange, invoice, busy, onRecord }) => {
  const id = useId();
  const owed = balance(invoice);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [method, setMethod] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState(false);

  // Each time it opens: the full amount still owed, dated today.
  useEffect(() => {
    if (!open) return;
    setAmount((owed / 100).toFixed(2));
    setPaidOn(billingToday());
    setMethod('Bank transfer');
    setReference('');
    setReceived(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (received) onRecord({ amount, paidOn, method, reference });
          }}
        >
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              <span className="tabular-nums">{formatMinor(owed, invoice.currency)}</span> is still to pay on {invoice.number}.
              Recording a payment makes a receipt. It does not move any money.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={FIELD}>
              <Label htmlFor={`${id}-amount`}>Amount received ({invoice.currency})</Label>
              <Input
                id={`${id}-amount`}
                required
                inputMode="decimal"
                className="text-right tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-paid-on`}>Payment date</Label>
              <Input
                id={`${id}-paid-on`}
                type="date"
                required
                max={billingToday()}
                className="tabular-nums"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-method`}>Payment method</Label>
              <Input id={`${id}-method`} maxLength={100} value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy} />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-reference`}>Payment reference</Label>
              <Input id={`${id}-reference`} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} disabled={busy} />
            </div>
          </div>

          <Tick checked={received} onChange={setReceived} disabled={busy} required>
            I confirm this payment has actually been received.
          </Tick>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !received}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Record payment and create receipt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RecordPaymentDialog;
