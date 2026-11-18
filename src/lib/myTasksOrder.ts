/**
 * Order for one My Tasks group: open urgent tasks first, then everything else.
 *
 * Both halves keep the order they came in, so nothing else about the list
 * moves. A finished task is never urgent: it stays where it was, below the
 * open urgent ones.
 */
export function urgentFirst<T extends { urgent?: boolean | null }>(
  tasks: readonly T[],
  isDone: (task: T) => boolean,
): T[] {
  const urgent: T[] = [];
  const rest: T[] = [];
  for (const task of tasks) {
    if (task.urgent && !isDone(task)) urgent.push(task);
    else rest.push(task);
  }
  return [...urgent, ...rest];
}
