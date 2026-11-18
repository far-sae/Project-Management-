import React, { useEffect, useId, useState } from 'react';
import { CalendarPlus, Pencil, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import { DayPickerPopover } from '../DayPickerPopover';
import {
  DEFAULT_MEETING_DURATION,
  MEETING_DURATIONS,
  formatMeetingDuration,
  formatMeetingSummary,
  getMeetingStatus,
  nextFullHour,
  toTimeInputValue,
  withDay,
  withTime,
  type MeetingStatusKind,
} from './meeting';
import {
  GHOST_FIELD, PRESS, PROPERTY_GRID, PROPERTY_LABEL, PROPERTY_TEXT, PROPERTY_VALUE,
} from './styles';

export interface MeetingPropertyProps {
  startsAt: Date | null;
  durationMinutes: number | null;
  /** Both null = remove the meeting. */
  onChange: (startsAt: Date | null, durationMinutes: number | null) => void;
  /** No editing (locked / viewer / member without rights). Join stays available. */
  readOnly: boolean;
  /** True for a saved task — only then can the call be joined. */
  isSaved: boolean;
  /** Reason the Join button is disabled, or null when it is usable. */
  joinDisabledReason: string | null;
  onJoin: () => void;
  /** Injected clock so the status chip can tick without its own timer. */
  now: Date;
}

const STATUS_TONES: Record<MeetingStatusKind, StatusTone> = {
  upcoming: 'muted',
  soon: 'warning',
  live: 'success',
  ended: 'muted',
};

/**
 * "Meeting" property: schedule / edit / remove a TaskCalendar meeting and join it.
 *
 * Renders rows for the properties panel grid, so it must sit inside a
 * `PROPERTY_GRID` container: every label and value lines up with the other
 * properties.
 */
export const MeetingProperty: React.FC<MeetingPropertyProps> = ({
  startsAt,
  durationMinutes,
  onChange,
  readOnly,
  isSaved,
  joinDisabledReason,
  onJoin,
  now,
}) => {
  const uid = useId();
  const labelId = `${uid}-label`;
  const dayId = `${uid}-day`;
  const timeId = `${uid}-time`;
  const durationId = `${uid}-duration`;
  const hintId = `${uid}-hint`;

  const [editing, setEditing] = useState(false);
  // Draft for the time input: committed on blur / Enter so a half-typed
  // time doesn't reschedule the meeting (and re-notify people) per keystroke.
  const [timeDraft, setTimeDraft] = useState(startsAt ? toTimeInputValue(startsAt) : '');

  useEffect(() => {
    setTimeDraft(startsAt ? toTimeInputValue(startsAt) : '');
  }, [startsAt?.getTime()]);

  useEffect(() => {
    if (!startsAt || readOnly) setEditing(false);
  }, [startsAt === null, readOnly]);

  const duration = durationMinutes ?? DEFAULT_MEETING_DURATION;
  const durationOptions: number[] = (MEETING_DURATIONS as readonly number[]).includes(duration)
    ? [...MEETING_DURATIONS]
    : [...MEETING_DURATIONS, duration].sort((a, b) => a - b);

  const schedule = () => {
    onChange(nextFullHour(new Date()), DEFAULT_MEETING_DURATION);
    setEditing(true);
  };

  const commitTime = () => {
    if (!startsAt) return;
    const next = withTime(startsAt, timeDraft);
    if (!next) {
      setTimeDraft(toTimeInputValue(startsAt));
      return;
    }
    if (next.getTime() !== startsAt.getTime()) onChange(next, duration);
  };

  // ── No meeting ───────────────────────────────────────────────
  if (!startsAt) {
    return (
      <>
        <span id={labelId} className={PROPERTY_LABEL}>
          Meeting
        </span>
        <div className={PROPERTY_VALUE}>
          {readOnly ? (
            <span className="px-2 text-[13px] text-muted-foreground">None</span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              aria-describedby={hintId}
              onClick={schedule}
              className={cn(
                GHOST_FIELD,
                PRESS,
                'justify-start font-normal text-muted-foreground hover:text-foreground',
              )}
            >
              <CalendarPlus aria-hidden />
              Schedule meeting
            </Button>
          )}
          <span id={hintId} className="sr-only">
            Adds a TaskCalendar video call to this task. Assignees are notified and reminded 15 minutes before.
          </span>
        </div>
      </>
    );
  }

  // ── Meeting set ──────────────────────────────────────────────
  const status = getMeetingStatus(startsAt, duration, now);
  const summary = formatMeetingSummary(startsAt, duration, now);

  return (
    <div role="group" aria-labelledby={labelId} className={cn(PROPERTY_GRID, 'col-span-2')}>
      <span id={labelId} className={PROPERTY_LABEL}>
        Meeting
      </span>
      <div className={PROPERTY_TEXT}>
        <p
          className="min-w-0 py-1.5 font-medium text-foreground tabular-nums [text-wrap:balance]"
          title={startsAt.toString()}
        >
          {summary}
        </p>
      </div>

      <div className="col-start-2 flex min-h-11 min-w-0 items-center justify-between gap-2 pl-2 md:min-h-8">
        <span aria-live="polite" className="inline-flex min-w-0">
          <StatusPill
            tone={STATUS_TONES[status.kind]}
            dot={status.kind === 'live'}
            pulse={status.kind === 'live'}
            className="tabular-nums"
          >
            {status.label}
          </StatusPill>
        </span>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
            className={cn('shrink-0 text-muted-foreground hover:text-foreground', PRESS)}
          >
            <Pencil aria-hidden className="!size-3.5" />
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>

      {editing && !readOnly && (
        <>
          <label htmlFor={dayId} className={cn(PROPERTY_LABEL, 'cursor-pointer')}>
            Day
          </label>
          <DayPickerPopover
            id={dayId}
            value={startsAt}
            placeholder="Pick a day"
            onChange={(d) => {
              // Clearing the day (popover "Clear" / ×) removes the meeting.
              if (!d) onChange(null, null);
              else onChange(withDay(startsAt, d), duration);
            }}
            className="w-full tabular-nums"
          />
          <label htmlFor={timeId} className={cn(PROPERTY_LABEL, 'cursor-pointer')}>
            Start
          </label>
          <Input
            id={timeId}
            type="time"
            step={300}
            value={timeDraft}
            onChange={(e) => setTimeDraft(e.target.value)}
            onBlur={commitTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTime();
              }
            }}
            className="px-2 tabular-nums"
          />
          <label htmlFor={durationId} className={cn(PROPERTY_LABEL, 'cursor-pointer')}>
            Duration
          </label>
          <Select
            value={String(duration)}
            onValueChange={(v) => onChange(startsAt, Number(v))}
          >
            <SelectTrigger id={durationId} className="px-2 tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationOptions.map((m) => (
                <SelectItem key={m} value={String(m)} className="tabular-nums">
                  {formatMeetingDuration(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(null, null)}
            className={cn(
              'col-start-2 justify-start px-2 text-destructive hover:bg-destructive/10 hover:text-destructive',
              PRESS,
            )}
          >
            <Trash2 aria-hidden />
            Remove meeting
          </Button>
        </>
      )}

      <div className="col-start-2 min-w-0 space-y-1.5">
        {isSaved && (
          // Disabled buttons swallow pointer events, so the tooltip lives on a wrapper.
          <span className="block" title={joinDisabledReason ?? undefined}>
            <Button
              type="button"
              onClick={onJoin}
              disabled={joinDisabledReason !== null}
              aria-describedby={hintId}
              className={cn('w-full', PRESS)}
            >
              <Video aria-hidden />
              Join meeting
            </Button>
          </span>
        )}
        <p id={hintId} className="px-2 pb-1 text-xs leading-snug text-muted-foreground">
          {isSaved ? (
            <>
              {joinDisabledReason ? `${joinDisabledReason} ` : ''}
              Opens a TaskCalendar video call for this task. Invite people outside your team from inside the call.
            </>
          ) : (
            'You can join the video call once the task is created. Assignees get a reminder 15 min before.'
          )}
        </p>
      </div>
    </div>
  );
};

export default MeetingProperty;
