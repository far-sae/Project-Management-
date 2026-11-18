import React, { useId, useMemo, useState } from 'react';
import { Loader2, Pencil, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { leaveBalance } from '@/lib/leave';
import type { UseLeave } from '@/hooks/useLeave';
import type { LeaveAllowance } from '@/services/supabase/leave';
import type { HrPerson } from '../types';
import { PersonCell } from './PersonCell';
import {
  errorMessage,
  formatDays,
  personName,
  ROW_ICON_BUTTON,
  TABLE_BOX,
  TABLE_HEAD_ROW,
  TABLE_ROW,
} from './leaveView';
import { useLastValue } from './useLastValue';

interface LeaveBalancesTableProps {
  people: HrPerson[];
  leave: UseLeave;
  year: number;
}

/** What each person is allowed, has used and has left in one year. */
export const LeaveBalancesTable: React.FC<LeaveBalancesTableProps> = ({ people, leave, year }) => {
  const [editing, setEditing] = useState<HrPerson | null>(null);
  const { requests, allowanceFor } = leave;

  const rows = useMemo(
    () =>
      people.map((person) => {
        const allowance = allowanceFor(person.userId);
        return {
          person,
          annual: leaveBalance(requests, person.userId, 'annual', year, allowance.annualDays),
          sick: leaveBalance(requests, person.userId, 'sick', year, allowance.sickDays),
        };
      }),
    [people, requests, allowanceFor, year],
  );

  return (
    <>
      <div className={TABLE_BOX}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No team members yet.</p>
            <p className="text-xs text-muted-foreground">People show up here once they join your organization.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className={TABLE_HEAD_ROW}>
                  <th scope="col" className="px-4 font-medium">Employee</th>
                  <th scope="col" className="px-4 text-right font-medium">Annual allowance</th>
                  <th scope="col" className="px-4 text-right font-medium">Used</th>
                  <th scope="col" className="px-4 text-right font-medium">Pending</th>
                  <th scope="col" className="px-4 text-right font-medium">Remaining</th>
                  <th scope="col" className="px-4 text-right font-medium">Sick allowance</th>
                  <th scope="col" className="px-4 text-right font-medium">Sick used</th>
                  <th scope="col" className="px-4 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ person, annual, sick }) => (
                  <tr key={person.userId} className={TABLE_ROW}>
                    <td className="px-4">
                      <PersonCell person={person} />
                    </td>
                    <td className="px-4 text-right tabular-nums">{formatDays(annual.entitled)}</td>
                    <td className="px-4 text-right tabular-nums">{formatDays(annual.used)}</td>
                    <td className="px-4 text-right tabular-nums text-muted-foreground">{formatDays(annual.pending)}</td>
                    <td
                      className={cn(
                        'px-4 text-right font-medium tabular-nums',
                        annual.remaining < 0 ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {formatDays(annual.remaining)}
                    </td>
                    <td className="px-4 text-right tabular-nums">{formatDays(sick.entitled)}</td>
                    <td className="px-4 text-right tabular-nums">{formatDays(sick.used)}</td>
                    <td className="whitespace-nowrap px-4 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={ROW_ICON_BUTTON}
                        onClick={() => setEditing(person)}
                        title="Edit allowance"
                        aria-label={`Edit allowance for ${personName(person)}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditAllowanceDialog person={editing} leave={leave} onClose={() => setEditing(null)} />
    </>
  );
};

interface EditAllowanceDialogProps {
  person: HrPerson | null;
  leave: UseLeave;
  onClose: () => void;
}

const EditAllowanceDialog: React.FC<EditAllowanceDialogProps> = ({ person, leave, onClose }) => {
  const shown = useLastValue(person);
  const [saving, setSaving] = useState(false);

  const save = async (allowance: LeaveAllowance, name: string) => {
    setSaving(true);
    try {
      await leave.saveAllowance(allowance);
      toast.success(`Allowance saved for ${name}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the allowance.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        {shown && (
          <EditAllowanceForm
            key={shown.userId}
            name={personName(shown)}
            allowance={leave.allowanceFor(shown.userId)}
            saving={saving}
            onClose={onClose}
            onSave={(allowance) => void save(allowance, personName(shown))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

/** A number of days, zero or more; NaN for anything else. */
const parseDays = (value: string): number => {
  const days = value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(days) && days >= 0 ? days : NaN;
};

interface EditAllowanceFormProps {
  name: string;
  allowance: LeaveAllowance;
  saving: boolean;
  onClose: () => void;
  onSave: (allowance: LeaveAllowance) => void;
}

/** Mounted with the dialog, so it starts from the saved allowance every time it opens. */
const EditAllowanceForm: React.FC<EditAllowanceFormProps> = ({ name, allowance, saving, onClose, onSave }) => {
  const annualId = useId();
  const sickId = useId();
  const [annual, setAnnual] = useState(String(allowance.annualDays));
  const [sick, setSick] = useState(String(allowance.sickDays));

  const annualDays = parseDays(annual);
  const sickDays = parseDays(sick);
  const valid = !Number.isNaN(annualDays) && !Number.isNaN(sickDays);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !saving) onSave({ userId: allowance.userId, annualDays, sickDays });
      }}
    >
      <DialogHeader>
        <DialogTitle>Leave allowance for {name}</DialogTitle>
        <DialogDescription>Days per year. The same allowance applies to every year.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={annualId}>Annual days</Label>
          <Input
            id={annualId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={annual}
            onChange={(e) => setAnnual(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={sickId}>Sick days</Label>
          <Input
            id={sickId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={sick}
            onChange={(e) => setSick(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
};
