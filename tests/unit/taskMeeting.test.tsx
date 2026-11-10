// tests/unit/taskMeeting.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  formatMeetingDuration,
  formatMeetingSummary,
  getJoinDisabledReason,
  getMeetingStatus,
  nextFullHour,
  toMeetingDate,
  withDay,
  withTime,
} from '@/components/kanban/task-modal/meeting';
import { MeetingProperty } from '@/components/kanban/task-modal/MeetingProperty';

afterEach(cleanup);

// Local-time dates so the assertions hold in any TZ.
const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m, 0, 0); // Nov 2026

describe('getMeetingStatus', () => {
  const start = at(15);

  it('says "In 2 h" two hours out', () => {
    expect(getMeetingStatus(start, 30, at(13))).toEqual({ kind: 'upcoming', label: 'In 2 h' });
  });

  it('uses minutes under an hour and days beyond a day', () => {
    expect(getMeetingStatus(start, 30, at(14, 20)).label).toBe('In 40 min');
    expect(getMeetingStatus(start, 30, at(15, 0, 10)).label).toBe('In 3 days');
    expect(getMeetingStatus(start, 30, at(14, 30, 12)).label).toBe('In 1 day');
  });

  it('says "Starting soon" within 15 minutes', () => {
    expect(getMeetingStatus(start, 30, at(14, 45)).kind).toBe('soon');
    expect(getMeetingStatus(start, 30, at(14, 59)).label).toBe('Starting soon');
  });

  it('says "Live now" between start and start + duration', () => {
    expect(getMeetingStatus(start, 30, at(15)).label).toBe('Live now');
    expect(getMeetingStatus(start, 30, at(15, 29)).kind).toBe('live');
    expect(getMeetingStatus(start, 90, at(16, 15)).kind).toBe('live');
  });

  it('says "Ended" once the duration has passed (defaults to 30 min)', () => {
    expect(getMeetingStatus(start, 30, at(15, 30)).label).toBe('Ended');
    expect(getMeetingStatus(start, null, at(15, 31)).kind).toBe('ended');
  });
});

describe('formatMeetingSummary', () => {
  it('formats day · time · duration in local time', () => {
    expect(formatMeetingSummary(at(15), 30, at(9))).toBe('Fri 13 Nov · 15:00 · 30 min');
    expect(formatMeetingSummary(at(9, 5), 90, at(9))).toBe('Fri 13 Nov · 09:05 · 1 h 30 min');
  });

  it('adds the year when it differs from now', () => {
    expect(formatMeetingSummary(new Date(2027, 0, 4, 8, 0), 60, at(9))).toBe('Mon 4 Jan 2027 · 08:00 · 1 h');
  });

  it('formats durations', () => {
    expect(formatMeetingDuration(15)).toBe('15 min');
    expect(formatMeetingDuration(60)).toBe('1 h');
    expect(formatMeetingDuration(null)).toBe('30 min');
  });
});

describe('date helpers', () => {
  it('nextFullHour rounds up to the next hour', () => {
    expect(nextFullHour(at(14, 20)).getTime()).toBe(at(15).getTime());
    expect(nextFullHour(at(14, 0)).getTime()).toBe(at(15).getTime());
  });

  it('withTime / withDay keep the other half intact', () => {
    expect(withTime(at(15), '09:30')?.getTime()).toBe(at(9, 30).getTime());
    expect(withTime(at(15), '25:00')).toBeNull();
    expect(withTime(at(15), '')).toBeNull();
    expect(withDay(at(15, 45), at(0, 0, 20)).getTime()).toBe(at(15, 45, 20).getTime());
  });

  it('toMeetingDate normalises stored values', () => {
    expect(toMeetingDate(null)).toBeNull();
    expect(toMeetingDate('not a date')).toBeNull();
    expect(toMeetingDate(at(15).toISOString())?.getTime()).toBe(at(15).getTime());
  });
});

describe('getJoinDisabledReason', () => {
  const ok = { isSaved: true, inCall: false, isViewer: false, mediaSupported: true };
  it('is null when everything is fine', () => {
    expect(getJoinDisabledReason(ok)).toBeNull();
  });
  it('explains each blocker', () => {
    expect(getJoinDisabledReason({ ...ok, isSaved: false })).toMatch(/create the task/i);
    expect(getJoinDisabledReason({ ...ok, isViewer: true })).toMatch(/view-only/i);
    expect(getJoinDisabledReason({ ...ok, inCall: true })).toMatch(/already in a call/i);
    expect(getJoinDisabledReason({ ...ok, mediaSupported: false })).toMatch(/camera or microphone/i);
  });
});

describe('<MeetingProperty />', () => {
  const base = {
    durationMinutes: null,
    readOnly: false,
    isSaved: true,
    joinDisabledReason: null,
    now: at(13),
  };

  it('schedules a meeting at the next full hour for 30 minutes', () => {
    const onChange = vi.fn();
    render(<MeetingProperty {...base} startsAt={null} onChange={onChange} onJoin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [startsAt, duration] = onChange.mock.calls[0];
    expect(duration).toBe(30);
    expect((startsAt as Date).getMinutes()).toBe(0);
    expect((startsAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('shows the summary + status chip and joins on click', () => {
    const onJoin = vi.fn();
    render(
      <MeetingProperty {...base} startsAt={at(15)} durationMinutes={30} onChange={vi.fn()} onJoin={onJoin} />,
    );
    expect(screen.getByText('Fri 13 Nov · 15:00 · 30 min')).toBeTruthy();
    expect(screen.getByText('In 2 h')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /join meeting/i }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('disables Join with the reason, and hides editing when read-only', () => {
    const onJoin = vi.fn();
    render(
      <MeetingProperty
        {...base}
        readOnly
        startsAt={at(15)}
        joinDisabledReason="You are already in a call. Leave it to join this meeting."
        onChange={vi.fn()}
        onJoin={onJoin}
      />,
    );
    const join = screen.getByRole('button', { name: /join meeting/i }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    expect(screen.getByText(/already in a call/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('removes the meeting from the editor', () => {
    const onChange = vi.fn();
    render(<MeetingProperty {...base} startsAt={at(15)} onChange={onChange} onJoin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove meeting/i }));
    expect(onChange).toHaveBeenCalledWith(null, null);
  });

  it('has no Join button before the task is saved', () => {
    render(
      <MeetingProperty {...base} isSaved={false} startsAt={at(15)} onChange={vi.fn()} onJoin={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /join meeting/i })).toBeNull();
  });
});
