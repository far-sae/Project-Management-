import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Loader2,
  Users,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  isAfter,
  isBefore,
  endOfWeek,
} from 'date-fns';

import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useAllTasks } from '@/hooks/useAllTasks';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  fetchUserCapacities,
  DEFAULT_HOURS_PER_WEEK,
} from '@/services/supabase/capacity';
import type { Task } from '@/types';
import type { OrganizationMember } from '@/types/organization';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import {
  DateRangeFilter,
  DateRangeValue,
} from '@/components/common/DateRangeFilter';

interface WorkloadCell {
  date: Date;
  count: number;
  isOverdue: boolean;
  tasks: Task[];
}

interface MemberWorkload {
  member: OrganizationMember;
  cells: WorkloadCell[];
  weekTotal: number;
  capacityHoursPerWeek: number;
  /** Estimated hours used; we treat each task as ~4 hours by default. */
  estimatedHours: number;
}

const HOURS_PER_TASK_DEFAULT = 4;

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

export const Workload: React.FC = () => {
  const { user } = useAuth();
  const { organization, isAdmin } = useOrganization();
  const { tasks: allTasks, loading: tasksLoading } = useAllTasks();
  const { filterTasks } = useSelectedWorkspace();
  const tasks = useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);
  const navigate = useNavigate();
  // Owner + admin see the whole team's workload (planning view).
  // Plain members see only their own row — they shouldn't be able to peek at
  // colleagues' load. `isAdmin` from the org context already includes owner.
  const canSeeAllWorkloads = isAdmin;

  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const ws = startOfWeek(new Date(), { weekStartsOn: 1 });
    return {
      preset: 'custom',
      start: ws,
      end: endOfWeek(ws, { weekStartsOn: 1 }),
    };
  });

  const navigateToWeek = useCallback((anchor: Date) => {
    const ws = startOfWeek(anchor, { weekStartsOn: 1 });
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    setWeekStart(ws);
    setDateRange({ preset: 'custom', start: ws, end: we });
  }, []);

  // Presets / custom picks: align the heatmap week and the date-range label to
  // the same Monday–Sunday window (avoids "Last 7 days" showing a mismatched week).
  const onDateRangeChange = (next: DateRangeValue) => {
    if (next.preset === 'all' || !next.start) {
      setDateRange(next);
      if (next.start) navigateToWeek(next.start);
      return;
    }
    navigateToWeek(next.start);
  };
  const [capacityMap, setCapacityMap] = useState<Map<string, number>>(new Map());
  const [hoursPerTask, setHoursPerTask] = useState<number>(HOURS_PER_TASK_DEFAULT);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  const members = useMemo<OrganizationMember[]>(
    () => {
      const all = organization?.members ?? [];
      if (canSeeAllWorkloads) return all;
      // Member view: just their own row.
      return all.filter((m) => m.userId === user?.userId);
    },
    [organization?.members, canSeeAllWorkloads, user?.userId],
  );

  useEffect(() => {
    if (members.length === 0) return;
    let cancelled = false;
    setCapacityLoading(true);
    setCapacityError(null);
    fetchUserCapacities(members.map((m) => m.userId))
      .then((map) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const m of members) {
          next.set(
            m.userId,
            map.get(m.userId)?.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK,
          );
        }
        setCapacityMap(next);
        setCapacityError(null);
      })
      .catch((err: unknown) => {
        logger.warn('Workload: fetchUserCapacities failed:', err);
        const msg =
          err instanceof Error ? err.message : 'Could not load capacity settings';
        if (!cancelled) {
          setCapacityError(msg);
          toast.error(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setCapacityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [members]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);

  const rows: MemberWorkload[] = useMemo(() => {
    return members.map((m) => {
      const tasksInWeek = tasks.filter((t: Task) => {
        if (!t.dueDate) return false;
        const isAssigned = t.assignees?.some((a) => a.userId === m.userId);
        if (!isAssigned) return false;
        const due = new Date(t.dueDate);
        return !isBefore(due, weekStart) && !isAfter(due, weekEnd);
      });
      const cells = weekDays.map((day) => {
        const dayTasks = tasksInWeek.filter((t) =>
          t.dueDate ? isSameDay(new Date(t.dueDate), day) : false,
        );
        const isOverdue = dayTasks.some(
          (t) =>
            t.status !== 'done' &&
            t.dueDate &&
            isBefore(new Date(t.dueDate), new Date()) &&
            !isSameDay(new Date(t.dueDate), new Date()),
        );
        return {
          date: day,
          count: dayTasks.length,
          isOverdue,
          tasks: dayTasks,
        };
      });
      const weekTotal = cells.reduce((sum, c) => sum + c.count, 0);
      const capacityHoursPerWeek =
        capacityMap.get(m.userId) ?? DEFAULT_HOURS_PER_WEEK;
      const estimatedHours = weekTotal * hoursPerTask;
      return {
        member: m,
        cells,
        weekTotal,
        capacityHoursPerWeek,
        estimatedHours,
      };
    });
  }, [members, tasks, weekDays, weekStart, weekEnd, capacityMap, hoursPerTask]);

  const goPrevWeek = () => navigateToWeek(addDays(weekStart, -7));
  const goNextWeek = () => navigateToWeek(addDays(weekStart, 7));
  const goToday = () => navigateToWeek(new Date());

  // Neutral greys get darker as the day fills up; red is kept for a day that
  // is well over what the person can take on.
  const heatColor = (count: number, capacityPerDay: number) => {
    if (count === 0) return 'bg-foreground/[0.04] text-muted-foreground';
    const ratio = capacityPerDay > 0 ? count / capacityPerDay : count;
    if (ratio < 0.5) return 'bg-foreground/10 text-foreground';
    if (ratio < 1) return 'bg-foreground/20 text-foreground';
    if (ratio < 1.5) return 'bg-foreground/[0.32] text-foreground';
    return 'bg-destructive-soft text-destructive-soft-foreground border-destructive/30';
  };

  if (!user) return null;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <AppHeader left={<span className="text-sm font-semibold">Workload</span>} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
          <PageHeader
            title="Workload"
            description="Tasks due per assignee for the selected week. Heat reflects load vs daily capacity."
            actions={
              <>
                <DateRangeFilter
                  value={dateRange}
                  onChange={onDateRangeChange}
                  allowAllTime={false}
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-[40px] px-0 text-muted-foreground md:min-w-7"
                    onClick={goPrevWeek}
                    aria-label="Previous week"
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button variant="outline" size="sm" className="tabular-nums" onClick={goToday}>
                    <CalendarIcon aria-hidden />
                    {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-[40px] px-0 text-muted-foreground md:min-w-7"
                    onClick={goNextWeek}
                    aria-label="Next week"
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </>
            }
          />

          <section className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-1.5">
              <h2 className="text-sm font-semibold text-foreground">Team capacity</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span id="workload-hours-per-task">Hours per task</span>
                <Select
                  value={String(hoursPerTask)}
                  onValueChange={(v) => setHoursPerTask(Number(v))}
                >
                  <SelectTrigger className="w-20" aria-labelledby="workload-hours-per-task">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 6, 8].map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h}h
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {capacityError && (
              <p className="border-b border-border px-4 py-2.5 text-sm text-destructive" role="alert">
                {capacityError}
              </p>
            )}
            {tasksLoading || capacityLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading workload…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium text-foreground">
                  No team members in this organization yet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="h-10 border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
                      <th className="px-4 font-medium">Member</th>
                      {weekDays.map((d) => (
                        <th
                          key={d.toISOString()}
                          className={cn(
                            'px-1.5 text-center font-medium',
                            isSameDay(d, new Date()) && 'font-semibold text-foreground',
                          )}
                        >
                          <div>{format(d, 'EEE')}</div>
                          <div className="tabular-nums">{format(d, 'd')}</div>
                        </th>
                      ))}
                      <th className="px-4 text-right font-medium">Load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const capacityPerDay =
                        row.capacityHoursPerWeek > 0 && hoursPerTask > 0
                          ? row.capacityHoursPerWeek / hoursPerTask / 5
                          : 1;
                      const loadPct = Math.min(
                        999,
                        Math.round(
                          row.capacityHoursPerWeek > 0
                            ? (row.estimatedHours / row.capacityHoursPerWeek) * 100
                            : 0,
                        ),
                      );
                      return (
                        <tr
                          key={row.member.userId}
                          className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                        >
                          <td className="px-4 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarImage
                                  src={row.member.photoURL}
                                  alt={row.member.displayName}
                                />
                                <AvatarFallback className="bg-primary-soft text-[0.6875rem] font-medium text-primary-soft-foreground">
                                  {initialsOf(row.member.displayName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {row.member.displayName}
                                </p>
                                <p className="truncate text-xs tabular-nums text-muted-foreground">
                                  {row.capacityHoursPerWeek}h/week
                                </p>
                              </div>
                            </div>
                          </td>
                          {row.cells.map((cell) => {
                            const tip =
                              cell.tasks.length === 0
                                ? undefined
                                : cell.tasks
                                    .slice(0, 8)
                                    .map((t) => t.title)
                                    .join(' · ') +
                                  (cell.tasks.length > 8
                                    ? ` (+${cell.tasks.length - 8} more)`
                                    : '');
                            return (
                              <td
                                key={cell.date.toISOString()}
                                className="px-1.5 py-2 text-center"
                              >
                                <button
                                  type="button"
                                  disabled={cell.count === 0}
                                  title={tip}
                                  aria-label={`${row.member.displayName}, ${format(cell.date, 'EEE MMM d')}: ${cell.count} task${cell.count === 1 ? '' : 's'} due`}
                                  onClick={() => {
                                    if (cell.tasks.length === 0) return;
                                    const ymd = format(cell.date, 'yyyy-MM-dd');
                                    navigate(
                                      `/tasks?dueDay=${encodeURIComponent(ymd)}&assigneeId=${encodeURIComponent(row.member.userId)}`,
                                    );
                                  }}
                                  className={cn(
                                    'mx-auto flex h-8 w-full min-w-9 items-center justify-center rounded-md border border-transparent text-xs font-medium tabular-nums',
                                    heatColor(cell.count, capacityPerDay),
                                    cell.isOverdue && 'border-destructive/50',
                                    cell.count > 0 &&
                                      'cursor-pointer transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    cell.count === 0 && 'cursor-default',
                                  )}
                                >
                                  {cell.count > 0 ? cell.count : ''}
                                </button>
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right">
                            <div
                              className={cn(
                                'inline-flex items-center gap-2 text-xs tabular-nums',
                                loadPct > 100
                                  ? 'font-medium text-destructive'
                                  : loadPct > 80
                                    ? 'font-medium text-warning-soft-foreground'
                                    : 'text-muted-foreground',
                              )}
                            >
                              <div className="h-1 w-24 overflow-hidden rounded-full bg-foreground/10">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    loadPct > 100 ? 'bg-destructive' : 'bg-foreground/70',
                                  )}
                                  style={{ width: `${Math.min(100, loadPct)}%` }}
                                />
                              </div>
                              <span className="min-w-[2.75rem] text-right">{loadPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Tip: adjust your weekly capacity in{' '}
            <Link
              className="underline underline-offset-2 hover:text-foreground"
              to="/settings?tab=capacity"
            >
              Settings → Capacity
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
};

export default Workload;
