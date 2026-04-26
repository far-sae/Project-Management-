import { DayPicker, DayPickerProps } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

import { cn } from '@/lib/utils';

export type CalendarProps = DayPickerProps;

/** Lightweight token-aware wrapper around react-day-picker v9. */
function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn('rdp p-2', className)}
      classNames={{
        root: 'relative',
        months: 'flex flex-col gap-3',
        month: 'space-y-2',
        month_caption:
          'flex justify-center pt-1 relative items-center text-sm font-medium text-foreground',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1 absolute right-1 top-1',
        button_previous:
          'inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors',
        button_next:
          'inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday:
          'text-muted-foreground rounded-md w-9 font-normal text-[0.7rem] uppercase',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm relative',
        day_button:
          'inline-flex items-center justify-center h-9 w-9 rounded-md text-sm hover:bg-secondary text-foreground transition-colors aria-selected:opacity-100',
        selected:
          '!bg-primary !text-primary-foreground hover:!bg-primary/90 focus:!bg-primary',
        today: 'border border-border',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      {...props}
    />
  );
}

export { Calendar };
