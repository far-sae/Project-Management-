import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  FileBarChart, Calendar, Settings, Loader2, Lock, Users, ChevronDown,
} from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useSubscription } from '@/context/SubscriptionContext';
import { cn } from '@/lib/utils';

const DAY_WIDTH = 32;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Resource Timeline Component ───────────────────────────────────────────────
interface ResourceTimelineProps {
  projects: any[];
  navigate: (path: string) => void;
  showWeekends: boolean;
  showTaskLabels: boolean;
  highlightToday: boolean;
  timeGranularity: 'day' | 'week' | 'month';
}

const ResourceTimeline: React.FC<ResourceTimelineProps> = ({
  projects,
  navigate,
  showWeekends,
  showTaskLabels,
  highlightToday,
  timeGranularity
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const DEFAULT_PROJECT_DAYS = 90;

  // Show all projects: use start/end when set, otherwise fallback to createdAt and +90 days
  const visibleProjects = useMemo(() => {
    return projects.map((p) => {
      const created = p.createdAt ? new Date(p.createdAt) : new Date();
      const start = p.startDate ? new Date(p.startDate) : created;
      const end = p.endDate
        ? new Date(p.endDate)
        : new Date(start.getTime() + DEFAULT_PROJECT_DAYS * 24 * 60 * 60 * 1000);
      return { ...p, effectiveStart: start, effectiveEnd: end };
    });
  }, [projects]);

  // Calculate timeline range from all visible project dates (using effective start/end)
  const { startDate, totalDays, todayOffset, monthHeaders, dayNumbers } = useMemo(() => {
    if (visibleProjects.length === 0) {
      // Default: show 3 months around today
      const start = new Date(today);
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      const end = new Date(today);
      end.setMonth(end.getMonth() + 2);
      end.setDate(0);
      const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const offset = Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
      return buildCalendar(start, end, days, offset, today, timeGranularity);
    }

    const allDates = visibleProjects.flatMap((p) => [p.effectiveStart, p.effectiveEnd]);
    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

    const start = new Date(minDate);
    start.setDate(1);
    const end = new Date(maxDate);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);

    const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const offset = Math.ceil((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    return buildCalendar(start, end, days, offset, today, timeGranularity);
  }, [visibleProjects, timeGranularity]);

  // Filter out weekends if needed
  const filteredDayNumbers = useMemo(() => {
    if (showWeekends) return dayNumbers;

    const startDateCopy = new Date(startDate);
    return dayNumbers.filter((_, index) => {
      const currentDate = new Date(startDateCopy);
      currentDate.setDate(currentDate.getDate() + index);
      const dayOfWeek = currentDate.getDay();
      return dayOfWeek !== 0 && dayOfWeek !== 6; // 0 = Sunday, 6 = Saturday
    });
  }, [dayNumbers, startDate, showWeekends]);

  const columnWidth = timeGranularity === 'month' ? DAY_WIDTH * 4 : DAY_WIDTH;

  if (visibleProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
        <Users className="w-12 h-12 text-gray-300" />
        <p className="text-lg font-medium text-gray-500">No projects yet</p>
        <p className="text-sm text-gray-400 text-center max-w-md">
          Create or join a project to see it on the timeline. You can set optional start/end dates on projects for more accurate ranges.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-max">
      {/* Month header */}
      <div className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="flex">
          <div className="w-96 shrink-0 border-r border-border bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Project
          </div>
          <div className="flex relative" style={{ minWidth: (showWeekends ? totalDays : filteredDayNumbers.length) * columnWidth }}>
            {monthHeaders.map((m, i) => (
              <div
                key={i}
                className="text-xs font-semibold py-2 px-2 border-r border-border text-foreground/80"
                style={{ width: m.days * columnWidth }}
              >
                {m.month} {m.year}
              </div>
            ))}
          </div>
        </div>

        {/* Day numbers */}
        <div className="flex">
          <div className="w-96 shrink-0 border-r border-border bg-muted/40" />
          <div className="flex relative" style={{ minWidth: (showWeekends ? totalDays : filteredDayNumbers.length) * columnWidth }}>
            {(showWeekends ? dayNumbers : filteredDayNumbers).map((d, i) => (
              <div
                key={i}
                id={d.isToday && highlightToday ? 'resource-today-marker' : undefined}
                className={cn(
                  'text-xs text-center py-1.5 border-r border-border',
                  d.isToday && highlightToday ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200 font-bold' : 'text-muted-foreground'
                )}
                style={{ width: columnWidth }}
              >
                {timeGranularity === 'month' ? '' : d.day}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Project rows */}
      {visibleProjects.map((project) => {
        const rawMembers = (project.members || []) as any[];
        const owner =
          rawMembers.find((m: any) => (m.userId || m.user_id) === project.ownerId) ||
          {
            userId: project.ownerId,
            displayName: "Owner",
            photoURL: "",
            email: "",
          };
        const members = rawMembers.filter(
          (m: any) => (m.userId || m.user_id) !== project.ownerId,
        );

        const projStart = project.effectiveStart;
        const projEnd = project.effectiveEnd;

        const leftPx = Math.max(
          0,
          Math.ceil((projStart.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) * columnWidth
        );
        const widthPx = Math.max(
          columnWidth * 3,
          Math.ceil((projEnd.getTime() - projStart.getTime()) / (24 * 60 * 60 * 1000)) * columnWidth
        );

        const isOverdue = projEnd < today;
        const isActive = projStart <= today && projEnd >= today;

        const totalDuration = Math.ceil((projEnd.getTime() - projStart.getTime()) / (24 * 60 * 60 * 1000));
        const elapsed = Math.max(0, Math.ceil((today.getTime() - projStart.getTime()) / (24 * 60 * 60 * 1000)));
        const progressPct = Math.min(100, Math.round((elapsed / totalDuration) * 100));

        return (
          <div key={project.projectId} className="flex border-b border-border hover:bg-muted/30 group">
            {/* Left: project info */}
            <div className="w-96 shrink-0 border-r border-border flex items-center px-4 py-3 sticky left-0 z-10 bg-card group-hover:bg-muted/40">
              <div
                className="w-3 h-3 rounded-full mr-3 shrink-0"
                style={{ backgroundColor: project.coverColor || '#f97316' }}
              />
              <div className="flex-1 min-w-0">
                <span
                  className="font-medium text-sm text-foreground cursor-pointer hover:text-primary truncate block"
                  onClick={() => navigate(`/project/${project.projectId}`)}
                >
                  {project.name}
                </span>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {project.effectiveStart.toLocaleDateString()} → {project.effectiveEnd.toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Member avatars */}
              <div className="flex -space-x-1.5 ml-2">
                {[owner, ...members].filter(Boolean).slice(0, 5).map((m: any) => (
                  <Avatar key={m.userId} className="w-6 h-6 border-2 border-card shadow-sm">
                    <AvatarImage src={m.photoURL} />
                    <AvatarFallback
                      className="text-[10px] font-bold text-white"
                      style={{ backgroundColor: project.coverColor || '#f97316' }}
                    >
                      {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {rawMembers.length > 5 && (
                  <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[10px] text-muted-foreground font-bold">
                    +{rawMembers.length - 5}
                  </div>
                )}
              </div>
            </div>

            {/* Right: timeline bar */}
            <div className="flex-1 relative h-14" style={{ minWidth: (showWeekends ? totalDays : filteredDayNumbers.length) * columnWidth }}>
              {/* Today highlight column */}
              {highlightToday && todayOffset >= 0 && todayOffset < totalDays && (
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/15"
                  style={{ left: todayOffset * columnWidth, width: columnWidth }}
                />
              )}

              {/* Project bar */}
              <div
                className="absolute top-1/2 -translate-y-1/2 rounded-lg flex items-center overflow-hidden shadow-sm cursor-pointer"
                style={{
                  left: leftPx,
                  width: widthPx,
                  height: 32,
                  backgroundColor: isOverdue
                    ? '#fca5a5'
                    : project.coverColor || '#f97316',
                  opacity: 0.9,
                }}
                onClick={() => navigate(`/project/${project.projectId}`)}
                title={`${project.name} · ${project.effectiveStart.toLocaleDateString()} → ${project.effectiveEnd.toLocaleDateString()}`}
              >
                {/* Progress fill */}
                {isActive && (
                  <div
                    className="absolute top-0 left-0 bottom-0 bg-black/15 rounded-l-lg"
                    style={{ width: `${progressPct}%` }}
                  />
                )}

                {/* Members on bar */}
                <div className="relative flex items-center gap-1 px-2 w-full">
                  <div className="flex -space-x-1">
                    {[owner, ...members].filter(Boolean).slice(0, 4).map((m: any) => (
                      <div
                        key={m.userId}
                        title={m.displayName || m.email}
                        className="w-5 h-5 rounded-full border border-white/60 flex items-center justify-center text-white text-[9px] font-bold bg-white/20"
                      >
                        {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                      </div>
                    ))}
                  </div>
                  {showTaskLabels && widthPx > 100 && (
                    <span className="text-white text-xs font-semibold truncate ml-1 drop-shadow">
                      {project.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Calendar builder helper ───────────────────────────────────────────────────
function buildCalendar(start: Date, end: Date, days: number, offset: number, today: Date, _granularity: 'day' | 'week' | 'month') {
  const months: { month: string; year: number; startDay: number; days: number; }[] = [];
  let currentDate = new Date(start);
  let dayCount = 0;

  while (currentDate <= end) {
    const monthStart = dayCount;
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    let daysInMonth = 0;

    while (currentDate <= end && currentDate.getMonth() === month) {
      daysInMonth++;
      currentDate.setDate(currentDate.getDate() + 1);
      dayCount++;
    }
    months.push({ month: MONTHS[month].toUpperCase(), year, startDay: monthStart, days: daysInMonth });
  }

  const dayNums: { day: number; isToday: boolean; offset: number; }[] = [];
  currentDate = new Date(start);

  for (let i = 0; i < days; i++) {
    dayNums.push({
      day: currentDate.getDate(),
      isToday: currentDate.toDateString() === today.toDateString(),
      offset: i,
    });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return { startDate: start, totalDays: days, todayOffset: offset, monthHeaders: months, dayNumbers: dayNums };
}

// ── Main Component ────────────────────────────────────────────────────────────
export const TimelineOverview: React.FC = () => {
  const navigate = useNavigate();
  const { projects, loading: projectsLoading } = useProjects();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const [isReady, setIsReady] = useState(false);

  const [showTimelineSettings, setShowTimelineSettings] = useState(false);
  const [showWeekends, setShowWeekends] = useState(true);
  const [showTaskLabels, setShowTaskLabels] = useState(true);
  const [highlightToday, setHighlightToday] = useState(true);
  const [timeGranularity, setTimeGranularity] = useState<'day' | 'week' | 'month'>('day');

  // Add a delay to ensure subscription data is fully loaded
  useEffect(() => {
    if (!subscriptionLoading) {
      const timer = setTimeout(() => {
        setIsReady(true);
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setIsReady(false);
    }
  }, [subscriptionLoading]);

  // ── Show loading state while subscription is loading ──
  if (subscriptionLoading || !isReady) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-orange-500 mb-4" />
          <p className="text-gray-600">Loading timeline features...</p>
        </main>
      </div>
    );
  }

  // ── Feature gate ──────────────────────────────────────────
  if (!hasFeature('timeline_overview')) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Timeline Overview</h1>
            <p className="text-gray-500">Visual timeline of all your projects</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Timeline Overview</h2>
            <p className="text-gray-500 mb-2 max-w-md">
              Visualize all your projects on an interactive Gantt-style timeline.
            </p>
            <p className="text-sm text-orange-600 font-medium mb-6">
              Available on Advanced plan and above
            </p>
            <Button className="bg-gradient-to-r from-orange-500 to-red-500" onClick={() => navigate('/pricing')}>
              Upgrade to Advanced
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">

        {/* ── Top header ── */}
        <div className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">Timeline Overview</h1>
            <Button variant="ghost" size="sm" className="text-primary hover:text-primary/90 hover:bg-primary/10" onClick={() => navigate('/reports')}>
              <FileBarChart className="w-4 h-4 mr-2" />
              Build Report
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                document.getElementById('resource-today-marker')?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
              }}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Today
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Options
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShowTimelineSettings(true)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Timeline settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Main content area ── */}
        <div className="flex-1 overflow-auto">
          {projectsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            </div>
          ) : (
            <ResourceTimeline
              projects={projects}
              navigate={navigate}
              showWeekends={showWeekends}
              showTaskLabels={showTaskLabels}
              highlightToday={highlightToday}
              timeGranularity={timeGranularity}
            />
          )}
        </div>
      </main>

      {/* Timeline Settings Dialog */}
      <Dialog open={showTimelineSettings} onOpenChange={setShowTimelineSettings}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Timeline Settings</DialogTitle>
            <DialogDescription>Customize how the project timeline is displayed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="show-weekends">Show weekends</Label>
                <p className="text-sm text-gray-500">Display Saturday and Sunday columns</p>
              </div>
              <Switch
                id="show-weekends"
                checked={showWeekends}
                onCheckedChange={setShowWeekends}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="show-labels">Show task labels</Label>
                <p className="text-sm text-gray-500">Display project names on timeline bars</p>
              </div>
              <Switch
                id="show-labels"
                checked={showTaskLabels}
                onCheckedChange={setShowTaskLabels}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="highlight-today">Highlight today</Label>
                <p className="text-sm text-gray-500">Show visual indicator for current day</p>
              </div>
              <Switch
                id="highlight-today"
                checked={highlightToday}
                onCheckedChange={setHighlightToday}
              />
            </div>
            <div className="space-y-2">
              <Label>Default view</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={timeGranularity === 'day' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeGranularity('day')}
                >
                  Days
                </Button>
                <Button
                  type="button"
                  variant={timeGranularity === 'week' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeGranularity('week')}
                >
                  Weeks
                </Button>
                <Button
                  type="button"
                  variant={timeGranularity === 'month' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTimeGranularity('month')}
                >
                  Months
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowTimelineSettings(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TimelineOverview;
