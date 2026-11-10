type DateLike = string | Date | null | undefined;

const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

function toTime(d: DateLike): number | null {
  if (d == null || d === '') return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

function defaultFormatDateTime(d: DateLike): string {
  const date = new Date(d as string | Date);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function defaultFormatDate(d: DateLike): string {
  const date = new Date(d as string | Date);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Plain-English list of what an edit changed on a task, e.g.
 * ["moved it to Done", "changed the due date to Fri, 13 Nov"] — used for the
 * "Task updated" notification and its email.
 */
export function describeTaskChanges(p: {
  previousStatus?: string;
  newStatus?: string;
  statusLabel?: (statusId: string) => string;
  previousDueDate?: DateLike;
  newDueDate?: DateLike;
  formatDate?: (d: DateLike) => string;
  previousPriority?: string | null;
  newPriority?: string | null;
  previousMeetingAt?: DateLike;
  newMeetingAt?: DateLike;
  formatDateTime?: (d: DateLike) => string;
  assigneesChanged?: boolean;
}): string[] {
  const out: string[] = [];

  if (p.newStatus !== undefined && p.previousStatus !== undefined && p.newStatus !== p.previousStatus) {
    out.push(`moved it to ${p.statusLabel ? p.statusLabel(p.newStatus) : p.newStatus}`);
  }

  if (p.previousDueDate !== undefined || p.newDueDate !== undefined) {
    const before = toTime(p.previousDueDate);
    const after = toTime(p.newDueDate);
    if (before !== after) {
      if (after === null) out.push('removed the due date');
      else out.push(`changed the due date to ${(p.formatDate ?? defaultFormatDate)(p.newDueDate)}`);
    }
  }

  if (p.newPriority && p.previousPriority !== undefined && p.newPriority !== p.previousPriority) {
    out.push(`changed the priority to ${PRIORITY_LABEL[p.newPriority] ?? p.newPriority}`);
  }

  if (p.previousMeetingAt !== undefined || p.newMeetingAt !== undefined) {
    const before = toTime(p.previousMeetingAt);
    const after = toTime(p.newMeetingAt);
    if (before !== after) {
      const when = after === null ? '' : (p.formatDateTime ?? defaultFormatDateTime)(p.newMeetingAt);
      if (after === null) out.push('cancelled the meeting');
      else if (before === null) out.push(`scheduled a meeting for ${when}`);
      else out.push(`moved the meeting to ${when}`);
    }
  }

  if (p.assigneesChanged) out.push("updated who's assigned");
  return out;
}
