// One month of a billing plan: what is expected, and what was paid outside any invoice.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProjectYear } from '../../../../api/_signroom/shared/types';
import { formatMinor } from '@/lib/signroom/billing';
import { amountText, monthKey, monthLabel, type MonthInput } from '@/lib/signroom/billingPlans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FIELD } from './shared';

export interface PlanMonthDialogProps {
  open: boolean;
  plan: ProjectYear | null;
  year: number;
  /** 0 for January. */
  monthIndex: number;
  busy: boolean;
  /** A sentence to show above the buttons: why the last save did not go through. */
  error: string;
  onClose: () => void;
  onSave: (input: MonthInput) => void;
  onReset: () => void;
}

const HINT = 'text-xs text-muted-foreground';

/** Minor units for what is typed, or null while it is not a plain amount. */
const minorOf = (text: string): number | null => {
  const value = text.trim() || '0';
  return /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
};

export const PlanMonthDialog: React.FC<PlanMonthDialogProps> = ({ open, plan, ...rest }) => (
  <Dialog open={open && plan !== null} onOpenChange={(next) => !next && !rest.busy && rest.onClose()}>
    <DialogContent className="sm:max-w-md">
      {/* A newer version of the plan starts the form again from what the server has. */}
      {plan && <Fields key={`${plan.id}:${plan.revision}:${rest.year}:${rest.monthIndex}`} plan={plan} {...rest} />}
    </DialogContent>
  </Dialog>
);

const Fields: React.FC<Omit<PlanMonthDialogProps, 'open' | 'plan'> & { plan: ProjectYear }> = ({
  plan, year, monthIndex, busy, error, onClose, onSave, onReset,
}) => {
  const id = useId();
  const key = monthKey(year, monthIndex);
  const entry = plan.monthlyEntries?.[key];
  const receipts = plan.invoiceMonths[monthIndex] ?? 0;
  const [expected, setExpected] = useState(() => amountText(plan.expectedMonths[monthIndex] ?? 0));
  const [paid, setPaid] = useState(() => amountText(entry?.paidMinor ?? 0));
  const [notes, setNotes] = useState(entry?.notes ?? '');

  const expectedMinor = minorOf(expected);
  const paidMinor = minorOf(paid);
  const left = expectedMinor === null || paidMinor === null ? null : Math.max(0, expectedMinor - receipts - paidMinor);
  const money = (minor: number) => formatMinor(minor, plan.currency);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => { event.preventDefault(); onSave({ paid, expected, notes }); }}
    >
      <DialogHeader>
        <DialogTitle>{monthLabel(key)}</DialogTitle>
        <DialogDescription>
          {plan.name}. Receipts on linked invoices this month: {money(receipts)}. They are counted already, so do not
          enter them again.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={FIELD}>
          <Label htmlFor={`${id}-expected`}>Expected this month ({plan.currency})</Label>
          <Input
            id={`${id}-expected`} required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
            value={expected} onChange={(e) => setExpected(e.target.value)}
          />
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-paid`}>Paid outside an invoice ({plan.currency})</Label>
          <Input
            id={`${id}-paid`} required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
            aria-describedby={`${id}-paid-hint`}
            value={paid} onChange={(e) => setPaid(e.target.value)}
          />
        </div>
      </div>
      <p id={`${id}-paid-hint`} className={HINT}>
        Only money that has no receipt on a linked invoice. Enter 0 to clear it. Nothing is invoiced, receipted or emailed from here.
      </p>

      <div className={FIELD}>
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea id={`${id}-notes`} rows={2} maxLength={1000} disabled={busy} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <dl className="flex items-baseline justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm" aria-live="polite">
        <dt className="text-muted-foreground">Still to pay for this month</dt>
        <dd className="font-semibold tabular-nums text-foreground">{left === null ? '—' : money(left)}</dd>
      </dl>

      {error && <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{error}</p>}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={onReset} disabled={busy || !entry} title={entry ? undefined : 'Nothing has been entered for this month'}>
          Reset to the plan
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save month
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
};

export default PlanMonthDialog;
