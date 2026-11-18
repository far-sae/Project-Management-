/** Pure helpers behind the workspace home page and its project cards. */

import { PRIORITY_TONES, taskLevel } from '@/components/common/TaskBadges';

/** Page title: greet by first name, or plainly when there is no name. */
export function welcomeTitle(displayName?: string | null): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? `Welcome back, ${first}` : 'Welcome back';
}

export interface ProjectProgress {
  done: number;
  total: number;
  /** Whole percent, always 0–100. */
  percent: number;
}

export function projectProgress(
  stats?: { totalTasks?: number | null; completedTasks?: number | null } | null,
): ProjectProgress {
  const total = Math.max(0, stats?.totalTasks ?? 0);
  const done = stats?.completedTasks ?? 0;
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0;
  return { done, total, percent };
}

export type ProjectLockState = 'locked' | 'unlocked' | 'set-pin';

/**
 * Which lock control a project card shows: the session lock state for a
 * PIN-locked project, a "Set PIN" shortcut for the owner otherwise, or none.
 */
export function projectLockState(input: {
  pinLocked: boolean;
  unlockedInSession: boolean;
  isOwner: boolean;
}): ProjectLockState | null {
  if (input.pinLocked) return input.unlockedInSession ? 'unlocked' : 'locked';
  return input.isOwner ? 'set-pin' : null;
}

/** Visible label, tooltip and accessible name for each lock control. */
export const PROJECT_LOCK_COPY: Record<ProjectLockState, { label: string; title: string; ariaLabel: string }> = {
  locked: {
    label: 'Locked',
    title: 'Enter your PIN to unlock for this session',
    ariaLabel: 'Enter PIN to unlock project for this session',
  },
  unlocked: {
    label: 'Unlocked',
    title: 'Unlocked for this session — click to require PIN again',
    ariaLabel: 'Lock session, require PIN again',
  },
  'set-pin': {
    label: 'Set PIN',
    title: 'Set a PIN in project settings to lock the project',
    ariaLabel: 'Open project settings to set lock and PIN',
  },
};

/** Dot colour for a task row: red for urgent / high, amber for medium, grey otherwise. */
export function taskDotClass(task: {
  urgent?: boolean | null;
  priority?: string | null;
  status?: string | null;
}): string {
  if (task.status === 'done') return 'bg-muted-foreground/40';
  if (taskLevel(task) !== 'normal') return 'bg-destructive';
  return (task.priority && PRIORITY_TONES[task.priority]?.dot) || 'bg-muted-foreground/60';
}
