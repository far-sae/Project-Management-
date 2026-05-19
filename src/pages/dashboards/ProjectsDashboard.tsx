import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, startOfDay, differenceInDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ArrowRight, FolderKanban, Loader2 } from 'lucide-react';
import { useAllTasks } from '@/hooks/useAllTasks';
import { useProjects } from '@/hooks/useProjects';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { Task, DEFAULT_COLUMNS } from '@/types';

import { KpiTile } from '@/components/dashboards/KpiTile';
import { ChartCard } from '@/components/dashboards/ChartCard';
import { StatusDonut, DonutLegend, type DonutDatum } from '@/components/dashboards/StatusDonut';
import { StackedBar } from '@/components/dashboards/StackedBar';
import { BarHorizontal } from '@/components/dashboards/BarHorizontal';
import { palette } from '@/components/dashboards/palette';

type Range = '7d' | '30d' | '90d';
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  DEFAULT_COLUMNS.map((c) => [c.id, c.title]),
);

const isCompleted = (t: Task) => t.status === 'done';
const isOverdue = (t: Task) =>
  !!t.dueDate && !isCompleted(t) && t.dueDate.getTime() < Date.now();

export const ProjectsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { tasks, loading: tasksLoading } = useAllTasks();
  const { projects } = useProjects();
  const { selectedId: selectedWorkspaceId, isAll, isUnassigned } = useSelectedWorkspace();

  const [range, setRange] = useState<Range>('30d');

  // Apply the same workspace filter the sidebar uses so the dashboard reflects
  // the user's current scope. Tasks filtered transitively via project.
  const visibleProjectIds = useMemo(() => {
    if (isAll) return new Set(projects.map((p) => p.projectId));
    if (isUnassigned) {
      return new Set(projects.filter((p) => !p.workspaceId).map((p) => p.projectId));
    }
    return new Set(
      projects.filter((p) => p.workspaceId === selectedWorkspaceId).map((p) => p.projectId),
    );
  }, [projects, selectedWorkspaceId, isAll, isUnassigned]);

  const scopedTasks = useMemo(
    () => tasks.filter((t) => visibleProjectIds.has(t.projectId)),
    [tasks, visibleProjectIds],
  );

  // ── KPI calculations ──────────────────────────────────────────────────────
  const now = new Date();
  const rangeStart = subDays(now, RANGE_DAYS[range]);
  const prevStart = subDays(rangeStart, RANGE_DAYS[range]);

  const activeCount = scopedTasks.filter((t) => !isCompleted(t)).length;
  const overdueCount = scopedTasks.filter(isOverdue).length;
  const completedInRange = scopedTasks.filter(
    (t) => isCompleted(t) && t.completedAt && t.completedAt >= rangeStart,
  );
  const completedPrev = scopedTasks.filter(
    (t) => isCompleted(t) && t.completedAt && t.completedAt >= prevStart && t.completedAt < rangeStart,
  );
  const completedDelta =
    completedPrev.length === 0
      ? null
      : ((completedInRange.length - completedPrev.length) / completedPrev.length) * 100;

  const cycleDays = completedInRange
    .map((t) => (t.completedAt && t.createdAt ? differenceInDays(t.completedAt, t.createdAt) : null))
    .filter((d): d is number => d !== null && d >= 0);
  const avgCycle = cycleDays.length === 0 ? 0 : cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length;

  // ── Sparklines (last 14 days) ─────────────────────────────────────────────
  const sparkDays = 14;
  const dayBuckets = useMemo(() => {
    const buckets: Array<{ date: Date; created: number; completed: number; active: number; overdue: number }> = [];
    for (let i = sparkDays - 1; i >= 0; i--) {
      const day = startOfDay(subDays(now, i));
      buckets.push({ date: day, created: 0, completed: 0, active: 0, overdue: 0 });
    }
    const findBucket = (d: Date) => {
      const idx = differenceInDays(startOfDay(now), startOfDay(d));
      const bIdx = sparkDays - 1 - idx;
      return bIdx >= 0 && bIdx < buckets.length ? buckets[bIdx] : null;
    };
    for (const t of scopedTasks) {
      const cb = findBucket(t.createdAt);
      if (cb) cb.created += 1;
      if (t.completedAt) {
        const dn = findBucket(t.completedAt);
        if (dn) dn.completed += 1;
      }
    }
    // Cumulative active/overdue per day (snapshot proxy: count tasks still open as of that day).
    const tasksByCreate = scopedTasks.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 0; i < buckets.length; i++) {
      const cutoff = buckets[i].date.getTime() + 86_400_000;
      buckets[i].active = tasksByCreate.filter((t) => {
        if (t.createdAt.getTime() >= cutoff) return false;
        if (t.completedAt && t.completedAt.getTime() < cutoff) return false;
        return true;
      }).length;
      buckets[i].overdue = tasksByCreate.filter((t) => {
        if (t.createdAt.getTime() >= cutoff) return false;
        if (t.completedAt && t.completedAt.getTime() < cutoff) return false;
        return t.dueDate ? t.dueDate.getTime() < cutoff : false;
      }).length;
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedTasks, sparkDays]);

  const sparkActive = dayBuckets.map((b) => ({ value: b.active }));
  const sparkCompleted = dayBuckets.map((b) => ({ value: b.completed }));
  const sparkOverdue = dayBuckets.map((b) => ({ value: b.overdue }));
  const sparkCycle = useMemo(() => {
    // Simple proxy: each day's cycle = avg of tasks completed that day.
    return dayBuckets.map((b) => {
      const sameDay = scopedTasks.filter(
        (t) =>
          t.completedAt &&
          startOfDay(t.completedAt).getTime() === b.date.getTime() &&
          t.createdAt,
      );
      const v =
        sameDay.length === 0
          ? 0
          : sameDay.reduce((s, t) => s + differenceInDays(t.completedAt!, t.createdAt), 0) / sameDay.length;
      return { value: Math.max(0, v) };
    });
  }, [scopedTasks, dayBuckets]);

  // ── Status donut ──────────────────────────────────────────────────────────
  const statusData: DonutDatum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of scopedTasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
    const order = ['todo', 'inprogress', 'needreview', 'done', 'undefined'];
    return order
      .filter((s) => (counts.get(s) ?? 0) > 0)
      .map((s, i) => ({
        name: STATUS_LABEL[s] ?? s,
        value: counts.get(s) ?? 0,
        color: s === 'done' ? palette.shades[4] : palette.shades[i % palette.shades.length],
      }));
  }, [scopedTasks]);

  // ── Stacked daily throughput (last 14 days) ───────────────────────────────
  const throughputData = useMemo(
    () =>
      dayBuckets.map((b) => ({
        label: format(b.date, 'MMM d'),
        Created: b.created,
        Completed: b.completed,
      })),
    [dayBuckets],
  );

  // ── Workload by assignee (top 10) ─────────────────────────────────────────
  const workloadData = useMemo(() => {
    const byUser = new Map<string, { name: string; open: number }>();
    for (const t of scopedTasks) {
      if (isCompleted(t)) continue;
      for (const a of t.assignees ?? []) {
        const key = a.userId;
        const row = byUser.get(key) ?? { name: a.displayName || a.email || 'Unassigned', open: 0 };
        row.open += 1;
        byUser.set(key, row);
      }
    }
    return Array.from(byUser.values())
      .sort((a, b) => b.open - a.open)
      .slice(0, 10)
      .map((r) => ({ name: r.name, value: r.open }));
  }, [scopedTasks]);

  // ── Project completion list ───────────────────────────────────────────────
  const projectCompletion = useMemo(() => {
    const rows = Array.from(visibleProjectIds).map((pid) => {
      const proj = projects.find((p) => p.projectId === pid);
      const own = scopedTasks.filter((t) => t.projectId === pid);
      const total = own.length;
      const done = own.filter(isCompleted).length;
      const overdue = own.filter(isOverdue).length;
      return {
        projectId: pid,
        name: proj?.name ?? '—',
        total,
        done,
        overdue,
        pct: total === 0 ? 0 : Math.round((done / total) * 100),
      };
    });
    return rows.sort((a, b) => b.pct - a.pct).slice(0, 8);
  }, [scopedTasks, projects, visibleProjectIds]);

  const fmtPct = (v: number) => `${Math.round(v)}%`;

  if (tasksLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading dashboard…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 md:px-8 md:py-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of {scopedTasks.length.toLocaleString()} tasks across{' '}
            {visibleProjectIds.size} project{visibleProjectIds.size === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="h-9 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Active tasks"
          value={activeCount.toLocaleString()}
          sparkline={sparkActive}
        />
        <KpiTile
          label={`Completed (${range})`}
          value={completedInRange.length.toLocaleString()}
          deltaPct={completedDelta}
          sparkline={sparkCompleted}
          accent
        />
        <KpiTile
          label="Overdue"
          value={overdueCount.toLocaleString()}
          sparkline={sparkOverdue}
        />
        <KpiTile
          label="Avg cycle time"
          value={`${avgCycle.toFixed(1)}d`}
          hint="created → done"
          sparkline={sparkCycle}
        />
      </div>

      {/* Row 2: donut + throughput */}
      <div className="grid lg:grid-cols-3 gap-3">
        <ChartCard title="Task status" subtitle="Current snapshot" bodyHeight="h-64">
          <div className="grid grid-cols-[1fr_auto] gap-3 h-full">
            <StatusDonut
              data={statusData}
              centerValue={scopedTasks.length.toLocaleString()}
              centerLabel="tasks"
            />
            <div className="self-center min-w-[140px]">
              <DonutLegend data={statusData} />
            </div>
          </div>
        </ChartCard>
        <ChartCard title="Throughput" subtitle="Created vs completed, last 14 days" bodyHeight="h-64" className="lg:col-span-2">
          <StackedBar
            data={throughputData}
            series={[
              { key: 'Created', name: 'Created', color: palette.muted },
              { key: 'Completed', name: 'Completed', color: palette.accent },
            ]}
          />
        </ChartCard>
      </div>

      {/* Row 3: workload + project completion */}
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Open tasks by assignee" subtitle="Top 10 — workload distribution" bodyHeight="h-72">
          <BarHorizontal data={workloadData} highlightTop />
        </ChartCard>
        <ChartCard title="Project completion" subtitle="Top 8 by % done" bodyHeight="h-72">
          {projectCompletion.length === 0 ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">No projects yet</div>
          ) : (
            <div className="space-y-2 overflow-y-auto h-full pr-1">
              {projectCompletion.map((p) => (
                <button
                  key={p.projectId}
                  className="w-full text-left rounded-md border border-transparent hover:border-border p-2 transition-colors"
                  onClick={() => navigate(`/project/${p.projectId}`)}
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate text-foreground/90">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.overdue > 0 && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                          {p.overdue} overdue
                        </span>
                      )}
                      <span className="tabular-nums text-muted-foreground">{p.done}/{p.total}</span>
                      <span className="tabular-nums font-medium text-foreground">{fmtPct(p.pct)}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded bg-muted overflow-hidden">
                    <div
                      className="h-full bg-foreground rounded"
                      style={{ width: `${p.pct}%`, backgroundColor: p.pct === 100 ? '#22c55e' : palette.primary }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Footer nav */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            Want CRM-side insights too?
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/clients')}>
            Open CRM dashboard <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectsDashboard;
