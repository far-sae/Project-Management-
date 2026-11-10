// Pure helpers for the `notification-emails` Edge Function (no remote imports
// so Vitest can load them): which notifications get an email, and what the
// email says — including the task's details from the task form.

import { renderNotificationEmail, type RenderedEmail } from './emailTemplates.ts';

/** One row returned by the claim_notification_emails() database function. */
export interface ClaimedNotificationEmail {
  notification_id: string;
  type: string;
  title: string;
  message: string;
  task_id: string | null;
  project_id: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  prefs: Record<string, unknown> | null;
  timezone: string | null;
  task_title: string | null;
  task_due_date: string | null;
  task_priority: string | null;
  task_urgent: boolean | null;
  task_status_label: string | null;
  project_name: string | null;
}

/**
 * Notification types that are emailed, and the Settings switch that controls
 * each. Chat messages are left out on purpose — one email per chat message
 * would flood inboxes (they still chime and pop up in the app).
 */
const EMAIL_CATEGORY: Record<string, string> = {
  task_assigned: 'taskAssigned',
  task_completed: 'taskCompleted',
  task_updated: 'projectUpdates',
  task_reminder: 'projectUpdates',
  task_overdue: 'projectUpdates',
  comment_mention: 'projectUpdates',
  comment_added: 'projectUpdates',
};

export function shouldEmailNotification(type: string, prefs: Record<string, unknown> | null | undefined): boolean {
  const category = EMAIL_CATEGORY[type];
  if (!category) return false;
  const p = prefs ?? {};
  return p.email !== false && p[category] !== false;
}

function formatDue(iso: string, timeZone: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone || 'UTC' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export function renderTaskNotificationEmail(row: ClaimedNotificationEmail, appUrl: string): RenderedEmail {
  const details: Array<[string, string]> = [];
  if (row.task_title) details.push(['Task', row.task_title]);
  if (row.project_name) details.push(['Project', row.project_name]);
  if (row.task_status_label) details.push(['Status', row.task_status_label]);
  const due = row.task_due_date ? formatDue(row.task_due_date, row.timezone) : null;
  if (due) details.push(['Due', due]);
  if (row.task_priority) details.push(['Priority', PRIORITY_LABEL[row.task_priority] ?? row.task_priority]);
  if (row.task_urgent) details.push(['Urgent', 'Yes 🚨']);

  const base = appUrl.replace(/\/+$/, '');
  const actionUrl = row.project_id
    ? `${base}/project/${row.project_id}${row.task_id ? `?taskId=${row.task_id}` : ''}`
    : base;

  const title = row.title || 'TaskCalendar update';
  const subject =
    row.task_title && !title.includes(row.task_title) ? `${title}: ${row.task_title}` : title;

  return renderNotificationEmail({
    title,
    subject,
    body: row.message || '',
    details,
    actionUrl,
    actionLabel: row.task_id ? 'Open task' : undefined,
    footer: "You're getting this because you're on this task. You can turn these emails off in Settings → Notifications.",
  });
}
