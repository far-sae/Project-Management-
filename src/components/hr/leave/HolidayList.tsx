import React, { useState } from 'react';
import { CalendarDays, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UseLeave } from '@/hooks/useLeave';
import type { PublicHoliday } from '@/services/supabase/leave';
import { errorMessage, formatYmd, ROW_ICON_BUTTON, TABLE_BOX } from './leaveView';

interface HolidayListProps {
  /** The holidays of the chosen year, in date order. */
  holidays: PublicHoliday[];
  year: number;
  /** `yyyy-MM-dd`; earlier holidays are shown muted. */
  today: string;
  leave: UseLeave;
  onAdd: () => void;
}

/** The public holidays of one year. These days are not counted as leave. */
export const HolidayList: React.FC<HolidayListProps> = ({ holidays, year, today, leave, onAdd }) => {
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (holiday: PublicHoliday) => {
    setBusyId(holiday.id);
    try {
      await leave.removeHoliday(holiday.id);
      toast.success(`${holiday.name} removed`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not remove the holiday.'));
    } finally {
      setBusyId(null);
    }
  };

  if (holidays.length === 0) {
    return (
      <div className={TABLE_BOX}>
        <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
          <CalendarDays className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No public holidays in {year}.</p>
          <p className="text-xs text-muted-foreground">Days you add here are not counted as leave.</p>
          <Button variant="outline" className="mt-3" onClick={onAdd}>
            Add holiday
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={TABLE_BOX}>
      <ul>
        {holidays.map((h) => {
          const past = h.date < today;
          return (
            <li
              key={h.id}
              className="flex min-h-12 items-center gap-3 border-b border-border/60 px-4 py-1.5 text-sm transition-colors last:border-0 hover:bg-surface-2"
            >
              <div
                className={cn(
                  'flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3',
                  past && 'text-muted-foreground',
                )}
              >
                <span className={cn('shrink-0 font-medium tabular-nums sm:w-36', !past && 'text-foreground')}>
                  {formatYmd(h.date, 'EEE d MMM yyyy')}
                </span>
                <span className="min-w-0 truncate" title={h.name}>
                  {h.name}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={cn(ROW_ICON_BUTTON, 'shrink-0 hover:bg-destructive-soft hover:text-destructive')}
                disabled={busyId === h.id}
                onClick={() => void remove(h)}
                title="Remove holiday"
                aria-label={`Remove ${h.name}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
