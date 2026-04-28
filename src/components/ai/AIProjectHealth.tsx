import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Loader2,
  RefreshCw,
  Sparkles,
  ShieldAlert,
  Lightbulb,
  Trophy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  assessProjectHealth,
  isAIEnabled,
  type ProjectHealthResponse,
  type ProjectHealthSnapshot,
  type AIError,
} from '@/services/ai';
import type { Task } from '@/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const STORAGE_KEY = (projectId: string) => `ai_project_health:${projectId}`;

interface CacheEnvelope {
  fingerprint: string;
  health: ProjectHealthResponse;
}

interface AIProjectHealthProps {
  projectId: string;
  projectName: string;
  /** Current user (for AI rate limiting). */
  userId: string;
  tasks: Task[];
}

function buildSnapshot(projectName: string, tasks: Task[]): ProjectHealthSnapshot {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const sevenAgo = now - 7 * dayMs;
  const fourteenAgo = now - 14 * dayMs;
  const sevenAhead = now + 7 * dayMs;

  let completedTasks = 0;
  let inProgressTasks = 0;
  let notStartedTasks = 0;
  let blockedTasks = 0;
  let overdueTasks = 0;
  let stalledTasks = 0;
  let unassignedTasks = 0;
  let highPriorityOpen = 0;
  let velocityLast7d = 0;
  let velocityPrev7d = 0;
  let upcomingDueIn7d = 0;
  let totalDaysSinceUpdate = 0;

  for (const t of tasks) {
    const updatedMs = new Date(t.updatedAt).getTime();
    totalDaysSinceUpdate += (now - updatedMs) / dayMs;

    if (t.status === 'done') {
      completedTasks++;
      if (updatedMs >= sevenAgo) velocityLast7d++;
      else if (updatedMs >= fourteenAgo) velocityPrev7d++;
      continue;
    }

    if (t.status === 'inprogress') inProgressTasks++;
    else if (t.status === 'todo' || t.status === 'undefined') notStartedTasks++;
    else if (t.status === 'needreview') blockedTasks++;

    if (t.dueDate) {
      const due = new Date(t.dueDate).getTime();
      if (due < now) overdueTasks++;
      else if (due <= sevenAhead) upcomingDueIn7d++;
    }

    if (now - updatedMs > 14 * dayMs) stalledTasks++;
    if (!t.assignees || t.assignees.length === 0) unassignedTasks++;
    if (t.priority === 'high') highPriorityOpen++;
  }

  const averageDaysSinceUpdate =
    tasks.length > 0 ? Math.round((totalDaysSinceUpdate / tasks.length) * 10) / 10 : 0;

  return {
    projectName,
    totalTasks: tasks.length,
    completedTasks,
    inProgressTasks,
    notStartedTasks,
    blockedTasks,
    overdueTasks,
    stalledTasks,
    unassignedTasks,
    highPriorityOpen,
    averageDaysSinceUpdate,
    velocityLast7d,
    velocityPrev7d,
    upcomingDueIn7d,
  };
}

const STATUS_TONES: Record<
  ProjectHealthResponse['status'],
  { ring: string; bar: string; text: string; bg: string; label: string }
> = {
  excellent: {
    ring: 'ring-emerald-500/40',
    bar: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-500/10',
    label: 'Excellent',
  },
  good: {
    ring: 'ring-blue-500/40',
    bar: 'bg-blue-500',
    text: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-500/10',
    label: 'Good',
  },
  watch: {
    ring: 'ring-amber-500/40',
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-500/10',
    label: 'Watch',
  },
  'at-risk': {
    ring: 'ring-red-500/40',
    bar: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-500/10',
    label: 'At risk',
  },
};

