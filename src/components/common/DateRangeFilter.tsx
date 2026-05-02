import React, { useState } from 'react';
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  format,
} from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComp } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

export type DateRangePreset =
  | 'all'
  | 'today'
  | 'last7'
  | 'thisMonth'
  | 'thisYear'
  | 'custom';

export interface DateRangeValue {
  preset: DateRangePreset;
  /** Inclusive start (set to start-of-day). null when preset === 'all'. */
  start: Date | null;
  /** Inclusive end (set to end-of-day). null when preset === 'all'. */
  end: Date | null;
}

export const ALL_TIME: DateRangeValue = { preset: 'all', start: null, end: null };

const presetLabel: Record<DateRangePreset, string> = {
  all: 'All time',
  today: 'Today',
  last7: 'Last 7 days',
  thisMonth: 'This month',
  thisYear: 'This year',
  custom: 'Custom range',
};

/** Resolve a preset to its concrete [start, end] window relative to `now`. */
export const resolvePreset = (
  preset: Exclude<DateRangePreset, 'custom' | 'all'>,
  now: Date = new Date(),
): { start: Date; end: Date } => {
  switch (preset) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'last7':
      return { start: startOfDay(subDays(now, 6)), end: endOfDay(now) };
    case 'thisMonth':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'thisYear':
      return { start: startOfYear(now), end: endOfYear(now) };
  }
};

/** True when `date` falls within `range` (inclusive). All-time always matches. */
export const inRange = (date: Date | null | undefined, range: DateRangeValue): boolean => {
  if (!range.start || !range.end) return true;
  if (!date) return false;
  const t = date.getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
};

const formatShort = (d: Date) =>
  format(d, d.getFullYear() === new Date().getFullYear() ? 'MMM d' : 'MMM d, yyyy');

const summarize = (value: DateRangeValue): string => {
  if (value.preset === 'all') return presetLabel.all;
  if (value.preset !== 'custom') return presetLabel[value.preset];
  if (value.start && value.end) {
    return `${formatShort(value.start)} – ${formatShort(value.end)}`;
  }
  return presetLabel.custom;
};

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** When omitted, defaults to a compact button. */
  className?: string;
  /** Hide the "All time" entry when the page should always have a window. */
  allowAllTime?: boolean;
}

/**
 * Shared date-range filter used across Time Tracking, Expenses, MyTasks, etc.
 * Presets cover the common cases (today / last 7d / this month / this year)
 * and a custom two-click calendar for arbitrary windows.
 */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  value,
  onChange,
  className,
  allowAllTime = true,
}) => {
  const [open, setOpen] = useState(false);
  const [pickingStart, setPickingStart] = useState<Date | null>(value.start);
  const [pickingEnd, setPickingEnd] = useState<Date | null>(value.end);

  const applyPreset = (preset: Exclude<DateRangePreset, 'custom' | 'all'>) => {
    const { start, end } = resolvePreset(preset);
    onChange({ preset, start, end });
    setPickingStart(start);
    setPickingEnd(end);
    setOpen(false);
  };

  const applyAllTime = () => {
    onChange(ALL_TIME);
    setPickingStart(null);
    setPickingEnd(null);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!pickingStart || !pickingEnd) return;
    const [s, e] =
      pickingStart.getTime() <= pickingEnd.getTime()
        ? [pickingStart, pickingEnd]
        : [pickingEnd, pickingStart];
    onChange({
      preset: 'custom',
      start: startOfDay(s),
      end: endOfDay(e),
    });
    setOpen(false);
  };

  const handleCalendarSelect = (d: Date | undefined) => {
    if (!d) return;
    if (!pickingStart || (pickingStart && pickingEnd)) {
      setPickingStart(d);
      setPickingEnd(null);
    } else {
      setPickingEnd(d);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-8 justify-start text-left font-normal gap-1.5', className)}
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          <span className="truncate">{summarize(value)}</span>
          {value.preset !== 'all' && allowAllTime && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date filter"
              className="ml-1 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                applyAllTime();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  applyAllTime();
                }
              }}
            >
              <X className="w-3 h-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-2 gap-1 p-2 border-b border-border">
          <PresetButton
            active={value.preset === 'today'}
            onClick={() => applyPreset('today')}
          >
            Today
          </PresetButton>
          <PresetButton
            active={value.preset === 'last7'}
            onClick={() => applyPreset('last7')}
          >
            Last 7 days
          </PresetButton>
          <PresetButton
            active={value.preset === 'thisMonth'}
            onClick={() => applyPreset('thisMonth')}
          >
            This month
          </PresetButton>
          <PresetButton
            active={value.preset === 'thisYear'}
            onClick={() => applyPreset('thisYear')}
          >
            This year
          </PresetButton>
          {allowAllTime && (
            <PresetButton
              active={value.preset === 'all'}
              onClick={applyAllTime}
              className="col-span-2"
            >
              All time
            </PresetButton>
          )}
        </div>
        <div className="p-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Custom range
          </p>
          <CalendarComp
            mode="range"
            selected={{
              from: pickingStart ?? undefined,
              to: pickingEnd ?? undefined,
            }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                setPickingStart(range.from);
                setPickingEnd(range.to);
              } else if (range?.from) {
                handleCalendarSelect(range.from);
              }
            }}
            numberOfMonths={1}
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {pickingStart ? formatShort(pickingStart) : '—'}
              {' → '}
              {pickingEnd ? formatShort(pickingEnd) : '—'}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={!pickingStart || !pickingEnd}
              onClick={applyCustom}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const PresetButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ active, onClick, children, className }) => (
  <Button
    type="button"
    variant={active ? 'default' : 'ghost'}
    size="sm"
    className={cn('h-7 justify-start text-xs', className)}
    onClick={onClick}
  >
    {children}
  </Button>
);

export default DateRangeFilter;
