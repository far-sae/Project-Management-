import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Loader2, Timer, Users } from 'lucide-react';
import { format, isToday } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/context/OrganizationContext';
import {
  formatDurationSeconds,
  subscribeToTimeEntries,
  type TimeEntry,
} from '@/services/supabase/timeEntries';
import { buildAttendance, summarizeAttendance, type AttendanceStatus } from '@/lib/attendance';

const STATUS: Record<AttendanceStatus, { label: string; className: string }> = {
  on_clock: { label: 'On the clock', className: 'bg-success-soft text-success-soft-foreground' },
  out: { label: 'Clocked out', className: 'bg-secondary text-secondary-foreground' },
  auto_out: { label: 'Auto clocked out (9h)', className: 'bg-warning-soft text-warning-soft-foreground' },
  absent: { label: 'Not clocked in', className: 'bg-muted text-muted-foreground' },
};

const hours = (s: number) => (s > 0 ? formatDurationSeconds(s) : '—');
const time = (d: Date | null) => (d ? format(d, 'HH:mm') : '—');

/** Team clock-in / clock-out for one day, with this week's totals. */
export const TeamAttendance: React.FC = () => {
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
        .filter((m) => m.status !== 'removed')
        .map((m) => ({
          userId: m.userId,
          name: m.displayName?.trim() || m.email || 'Member',
          photoURL: m.photoURL,
        })),
    [organization?.members],
  );

  const rows = useMemo(
    () => (entries ? buildAttendance(entries, people, day, now) : []),
    [entries, people, day, now],
  );
  const summary = useMemo(() => summarizeAttendance(rows), [rows]);

  const shiftDay = (delta: number) =>
    setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta));
  const viewingToday = isToday(day);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Attendance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            When your team clocked in and out. Anyone still clocked in after 9 hours is clocked out
            automatically.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 active:scale-[0.97]"
            onClick={() => shiftDay(-1)}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <input
            type="date"
            aria-label="Day"
            value={format(day, 'yyyy-MM-dd')}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (y && m && d) setDay(new Date(y, m - 1, d));
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-base tabular-nums md:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 active:scale-[0.97]"
            onClick={() => shiftDay(1)}
            disabled={viewingToday}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          {!viewingToday && (
            <Button type="button" variant="ghost" className="h-9" onClick={() => setDay(new Date())}>
              Today
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile icon={<Timer className="h-4 w-4" aria-hidden />} label="On the clock now" value={viewingToday ? String(summary.onClock) : '—'} />
        <SummaryTile
          icon={<Users className="h-4 w-4" aria-hidden />}
          label={viewingToday ? 'Clocked in today' : `Clocked in on ${format(day, 'EEE d MMM')}`}
          value={`${summary.clockedIn} / ${summary.teamSize}`}
        />
        <SummaryTile icon={<Clock className="h-4 w-4" aria-hidden />} label="Team hours" value={hours(summary.totalSeconds)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {entries === null ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading attendance" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No team members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Member</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Clock in</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Clock out</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Hours</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">This week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.userId} className={cn(r.status === 'absent' && 'text-muted-foreground')}>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar className="h-7 w-7 shrink-0">
                          <AvatarImage src={r.photoURL} alt="" />
                          <AvatarFallback className="text-[11px]">{r.name.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium text-foreground" title={r.name}>
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', STATUS[r.status].className)}>
                        {r.status === 'on_clock' && (
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
                        )}
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{time(r.firstIn)}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {r.status === 'on_clock' ? <span className="text-muted-foreground">—</span> : time(r.lastOut)}
                      {r.sessions > 1 && (
                        <span className="ml-1.5 text-xs text-muted-foreground">({r.sessions} sessions)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">{hours(r.daySeconds)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{hours(r.weekSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-xl border border-border bg-card px-4 py-3">
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      {label}
    </p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
  </div>
);
