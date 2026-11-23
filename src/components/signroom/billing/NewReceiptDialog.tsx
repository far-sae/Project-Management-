// Start a receipt: pick the issued invoice the money is for. A receipt always
// belongs to an invoice, so the payment itself is entered on that invoice.
import React, { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { balance } from '../../../../api/_signroom/shared/invoiceMath';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { formatMinor, shortDate } from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FIELD } from './shared';

/** Issued, and money is still to come: the only invoices a receipt can be made for. */
export const waitingForMoney = (invoices: Invoice[]): Invoice[] =>
  invoices
    .filter((i) => (i.status === 'Issued' || i.status === 'Part paid') && balance(i) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));

export interface NewReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoices: Invoice[];
  /** The company an invoice is for, as the list shows it. */
  nameOf: (invoice: Invoice) => string;
  /** Start an invoice instead, when there is none to make a receipt for. */
  onNewInvoice: () => void;
}

export const NewReceiptDialog: React.FC<NewReceiptDialogProps> = ({ open, onOpenChange, invoices, nameOf, onNewInvoice }) => {
  const id = useId();
  const navigate = useNavigate();
  const waiting = useMemo(() => waitingForMoney(invoices), [invoices]);
  const [chosen, setChosen] = useState('');

  // Each time it opens: nothing chosen, unless there is only one it could be.
  useEffect(() => {
    if (open) setChosen(waiting.length === 1 ? waiting[0]!.id : '');
  }, [open]);

  const invoice = waiting.find((i) => i.id === chosen) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New receipt</DialogTitle>
          <DialogDescription>
            A receipt is for money that has arrived for an invoice. Send the invoice first. Make the receipt when the money is in the bank.
          </DialogDescription>
        </DialogHeader>

        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No issued invoice is waiting for money, so there is nothing to make a receipt for. Create and issue an invoice first.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={FIELD}>
              <Label htmlFor={`${id}-invoice`}>Invoice the money is for</Label>
              <Select value={chosen} onValueChange={setChosen}>
                <SelectTrigger id={`${id}-invoice`}><SelectValue placeholder="Choose an invoice" /></SelectTrigger>
                <SelectContent>
                  {waiting.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number}{nameOf(i) ? ` · ${nameOf(i)}` : ''} · {formatMinor(balance(i), i.currency)} to pay
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {invoice && (
              <p className="text-xs text-muted-foreground">
                <span className="tabular-nums">{formatMinor(balance(invoice), invoice.currency)}</span> is still to pay on {invoice.number},
                due {shortDate(invoice.dueDate)}. Next you enter the amount that arrived, and the receipt is made.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {waiting.length === 0 ? (
            <Button onClick={() => { onOpenChange(false); onNewInvoice(); }}>New invoice</Button>
          ) : (
            <Button
              disabled={!invoice}
              onClick={() => { if (invoice) { onOpenChange(false); navigate(`/crm/invoices/${invoice.id}?payment=new`); } }}
            >
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewReceiptDialog;
