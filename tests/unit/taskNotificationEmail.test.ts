import { describe, expect, it } from 'vitest';
import {
  renderTaskNotificationEmail,
  shouldEmailNotification,
  type ClaimedNotificationEmail,
} from '@/supabase-functions/_shared/taskNotificationEmail';

const base: ClaimedNotificationEmail = {
  notification_id: 'n1',
  type: 'task_assigned',
  title: 'Task assigned to you',
  message: 'Sam assigned you to "Fix login" in Website',
  task_id: 't1',
  project_id: 'p1',
  recipient_email: 'ana@x.com',
  recipient_name: 'Ana',
  prefs: {},
  timezone: 'Europe/London',
  task_title: 'Fix login',
  task_due_date: '2026-11-13T00:00:00Z',
  task_priority: 'high',
  task_urgent: true,
  task_status_label: 'In progress',
  project_name: 'Website',
  task_meeting_at: null,
  task_meeting_minutes: null,
};

describe('shouldEmailNotification', () => {
  it('emails task events by default', () => {
    for (const type of ['task_assigned', 'task_updated', 'task_completed', 'task_reminder', 'task_overdue', 'comment_mention', 'comment_added']) {
      expect(shouldEmailNotification(type, {})).toBe(true);
    }
  });

  it('never emails chat messages (would flood inboxes) or your own "task created"', () => {
    expect(shouldEmailNotification('project_chat_message', {})).toBe(false);
    expect(shouldEmailNotification('task_created', {})).toBe(false);
  });

  it("respects the person's Settings choices", () => {
    expect(shouldEmailNotification('task_assigned', { email: false })).toBe(false);
    expect(shouldEmailNotification('task_assigned', { taskAssigned: false })).toBe(false);
    expect(shouldEmailNotification('task_reminder', { taskAssigned: false })).toBe(true);
    expect(shouldEmailNotification('task_reminder', { projectUpdates: false })).toBe(false);
    expect(shouldEmailNotification('task_completed', { taskCompleted: false })).toBe(false);
  });
});

describe('renderTaskNotificationEmail', () => {
  it('names the task in the subject and shows the task form details', () => {
    const e = renderTaskNotificationEmail(base, 'https://taskcalendar.co.uk');
    expect(e.subject).toBe('Task assigned to you: Fix login');
    expect(e.text).toContain('Project: Website');
    expect(e.text).toContain('Status: In progress');
    expect(e.text).toContain('Due: Fri, 13 Nov 2026');
    expect(e.text).toContain('Priority: High');
    expect(e.text).toContain('Urgent');
    expect(e.html).toContain('https://taskcalendar.co.uk/project/p1?taskId=t1');
  });

  it("shows the due date in the person's own time zone", () => {
    const e = renderTaskNotificationEmail(
      { ...base, timezone: 'America/New_York', task_due_date: '2026-11-13T02:00:00Z' },
      'https://taskcalendar.co.uk',
    );
    expect(e.text).toContain('Due: Thu, 12 Nov 2026');
  });

  it('copes with missing details and a bad time zone', () => {
    const e = renderTaskNotificationEmail(
      {
        ...base,
        timezone: 'Not/AZone',
        task_due_date: null,
        task_priority: null,
        task_urgent: false,
        task_status_label: null,
        task_title: null,
      },
      'https://taskcalendar.co.uk',
    );
    expect(e.subject).toBe('Task assigned to you');
    expect(e.text).not.toContain('Due:');
    expect(e.text).not.toContain('Urgent');
  });

  it('escapes task text in the HTML', () => {
    const e = renderTaskNotificationEmail({ ...base, task_title: '<b>x</b>' }, 'https://taskcalendar.co.uk');
    expect(e.html).not.toContain('<b>x</b>');
    expect(e.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('task email look', () => {
  const url = 'https://taskcalendar.co.uk';
  it('labels and colours each kind of email', () => {
    const cases: Array<[Partial<ClaimedNotificationEmail>, string, string]> = [
      [{ type: 'task_assigned' }, 'Assigned', '#c2410c'],
      [{ type: 'task_overdue', title: 'Overdue' }, 'Overdue', '#b91c1c'],
      [{ type: 'task_reminder', title: 'Due tomorrow' }, 'Due soon', '#b45309'],
      [{ type: 'task_reminder', title: 'Meeting in 15 minutes' }, 'Meeting', '#6d28d9'],
      [{ type: 'task_updated', title: '🚨 Task marked urgent' }, 'Urgent', '#b91c1c'],
      [{ type: 'task_completed', title: 'Task completed' }, 'Completed', '#15803d'],
      [{ type: 'comment_mention', title: 'You were mentioned' }, 'Mention', '#1d4ed8'],
    ];
    for (const [patch, label, colour] of cases) {
      const e = renderTaskNotificationEmail({ ...base, ...patch }, url);
      expect(e.html).toContain(label);
      expect(e.html).toContain(colour);
    }
  });

  it("shows the meeting time in the person's time zone", () => {
    const e = renderTaskNotificationEmail(
      { ...base, task_meeting_at: '2026-11-13T15:00:00Z', task_meeting_minutes: 45 },
      url,
    );
    expect(e.text).toContain('Meeting: Fri, 13 Nov 2026, 15:00 · 45 min');
  });

  it('links to email settings and previews the task in the inbox', () => {
    const e = renderTaskNotificationEmail(base, url);
    expect(e.html).toContain('href="https://taskcalendar.co.uk/settings"');
    expect(e.html).toContain('Fix login · Website');
  });
});
