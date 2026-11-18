import React, { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LEAVE_STATUS_LABEL, LEAVE_TYPE_LABEL, todayYmd, type LeaveType } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import type { HrPerson } from '../types';
import {
  blankLeaveForm,
  checkLeaveForm,
  toCreateLeaveInput,
  updateLeaveForm,
  type LeaveFormValues,
} from './leaveForm';
import { errorMessage, formatDayCount, formatLeaveDates, personName } from './leaveView';

const LEAVE_TYPES = Object.keys(LEAVE_TYPE_LABEL) as LeaveType[];

interface AddLeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: HrPerson[];
  leave: UseLeave;
}

/** Record leave for anyone on the team: approved straight away, or as a pending request. */
export const AddLeaveDialog: React.FC<AddLeaveDialogProps> = ({ open, onOpenChange, people, leave }) => {
  const [saving, setSaving] = useState(false);

  const save = async (form: LeaveFormValues, days: number, name: string) => {
    setSaving(true);
    try {
      await leave.create(toCreateLeaveInput(form, days));
      toast.success(form.approveNow ? `Leave added for ${name}` : `Leave request added for ${name}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the leave.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !saving) && onOpenChange(next)}>
      <DialogContent>
        <AddLeaveForm
          people={people}
          leave={leave}
          saving={saving}
          onCancel={() => onOpenChange(false)}
          onSave={(form, days, name) => void save(form, days, name)}
        />
      </DialogContent>
    </Dialog>
  );
};

interface AddLeaveFormProps {
  people: HrPerson[];
  leave: UseLeave;
  saving: boolean;
  onCancel: () => void;
  onSave: (form: LeaveFormValues, days: number, name: string) => void;
}

/** Mounted with the dialog, so it starts blank every time it opens. */
const AddLeaveForm: React.FC<AddLeaveFormProps> = ({ people, leave, saving, onCancel, onSave }) => {
  const id = useId();
  const ids = {
    person: `${id}-person`,
    type: `${id}-type`,
    start: `${id}-start`,
    end: `${id}-end`,
    reason: `${id}-reason`,
    approve: `${id}-approve`,
  };

  // With one person on the team there is nothing to choose.
  const [form, setForm] = useState<LeaveFormValues>(() =>
    blankLeaveForm(todayYmd(), people.length === 1 ? people[0].userId : ''),
  );
  const change = (patch: Partial<LeaveFormValues>) => setForm((f) => updateLeaveForm(f, patch));

  const { requests, holidayDates, allowanceFor } = leave;
  const check = useMemo(
    () => checkLeaveForm(form, { requests, holidayDates, allowance: allowanceFor(form.userId) }),
    [form, requests, holidayDates, allowanceFor],
  );

  const name = personName(people.find((p) => p.userId === form.userId));
  const singleDay = Boolean(form.startDate) && form.startDate === form.endDate;

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (check.problem === null && !saving) onSave(form, check.days, name);
      }}
    >
      <DialogHeader>
        <DialogTitle>Add leave</DialogTitle>
        <DialogDescription>Weekends and public holidays are not counted.</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={ids.person}>Employee</Label>
            <Select value={form.userId} onValueChange={(userId) => change({ userId })} disabled={saving}>
              <SelectTrigger id={ids.person}>
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {personName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.type}>Type</Label>
            <Select
              value={form.leaveType}
              onValueChange={(leaveType) => change({ leaveType: leaveType as LeaveType })}
              disabled={saving}
            >
              <SelectTrigger id={ids.type}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {LEAVE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={ids.start}>Start date</Label>
            <Input
              id={ids.start}
              type="date"
              value={form.startDate}
              onChange={(e) => change({ startDate: e.target.value })}
              disabled={saving}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={ids.end}>End date</Label>
            <Input
              id={ids.end}
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={(e) => change({ endDate: e.target.value })}
              disabled={saving}
            />
          </div>
        </div>

        <label className={cn('flex w-fit items-center gap-2 text-sm', !singleDay && 'text-muted-foreground')}>
          <input
            type="checkbox"
            checked={form.halfDay}
            onChange={(e) => change({ halfDay: e.target.checked })}
            disabled={!singleDay || saving}
            className="h-4 w-4 accent-primary"
          />
          <span>Half day</span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor={ids.reason}>Reason</Label>
          <Textarea
            id={ids.reason}
            rows={3}
            value={form.reason}
            onChange={(e) => change({ reason: e.target.value })}
            placeholder="Optional"
            disabled={saving}
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor={ids.approve}>Approve now</Label>
            <p className="mt-1 text-xs text-muted-foreground">Turn off to save it as a pending request.</p>
          </div>
          <Switch
            id={ids.approve}
            checked={form.approveNow}
            onCheckedChange={(approveNow) => change({ approveNow })}
            disabled={saving}
          />
        </div>

        {check.problem !== 'incomplete' && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md bg-surface-2 px-3 py-2 text-sm">
            <span className="font-medium tabular-nums text-foreground">
              {formatDayCount(check.days, 'working day')}
            </span>
            {check.remainingAfter !== null && (
              <span
                className={cn(
                  'tabular-nums',
                  check.remainingAfter < 0 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                Remaining after this: {formatDayCount(check.remainingAfter)}
              </span>
            )}
          </div>
        )}

        {check.problem === 'clash' && check.clash && (
          <p role="alert" className="text-sm text-destructive">
            {name} already has leave on these dates ({formatLeaveDates(check.clash.startDate, check.clash.endDate)},{' '}
            {LEAVE_STATUS_LABEL[check.clash.status].toLowerCase()}).
          </p>
        )}
        {check.problem === 'no-working-days' && (
          <p role="alert" className="text-sm text-destructive">
            These dates fall on a weekend or public holiday.
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={check.problem !== null || saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
};
