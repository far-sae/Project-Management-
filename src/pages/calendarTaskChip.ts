import { taskLevel } from '@/components/common/TaskBadges';

/** How a task is drawn in the month grid, loudest first. */
export type CalendarChipLevel = 'urgent' | 'high' | 'medium' | 'low' | 'done';

type ChipTask = {
  urgent?: boolean | null;
  priority?: string | null;
  status?: string | null;
};

/**
 * Which chip a task gets: a finished task is always "done", urgent beats
 * priority, and a task with no priority reads as low.
 */
export function calendarChipLevel(task: ChipTask): CalendarChipLevel {
  if (task.status === 'done') return 'done';
  const level = taskLevel(task);
  if (level !== 'normal') return level;
  return task.priority === 'medium' ? 'medium' : 'low';
}

/** Border, background and text for each chip level (theme tokens only). */
export const CALENDAR_CHIP_CLASS: Record<CalendarChipLevel, string> = {
  urgent: 'border-destructive bg-destructive text-destructive-foreground',
  high: 'border-destructive/30 bg-destructive-soft text-destructive-soft-foreground',
  medium: 'border-warning/40 bg-warning-soft text-warning-soft-foreground',
  low: 'border-border bg-secondary text-secondary-foreground',
  done: 'border-border bg-background text-muted-foreground line-through',
};

export const calendarChipClass = (task: ChipTask): string => CALENDAR_CHIP_CLASS[calendarChipLevel(task)];

/** The legend row above the grid. */
export const CALENDAR_CHIP_LEGEND: ReadonlyArray<{ level: CalendarChipLevel; label: string }> = [
  { level: 'urgent', label: 'Urgent' },
  { level: 'high', label: 'High' },
  { level: 'medium', label: 'Medium' },
  { level: 'low', label: 'Low' },
  { level: 'done', label: 'Done' },
];
