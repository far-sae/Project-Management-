import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared pill shape for task labels (urgent / priority / locked). */
export const TASK_PILL =
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[11px] font-semibold leading-none';

const QUIET = 'border-border bg-secondary text-secondary-foreground';

export const PRIORITY_TONES: Record<string, { dot: string; label: string; chip: string }> = {
  high: {
    dot: 'bg-destructive',
    label: 'High',
    chip: 'border-destructive/30 bg-destructive-soft text-destructive-soft-foreground',
  },
  medium: {
    dot: 'bg-warning',
    label: 'Medium',
    chip: 'border-warning/40 bg-warning-soft text-warning-soft-foreground',
  },
  low: {
    dot: 'bg-muted-foreground/60',
    label: 'Low',
    chip: QUIET,
  },
};

export type TaskLevel = 'urgent' | 'high' | 'normal';

/**
 * How loud a task should look: urgent beats high priority, and a finished
 * task never shouts.
 */
export function taskLevel(task: {
  urgent?: boolean | null;
  priority?: string | null;
  status?: string | null;
}): TaskLevel {
  if (task.status === 'done') return 'normal';
  if (task.urgent) return 'urgent';
  if (task.priority === 'high') return 'high';
  return 'normal';
}

/** Card / row surface classes for each level (border + background). */
export const TASK_LEVEL_SURFACE: Record<TaskLevel, string> = {
  urgent: 'border-destructive/50 bg-destructive-soft',
  high: 'border-destructive/30',
  normal: 'border-border',
};

interface PriorityPillProps {
  priority?: string | null;
  /** Custom dot colour set on the task, if any. */
  color?: string | null;
  /** Grey it out (finished tasks). */
  muted?: boolean;
  className?: string;
}

export const PriorityPill: React.FC<PriorityPillProps> = ({ priority, color, muted = false, className }) => {
  const tone = priority ? PRIORITY_TONES[priority] : undefined;
  if (!tone) return null;
  return (
    <span className={cn(TASK_PILL, muted ? QUIET : tone.chip, className)} title={`Priority: ${tone.label}`}>
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', muted ? 'bg-muted-foreground/60' : tone.dot)}
        style={!muted && color ? { backgroundColor: color } : undefined}
      />
      {tone.label}
    </span>
  );
};

export const UrgentBadge: React.FC<{ muted?: boolean; className?: string }> = ({ muted = false, className }) => (
  <span
    className={cn(
      TASK_PILL,
      muted ? QUIET : 'border-destructive bg-destructive text-destructive-foreground',
      className,
    )}
  >
    <AlertTriangle className="h-3 w-3" strokeWidth={2.25} aria-hidden />
    Urgent
  </span>
);
