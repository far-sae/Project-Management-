import type { Task } from '@/types';

export interface WorkloadCell {
  date: Date;
  /** Open tasks due on this day. */
  count: number;
  /** An open task on this day is already late. */
  isOverdue: boolean;
  tasks: Task[];
}

export interface MemberWorkloadData {
  /** Monday → Sunday. */
  cells: WorkloadCell[];
  /** Open tasks due inside the week. */
  weekOpen: number;
  /** Open tasks that were due before this week started. */
  overdue: Task[];
  /** Open tasks with no due date. */
  unscheduled: Task[];
  /** Tasks due this week that are already finished. */
  doneThisWeek: number;
  /** Tasks that count against capacity for this week. */
  loadTasks: number;
}

const DAY = 86_400_000;

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * One person's load for the week starting `weekStart` (a Monday, local time).
 *
 * - Finished tasks never count as load.
 * - Open tasks due before the week are "overdue"; they are added to the load
 *   only for the current week, because that is when they have to be done.
 * - Open tasks without a due date are listed but not counted.
 */
export function buildMemberWorkload(
  tasks: Task[],
  userId: string,
  weekStart: Date,
  now: Date = new Date(),
): MemberWorkloadData {
  const start = startOfDay(weekStart).getTime();
  const end = start + 7 * DAY; // exclusive
  const today = startOfDay(now).getTime();
  const isCurrentWeek = today >= start && today < end;

  const cells: WorkloadCell[] = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(start + i * DAY),
    count: 0,
    isOverdue: false,
    tasks: [],
  }));
  const overdue: Task[] = [];
  const unscheduled: Task[] = [];
  let doneThisWeek = 0;

  for (const t of tasks) {
    if (!t.assignees?.some((a) => a.userId === userId)) continue;
    const done = t.status === 'done';
    if (!t.dueDate) {
      if (!done) unscheduled.push(t);
      continue;
    }
    const due = startOfDay(new Date(t.dueDate)).getTime();
    if (due >= start && due < end) {
      if (done) {
        doneThisWeek += 1;
        continue;
      }
      const cell = cells[Math.round((due - start) / DAY)];
      cell.count += 1;
      cell.tasks.push(t);
      if (due < today) cell.isOverdue = true;
    } else if (due < start && due < today && !done) {
      overdue.push(t);
    }
  }

  const weekOpen = cells.reduce((sum, c) => sum + c.count, 0);
  return {
    cells,
    weekOpen,
    overdue,
    unscheduled,
    doneThisWeek,
    loadTasks: weekOpen + (isCurrentWeek ? overdue.length : 0),
  };
}
