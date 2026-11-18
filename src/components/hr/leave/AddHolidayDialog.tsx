import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import type { UseLeave } from '@/hooks/useLeave';
import { errorMessage, formatYmd } from './leaveView';

interface AddHolidayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leave: UseLeave;
  /** Called with the new holiday's date once it is saved. */
  onAdded?: (date: string) => void;
}

/** Add one public holiday. A date can only be a holiday once. */
export const AddHolidayDialog: React.FC<AddHolidayDialogProps> = ({ open, onOpenChange, leave, onAdded }) => {
  const [saving, setSaving] = useState(false);

  const add = async (date: string, name: string) => {
    setSaving(true);
    try {
      await leave.addHoliday(date, name);
      toast.success(`${name} added`);
      onAdded?.(date);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add the holiday.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !saving) && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <AddHolidayForm
          leave={leave}
          saving={saving}
          onCancel={() => onOpenChange(false)}
          onAdd={(date, name) => void add(date, name)}
        />
      </DialogContent>
    </Dialog>
  );
};

interface AddHolidayFormProps {
  leave: UseLeave;
  saving: boolean;
  onCancel: () => void;
  onAdd: (date: string, name: string) => void;
}

/** Mounted with the dialog, so it is empty every time it opens. */
const AddHolidayForm: React.FC<AddHolidayFormProps> = ({ leave, saving, onCancel, onAdd }) => {
  const dateId = useId();
  const nameId = useId();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const taken = date ? leave.holidays.find((h) => h.date === date) : undefined;
  const ready = Boolean(date) && Boolean(name.trim()) && !taken;

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !saving) onAdd(date, name.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>Add public holiday</DialogTitle>
        <DialogDescription>Public holidays are not counted as leave days.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={dateId}>Date</Label>
          <Input
            id={dateId}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={saving}
            aria-invalid={taken ? true : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Christmas Day"
            maxLength={80}
            disabled={saving}
          />
        </div>
        {taken && (
          <p role="alert" className="text-sm text-destructive">
            {formatYmd(taken.date)} is already a public holiday ({taken.name}).
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Add holiday
        </Button>
      </DialogFooter>
    </form>
  );
};
