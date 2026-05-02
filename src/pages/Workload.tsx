import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Users, Calendar as CalendarIcon, Settings as SettingsIcon } from 'lucide-react';
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  isAfter,
  isBefore,
  endOfWeek,
} from 'date-fns';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const { tasks, loading: tasksLoading } = useAllTasks();
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

  const heatColor = (count: number, capacityPerDay: number) => {
    if (count === 0) return 'bg-secondary';
    const ratio = capacityPerDay > 0 ? count / capacityPerDay : count;
    if (ratio < 0.5) return 'bg-primary/15';
    if (ratio < 1) return 'bg-primary/30';
    if (ratio < 1.5) return 'bg-primary/55';
    return 'bg-primary/80';
  };

  if (!user) return null;

  return (
    <div className="flex h-screen bg-background pt-12 md:pt-0">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <AppHeader
          left={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Workload
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
          right={
            <div className="flex items-center gap-2">
              <DateRangeFilter
                value={dateRange}
                onChange={onDateRangeChange}
                allowAllTime={false}
              />
              <Button variant="ghost" size="sm" onClick={goPrevWeek} aria-label="Previous week">
                ‹
              </Button>
              <Button variant="ghost" size="sm" onClick={goToday}>
                <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d')}
              </Button>
              <Button variant="ghost" size="sm" onClick={goNextWeek} aria-label="Next week">
                ›
              </Button>
            </div>
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 lg:px-6 py-6 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-base">Team capacity</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Tasks due per assignee for the selected week. Heat reflects load vs daily capacity.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <SettingsIcon className="w-3.5 h-3.5" />
                    <span>Hours per task</span>
                    <Select
                      value={String(hoursPerTask)}
                      onValueChange={(v) => setHoursPerTask(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-24">
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
              </CardHeader>
              <CardContent>
                {capacityError && (
                  <p className="text-sm text-destructive mb-3" role="alert">
                    {capacityError}
                  </p>
                )}
                {tasksLoading || capacityLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Loading workload…
                  </div>
                ) : rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    No team members in this organization yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border">
                        <tr className="text-left">
                          <th className="px-2 py-2 font-medium text-muted-foreground bg-background/95">
                            Member
                          </th>
                          {weekDays.map((d) => (
                            <th
                              key={d.toISOString()}
                              className={cn(
                                'px-2 py-2 text-center font-medium text-muted-foreground',
                                isSameDay(d, new Date()) && 'text-primary',
                              )}
                            >
                              <div className="text-[10px] uppercase">{format(d, 'EEE')}</div>
                              <div>{format(d, 'd')}</div>
                            </th>
                          ))}
                          <th className="px-2 py-2 text-right font-medium text-muted-foreground">
                            Load
                          </th>
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
                              className="border-t border-border hover:bg-secondary/30"
                            >
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Avatar className="w-7 h-7 shrink-0">
                                    <AvatarImage
                                      src={row.member.photoURL}
                                      alt={row.member.displayName}
                                    />
                                    <AvatarFallback className="text-[10px]">
                                      {initialsOf(row.member.displayName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="truncate text-foreground">
                                      {row.member.displayName}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground truncate">
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
                                      onClick={() => {
                                        if (cell.tasks.length === 0) return;
                                        const ymd = format(cell.date, 'yyyy-MM-dd');
                                        navigate(
                                          `/tasks?dueDay=${encodeURIComponent(ymd)}&assigneeId=${encodeURIComponent(row.member.userId)}`,
                                        );
                                      }}
                                      className={cn(
                                        'mx-auto h-9 w-full rounded-md flex items-center justify-center text-xs font-medium border border-transparent',
                                        heatColor(cell.count, capacityPerDay),
                                        cell.isOverdue && 'border-destructive/40',
                                        cell.count > 0 &&
                                          'cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow',
                                        cell.count === 0 && 'cursor-default',
                                      )}
                                    >
                                      {cell.count > 0 ? cell.count : ''}
                                    </button>
                                  </td>
                                );
                              })}
                              <td className="px-2 py-2 text-right">
                                <div
                                  className={cn(
                                    'inline-flex items-center gap-2 text-xs',
                                    loadPct > 100
                                      ? 'text-destructive'
                                      : loadPct > 80
                                        ? 'text-warning'
                                        : 'text-muted-foreground',
                                  )}
                                >
                                  <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
                                    <div
                                      className={cn(
                                        'h-full',
                                        loadPct > 100
                                          ? 'bg-destructive'
                                          : loadPct > 80
                                            ? 'bg-warning'
                                            : 'bg-primary',
                                      )}
                                      style={{ width: `${Math.min(100, loadPct)}%` }}
                                    />
                                  </div>
                                  {loadPct}%
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              Tip: adjust your weekly capacity in{' '}
              <Link
                className="underline hover:text-foreground"
                to="/settings?tab=capacity"
              >
                Settings → Capacity
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Workload;
