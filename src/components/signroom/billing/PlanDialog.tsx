// Add a billing plan for a company, or change one: what it is called, how it bills and when it runs.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ClientProject } from '../../../../api/_signroom/shared/types';
import { INVOICE_CURRENCIES } from '@/lib/signroom/billing';
import {
  PLAN_STATUSES, PLAN_TYPES, planBody, planForm, planTypeName, type PlanBody, type PlanForm,
} from '@/lib/signroom/billingPlans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FIELD } from './shared';

export interface PlanDialogProps {
  open: boolean;
  /** The plan being changed, or null to add one. */
  plan: ClientProject | null;
  companyName: string;
  /** What a new plan starts with. */
  start: { currency: string; startMonth: string };
  busy: boolean;
  /** A sentence to show above the buttons: why the last save did not go through. */
  error: string;
  onClose: () => void;
  onSave: (body: PlanBody) => void;
}

const HINT = 'text-xs text-muted-foreground';

export const PlanDialog: React.FC<PlanDialogProps> = ({ open, plan, companyName, start, busy, error, onClose, onSave }) => (
  <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
    <DialogContent className="sm:max-w-xl">
      {/* A newer version of the plan starts the form again from what the server has. */}
      <Fields
        key={plan ? `${plan.id}:${plan.revision}` : 'new'}
        plan={plan} companyName={companyName} start={start} busy={busy} error={error} onClose={onClose} onSave={onSave}
      />
    </DialogContent>
  </Dialog>
);

const Fields: React.FC<Omit<PlanDialogProps, 'open'>> = ({ plan, companyName, start, busy, error, onClose, onSave }) => {
  const id = useId();
  const [form, setForm] = useState<PlanForm>(() => planForm(plan, start));
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm((old) => ({ ...old, [key]: value }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => { event.preventDefault(); onSave(planBody(form)); }}
    >
      <DialogHeader>
        <DialogTitle>{plan ? 'Edit billing plan' : 'Add billing plan'}</DialogTitle>
        <DialogDescription>
          For {companyName}. A plan sets what you expect to be paid, so each month shows what has come in. Amounts include tax.
        </DialogDescription>
      </DialogHeader>

      <div className={FIELD}>
        <Label htmlFor={`${id}-name`}>Plan name</Label>
        <Input
          id={`${id}-name`} required maxLength={160} disabled={busy} placeholder="For example, Website retainer"
          value={form.name} onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={FIELD}>
          <Label htmlFor={`${id}-type`}>How it bills</Label>
          <Select value={form.billingType} onValueChange={(v) => set('billingType', v as PlanForm['billingType'])} disabled={busy}>
            <SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLAN_TYPES.map((type) => <SelectItem key={type} value={type}>{planTypeName(type)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.billingType === 'Custom' && (
          <div className={FIELD}>
            <Label htmlFor={`${id}-label`}>Billing description</Label>
            <Input
              id={`${id}-label`} required maxLength={80} disabled={busy} placeholder="For example, per milestone"
              value={form.billingLabel} onChange={(e) => set('billingLabel', e.target.value)}
            />
          </div>
        )}
        <div className={FIELD}>
          <Label htmlFor={`${id}-currency`}>Currency</Label>
          <Select value={form.currency} onValueChange={(v) => set('currency', v)} disabled={busy}>
            <SelectTrigger id={`${id}-currency`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {INVOICE_CURRENCIES.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-status`}>Status</Label>
          <Select value={form.status} onValueChange={(v) => set('status', v as PlanForm['status'])} disabled={busy}>
            <SelectTrigger id={`${id}-status`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLAN_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-fee`}>Monthly fee</Label>
          <Input
            id={`${id}-fee`} required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
            aria-describedby={`${id}-fee-hint`}
            value={form.monthlyFee} onChange={(e) => set('monthlyFee', e.target.value)}
          />
          <p id={`${id}-fee-hint`} className={HINT}>Expected every month of a monthly retainer.</p>
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-contract`}>Contract value</Label>
          <Input
            id={`${id}-contract`} required inputMode="decimal" disabled={busy} className="text-right tabular-nums"
            aria-describedby={`${id}-contract-hint`}
            value={form.contractValue} onChange={(e) => set('contractValue', e.target.value)}
          />
          <p id={`${id}-contract-hint`} className={HINT}>The whole amount of a one-off or custom plan.</p>
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-start`}>Start month</Label>
          <Input
            id={`${id}-start`} type="month" required disabled={busy} className="tabular-nums" placeholder="YYYY-MM"
            value={form.startMonth} onChange={(e) => set('startMonth', e.target.value)}
          />
        </div>
        <div className={FIELD}>
          <Label htmlFor={`${id}-end`}>End month (optional)</Label>
          <Input
            id={`${id}-end`} type="month" disabled={busy} className="tabular-nums" placeholder="YYYY-MM"
            min={form.startMonth || undefined} aria-describedby={`${id}-end-hint`}
            value={form.endMonth} onChange={(e) => set('endMonth', e.target.value)}
          />
          <p id={`${id}-end-hint`} className={HINT}>Leave empty for a plan with no end.</p>
        </div>
        <div className={`${FIELD} sm:col-span-2`}>
          <Label htmlFor={`${id}-target`}>Yearly target (optional)</Label>
          <Input
            id={`${id}-target`} inputMode="decimal" disabled={busy} className="text-right tabular-nums sm:max-w-[calc(50%-0.375rem)]"
            aria-describedby={`${id}-target-hint`}
            value={form.annualTarget} onChange={(e) => set('annualTarget', e.target.value)}
          />
          <p id={`${id}-target-hint`} className={HINT}>
            Leave at 0 to work the target out from the monthly fee and the dates, or from the contract value.
          </p>
        </div>
      </div>

      <div className={FIELD}>
        <Label htmlFor={`${id}-notes`}>Notes</Label>
        <Textarea
          id={`${id}-notes`} rows={3} maxLength={3000} disabled={busy}
          value={form.notes} onChange={(e) => set('notes', e.target.value)}
        />
      </div>

      {error && <p role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {plan ? 'Save plan' : 'Add plan'}
        </Button>
      </DialogFooter>
    </form>
  );
};

export default PlanDialog;
