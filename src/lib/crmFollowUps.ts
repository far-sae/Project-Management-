// CRM follow-ups: which list a follow-up belongs in, and the order inside it.
import type { CrmTask } from '@/types/crmHub';

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming' | 'no_date' | 'done';

/** Display order: what needs attention first, finished work last. */
export const FOLLOW_UP_BUCKETS: FollowUpBucket[] = ['overdue', 'today', 'upcoming', 'no_date', 'done'];

export const FOLLOW_UP_BUCKET_LABEL: Record<FollowUpBucket, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  upcoming: 'Upcoming',
  no_date: 'No date',
  done: 'Done',
};

type BucketFields = Pick<CrmTask, 'status' | 'dueDate'>;
type OrderFields = BucketFields & Pick<CrmTask, 'priority' | 'completedAt'>;

/** A date as `yyyy-MM-dd` in the viewer's own time zone. */
export function localYmd(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * The list a follow-up belongs in. Days are compared, not hours: something
 * due at 9am today is still "due today" in the afternoon and only becomes
 * overdue tomorrow. A completed follow-up is always "done".
 */
export function followUpBucket(task: BucketFields, todayYmd: string): FollowUpBucket {
  if (task.status === 'completed') return 'done';
  if (!task.dueDate) return 'no_date';
  const due = localYmd(task.dueDate);
  if (due < todayYmd) return 'overdue';
  return due === todayYmd ? 'today' : 'upcoming';
}

const time = (date: Date | null): number | null => (date ? date.getTime() : null);

/** Open follow-ups: urgent first, then the earliest due date. */
const byUrgencyThenDue = (a: OrderFields, b: OrderFields): number => {
  const urgent = Number(b.priority === 'urgent') - Number(a.priority === 'urgent');
  if (urgent !== 0) return urgent;
  return (time(a.dueDate) ?? Infinity) - (time(b.dueDate) ?? Infinity) || 0;
};

/** Finished follow-ups: the most recently finished first. */
const byFinishedLatest = (a: OrderFields, b: OrderFields): number =>
  (time(b.completedAt) ?? -Infinity) - (time(a.completedAt) ?? -Infinity) || 0;

/**
 * Follow-ups split into their lists, each one ordered for reading. Every
 * bucket is present (empty when nothing falls in it) and the input is left
 * untouched. Follow-ups that tie keep the order they were given in.
 */
export function groupFollowUps<T extends OrderFields>(
  tasks: readonly T[],
  todayYmd: string,
): Record<FollowUpBucket, T[]> {
  const groups: Record<FollowUpBucket, T[]> = { overdue: [], today: [], upcoming: [], no_date: [], done: [] };
  for (const task of tasks) groups[followUpBucket(task, todayYmd)].push(task);
  for (const bucket of FOLLOW_UP_BUCKETS) {
    groups[bucket].sort(bucket === 'done' ? byFinishedLatest : byUrgencyThenDue);
  }
  return groups;
}

/** How many follow-ups are in each list. */
export function followUpCounts(
  tasks: readonly BucketFields[],
  todayYmd: string,
): Record<FollowUpBucket, number> {
  const counts: Record<FollowUpBucket, number> = { overdue: 0, today: 0, upcoming: 0, no_date: 0, done: 0 };
  for (const task of tasks) counts[followUpBucket(task, todayYmd)] += 1;
  return counts;
}
