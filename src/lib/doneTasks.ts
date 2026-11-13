import type { Task } from '@/types';

export interface DoneGroup {
  label: string;
  tasks: Task[];
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** When a task was finished (older rows may lack `completedAt`). */
export function finishedAt(task: Task): Date {
  return new Date(task.completedAt ?? task.updatedAt);
}

/** Finished tasks grouped Today / Yesterday / Earlier this week / Earlier, newest first. */
export function groupDoneTasks(tasks: Task[], now: Date = new Date()): DoneGroup[] {
  const today = startOfDay(now);
  const yesterday = today - DAY;
  const weekStart = today - ((now.getDay() + 6) % 7) * DAY; // Monday

  const order = ['Today', 'Yesterday', 'Earlier this week', 'Earlier'];
  const buckets = new Map<string, Task[]>(order.map((l) => [l, []]));
  const sorted = [...tasks].sort((a, b) => finishedAt(b).getTime() - finishedAt(a).getTime());
  for (const t of sorted) {
    const at = finishedAt(t).getTime();
    const label =
      at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : at >= weekStart ? 'Earlier this week' : 'Earlier';
    buckets.get(label)!.push(t);
  }
  return order.filter((l) => buckets.get(l)!.length > 0).map((label) => ({ label, tasks: buckets.get(label)! }));
}
