import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Users } from 'lucide-react';
import { format, isSameDay, isToday } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/context/OrganizationContext';
import {
  formatDurationSeconds,
  subscribeToTimeEntries,
  type TimeEntry,
} from '@/services/supabase/timeEntries';
import { STALE_SHIFT_HOURS, buildAttendance, summarizeAttendance, type AttendanceStatus } from '@/lib/attendance';
import { LEAVE_TYPE_LABEL, leaveOnDate, todayYmd, type LeaveLike } from '@/lib/leave';

const STATUS: Record<AttendanceStatus, { label: string; tone: StatusTone }> = {
  on_clock: { label: 'On the clock', tone: 'success' },
  out: { label: 'Clocked out', tone: 'neutral' },
  auto_out: { label: 'Clocked out automatically', tone: 'warning' },
  absent: { label: 'Not clocked in', tone: 'muted' },
};

/** Previous / next button inside the joined day navigator. */
const STEP_BUTTON =
  'flex w-11 shrink-0 items-center justify-center bg-background text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 md:w-8';

const hours = (s: number) => (s > 0 ? formatDurationSeconds(s) : '—');
/** A time of the day shown; a time on another day (a shift over midnight) says which day. */
const time = (d: Date | null, day: Date) => (d ? format(d, isSameDay(d, day) ? 'HH:mm' : 'EEE HH:mm') : '—');

/** Team clock-in / clock-out for one day, with this week's totals. */
export const TeamAttendance: React.FC<{
  /** Leave requests; someone on approved leave that day shows as "On leave". */
  leaveRequests?: LeaveLike[];
  /**
   * Limits the team to the people in the selected workspace. Left out, the
   * whole organization is listed.
   */
  inScope?: (userId: string) => boolean;
  /** What to say when `inScope` leaves nobody to list. */
  emptyTitle?: string;
}> = ({ leaveRequests, inScope, emptyTitle }) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? '';
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [day, setDay] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!orgId) return;
    setEntries(null);
    return subscribeToTimeEntries(orgId, setEntries);
  }, [orgId]);

  // Keep "on the clock" hours ticking.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const people = useMemo(
    () =>
      (organization?.members ?? [])
        .filter((m) => m.status !== 'removed' && (!inScope || inScope(m.userId)))
        .map((m) => ({
          userId: m.userId,
          name: m.displayName?.trim() || m.email || 'Member',
          photoURL: m.photoURL,
        })),
    [organization?.members, inScope],
  );

  // Anyone with time this week gets a row even if they are not in the member
  // list, so the entries have to be limited to the workspace as well.
  const scopedEntries = useMemo(
    () => (entries && inScope ? entries.filter((e) => inScope(e.userId)) : entries),
    [entries, inScope],
  );

  const rows = useMemo(
    () => (scopedEntries ? buildAttendance(scopedEntries, people, day, now) : []),
    [scopedEntries, people, day, now],
  );
  const summary = useMemo(() => summarizeAttendance(rows), [rows]);

  const shiftDay = (delta: number) =>
    setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta));
  const viewingToday = isToday(day);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description={`When your team clocked in and out. The clock runs until the person clocks out, also over midnight. A shift nobody clocked out of is closed after ${STALE_SHIFT_HOURS} hours.`}
        actions={
          <>
            {!viewingToday && (
              <Button type="button" variant="ghost" onClick={() => setDay(new Date())}>
                Today
              </Button>
            )}
            <div className="flex h-11 items-stretch overflow-hidden rounded-md border border-input bg-background md:h-8">
              <button
                type="button"
                className={cn(STEP_BUTTON, 'border-r border-input')}
                onClick={() => shiftDay(-1)}
                aria-label="Previous day"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <input
                type="date"
                aria-label="Day"
                value={format(day, 'yyyy-MM-dd')}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(e) => {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  if (y && m && d) setDay(new Date(y, m - 1, d));
                }}
                className="h-full min-w-0 border-0 bg-background px-2.5 text-base font-medium tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:text-sm"
              />
              <button
                type="button"
                className={cn(STEP_BUTTON, 'border-l border-input')}
                onClick={() => shiftDay(1)}
                disabled={viewingToday}
                aria-label="Next day"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        }
      />

      <StatStrip
        items={[
          {
            label: 'On the clock now',
            value: viewingToday ? String(summary.onClock) : '—',
            tone: viewingToday ? 'default' : 'muted',
          },
          {
            label: viewingToday ? 'Clocked in today' : `Clocked in on ${format(day, 'EEE d MMM')}`,
            value: `${summary.clockedIn} / ${summary.teamSize}`,
          },
          { label: 'Team hours', value: hours(summary.totalSeconds) },
        ]}
      />

      <div className="overflow-hidden rounded-lg border border-border">
        {entries === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading attendance" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{emptyTitle ?? 'No team members yet.'}</p>
            {!emptyTitle && (
              <p className="text-xs text-muted-foreground">
                People show up here once they join your organization.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                  <th scope="col" className="px-4 font-medium">Member</th>
                  <th scope="col" className="px-4 font-medium">Status</th>
                  <th scope="col" className="px-4 font-medium">Clock in</th>
                  <th scope="col" className="px-4 font-medium">Clock out</th>
                  <th scope="col" className="px-4 text-right font-medium">Hours</th>
                  <th scope="col" className="px-4 text-right font-medium">This week</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const absent = r.status === 'absent';
                  const onLeave =
                    absent && leaveRequests ? leaveOnDate(leaveRequests, r.userId, todayYmd(day)) : undefined;
                  return (
                    <tr
                      key={r.userId}
                      className={cn(
                        'h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2',
                        absent && 'text-muted-foreground',
                      )}
                    >
                      <td className="px-4">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage src={r.photoURL} alt="" />
                            <AvatarFallback className="text-xs font-semibold">
                              {r.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span
                            className={cn(
                              'max-w-[16rem] truncate font-medium',
                              absent ? 'text-muted-foreground' : 'text-foreground',
                            )}
                            title={r.name}
                          >
                            {r.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4">
                        {onLeave ? (
                          <StatusPill tone="info" title={LEAVE_TYPE_LABEL[onLeave.leaveType]}>
                            On leave
                          </StatusPill>
                        ) : (
                          <StatusPill tone={STATUS[r.status].tone} pulse={r.status === 'on_clock'}>
                            {STATUS[r.status].label}
                          </StatusPill>
                        )}
                      </td>
                      <td className="px-4 tabular-nums">{time(r.firstIn, day)}</td>
                      <td className="px-4 tabular-nums">
                        {r.status === 'on_clock' ? <span className="text-muted-foreground">—</span> : time(r.lastOut, day)}
                        {r.sessions > 1 && (
                          <span className="ml-1.5 text-xs text-muted-foreground">({r.sessions} sessions)</span>
                        )}
                      </td>
                      <td className={cn('px-4 text-right font-medium tabular-nums', !absent && 'text-foreground')}>
                        {hours(r.daySeconds)}
                      </td>
                      <td className="px-4 text-right tabular-nums text-muted-foreground">{hours(r.weekSeconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
