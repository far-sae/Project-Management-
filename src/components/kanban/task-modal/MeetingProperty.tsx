import React, { useEffect, useId, useState } from 'react';
import { CalendarPlus, Pencil, Trash2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
import { GHOST_FIELD, PRESS } from './styles';

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

const CHIP_STYLES: Record<MeetingStatusKind, string> = {
  upcoming: 'bg-muted text-muted-foreground',
  soon: 'bg-warning-soft text-warning-soft-foreground',
  live: 'bg-success-soft text-success-soft-foreground',
  ended: 'bg-muted text-muted-foreground',
};

/** "Meeting" property: schedule / edit / remove a TaskCalendar meeting and join it. */
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
      <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-2">
        <span id={labelId} className="flex h-10 md:h-8 items-center text-[13px] text-muted-foreground">
          Meeting
        </span>
        {readOnly ? (
          <span className="px-2 text-sm text-muted-foreground">None</span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-describedby={hintId}
            onClick={schedule}
            className={cn(GHOST_FIELD, PRESS, 'text-muted-foreground hover:text-foreground')}
          >
            <CalendarPlus aria-hidden />
            Schedule meeting
          </Button>
        )}
        <span id={hintId} className="sr-only">
          Adds a TaskCalendar video call to this task. Assignees are notified and reminded 15 minutes before.
        </span>
      </div>
    );
  }

  // ── Meeting set ──────────────────────────────────────────────
  const status = getMeetingStatus(startsAt, duration, now);
  const summary = formatMeetingSummary(startsAt, duration, now);

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <div className="flex h-10 md:h-8 items-center justify-between gap-2">
        <span id={labelId} className="text-[13px] text-muted-foreground">
          Meeting
        </span>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
            className={cn('h-10 md:h-8 min-h-0 px-2 text-xs text-muted-foreground hover:text-foreground', PRESS)}
          >
            <Pencil aria-hidden className="!size-3.5" />
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 text-sm font-medium text-foreground tabular-nums" title={startsAt.toString()}>
            {summary}
          </p>
          <span
            className={cn(
              'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium tabular-nums',
              CHIP_STYLES[status.kind],
            )}
            aria-live="polite"
          >
            {status.kind === 'live' && (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            )}
            {status.label}
          </span>
        </div>

        {editing && !readOnly && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
              <label htmlFor={dayId} className="text-xs text-muted-foreground">
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
                className={cn(GHOST_FIELD, 'border-border bg-background')}
              />
              <label htmlFor={timeId} className="text-xs text-muted-foreground">
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
                className="h-10 md:h-8 rounded-md px-2 text-base md:text-sm tabular-nums transition-colors"
              />
              <label htmlFor={durationId} className="text-xs text-muted-foreground">
                Duration
              </label>
              <Select
                value={String(duration)}
                onValueChange={(v) => onChange(startsAt, Number(v))}
              >
                <SelectTrigger
                  id={durationId}
                  className="h-10 md:h-8 rounded-md px-2 text-base md:text-sm tabular-nums transition-colors"
                >
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
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null, null)}
              className={cn(
                'h-10 md:h-8 min-h-0 w-full justify-start px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive',
                PRESS,
              )}
            >
              <Trash2 aria-hidden className="!size-3.5" />
              Remove meeting
            </Button>
          </div>
        )}

        {isSaved ? (
          <div className="space-y-1.5">
            {/* Disabled buttons swallow pointer events, so the tooltip lives on a wrapper. */}
            <span className="block" title={joinDisabledReason ?? undefined}>
              <Button
                type="button"
                size="sm"
                onClick={onJoin}
                disabled={joinDisabledReason !== null}
                aria-describedby={hintId}
                className={cn('w-full gap-2', PRESS)}
              >
                <Video aria-hidden />
                Join meeting
              </Button>
            </span>
            <p id={hintId} className="text-xs leading-snug text-muted-foreground">
              {joinDisabledReason ? `${joinDisabledReason} ` : ''}
              Opens a TaskCalendar video call for this task. Invite people outside your team from inside the call.
            </p>
          </div>
        ) : (
          <p id={hintId} className="text-xs leading-snug text-muted-foreground">
            You can join the video call once the task is created. Assignees get a reminder 15 min before.
          </p>
        )}
      </div>
    </div>
  );
};

export default MeetingProperty;