export const AIProjectHealth: React.FC<AIProjectHealthProps> = ({
  projectId,
  projectName,
  userId,
  tasks,
}) => {
  const aiAvailable = isAIEnabled();
  const [health, setHealth] = useState<ProjectHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const snapshot = useMemo(() => buildSnapshot(projectName, tasks), [projectName, tasks]);

  const fingerprint = useMemo(
    () =>
      [
        snapshot.projectName,
        snapshot.totalTasks,
        snapshot.completedTasks,
        snapshot.inProgressTasks,
        snapshot.notStartedTasks,
        snapshot.blockedTasks,
        snapshot.overdueTasks,
        snapshot.stalledTasks,
        snapshot.unassignedTasks,
        snapshot.highPriorityOpen,
        snapshot.averageDaysSinceUpdate,
        snapshot.velocityLast7d,
        snapshot.velocityPrev7d,
        snapshot.upcomingDueIn7d,
      ].join('|'),
    [snapshot],
  );

  // Restore assessed health when local cache matches task snapshot; clear when stale or missing.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY(projectId));
      if (!raw) {
        setHealth(null);
        return;
      }
      const env = JSON.parse(raw) as CacheEnvelope;
      if (env.fingerprint === fingerprint) {
        setHealth(env.health);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    }
  }, [projectId, fingerprint]);

  const handleAssess = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await assessProjectHealth(userId, snapshot);
      setHealth(result);
      try {
        const env: CacheEnvelope = { fingerprint, health: result };
        window.localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(env));
      } catch {
        /* ignore */
      }
    } catch (err) {
      const aiErr = err as AIError;
      setError(aiErr.message || 'Could not assess project health.');
    } finally {
      setLoading(false);
    }
  };

  const tone = health ? STATUS_TONES[health.status] : null;

  return (
    <section
      className={cn(
        'rounded-xl border bg-card overflow-hidden transition-colors',
        tone ? tone.ring + ' ring-1' : 'border-border/70',
        !tone && 'border-violet-500/30',
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ring-1',
            tone ? tone.bg : 'bg-violet-500/10 ring-violet-500/30',
            tone ? tone.text : 'text-violet-500',
            tone ? '' : 'ring-violet-500/30',
          )}
        >
          <Activity className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Project health</h3>
              {tone && (
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5',
                    tone.bg,
                    tone.text,
                  )}
                >
                  {tone.label}
                </span>
              )}
              {health && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  · {format(new Date(health.generatedAt), 'p')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={health ? 'outline' : 'default'}
                disabled={!aiAvailable || loading || tasks.length === 0}
                onClick={handleAssess}
                className={
                  health
                    ? 'h-7 text-xs'
                    : 'h-7 text-xs bg-gradient-to-r from-violet-500 to-blue-500 text-white border-0 hover:opacity-90'
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Reading
                  </>
                ) : health ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Refresh
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 mr-1" />
                    Assess
                  </>
                )}
              </Button>
              {health && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {!aiAvailable && (
            <p className="text-xs text-muted-foreground mt-1">
              Configure the <code>ai-chat</code> Supabase function to enable AI health checks.
            </p>
          )}
          {!aiAvailable === false && !health && !loading && !error && (
            <p className="text-xs text-muted-foreground mt-1">
              Click <span className="font-medium text-foreground">Assess</span> for an AI score
              with risks and recommendations from your live project data.
            </p>
          )}
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}

          {health && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className={cn('text-2xl font-bold tabular-nums', tone?.text)}>
                  {health.score}
                </span>
                <span className="text-[11px] text-muted-foreground">/ 100</span>
              </div>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full transition-all', tone?.bar || 'bg-primary')}
                  style={{ width: `${health.score}%` }}
                />
              </div>
            </div>
          )}

          {health?.headline && expanded && (
            <p className="text-sm leading-relaxed mt-2.5">{health.headline}</p>
          )}
        </div>
      </div>

      {health && expanded && (
        <div className="border-t border-border/60 px-3.5 py-3 space-y-3 bg-card/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {health.strengths.length > 0 && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1 mb-1.5">
                  <Trophy className="w-3 h-3" />
                  Strengths
                </p>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {health.strengths.map((s, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-emerald-500 shrink-0">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {health.risks.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-red-700 dark:text-red-300 flex items-center gap-1 mb-1.5">
                  <ShieldAlert className="w-3 h-3" />
                  Risks
                </p>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {health.risks.map((r, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-red-500 shrink-0">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {health.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1.5">
                <Lightbulb className="w-3 h-3" />
                Recommended next steps
              </p>
              <ol className="space-y-1">
                {health.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed">
                    <span className="mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-semibold shrink-0">
                      {i + 1}
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AIProjectHealth;
