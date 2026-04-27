import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComp } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DayPickerPopoverProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const formatRelative = (d: Date): string => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 6) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -6) return `${Math.abs(diffDays)}d ago`;
  return target.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      target.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
};

/** Trigger button + popover wrapping the day picker calendar. */
export const DayPickerPopover: React.FC<DayPickerPopoverProps> = ({
  value,
  onChange,
  placeholder = 'No due date',
  className,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const isOverdue =
    value && new Date(value).getTime() < new Date().setHours(0, 0, 0, 0);

  const setOffset = (days: number | null) => {
    if (days === null) {
      onChange(null);
    } else {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + days);
      onChange(d);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-8 justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            isOverdue && 'border-destructive/40 text-destructive',
            className,
          )}
        >
          <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
          <span className="truncate">
            {value ? formatRelative(new Date(value)) : placeholder}
          </span>
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              className="ml-auto pl-2 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0 max-w-[280px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-2 gap-1 px-2 pt-2 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 justify-start text-xs"
            onClick={() => setOffset(0)}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 justify-start text-xs"
            onClick={() => setOffset(1)}
          >
            Tomorrow
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 justify-start text-xs"
            onClick={() => setOffset(7)}
          >
            Next week
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 justify-start text-xs text-destructive"
            onClick={() => setOffset(null)}
          >
            Clear
          </Button>
        </div>
        <CalendarComp
          mode="single"
          selected={value ?? undefined}
          onSelect={(d) => {
            onChange(d ?? null);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
};

export default DayPickerPopover;
