import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, ShieldAlert, Trophy, RefreshCw, AlertCircle, Sunrise } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  generateDailyBrief,
  isAIEnabled,
  type DailyBriefResponse,
  type DailyBriefSnapshot,
  type DailyBriefTaskRef,
  type AIError,
} from '@/services/ai';
import type { Task } from '@/types';
import { format } from 'date-fns';

const STORAGE_KEY = (userId: string) => `ai_daily_brief:${userId}`;

interface CacheEnvelope {
  date: string; // YYYY-MM-DD
  loadFingerprint: string;
  brief: DailyBriefResponse;
}

interface AIDailyBriefProps {
  userId: string;
  userDisplayName: string;
  tasks: Task[];
  /** Map projectId → projectName for snapshot. */
  projectNames: Record<string, string>;
  /** Called when the user clicks one of the "focus" entries. */
  onOpenTask?: (taskId: string) => void;
  /** Optional default-collapsed when the briefing has lots of bullets. */
  defaultCollapsed?: boolean;
}

const startOfDay = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

function buildSnapshot(
  tasks: Task[],
  projectNames: Record<string, string>,
  userDisplayName: string,
): DailyBriefSnapshot {
  const today = startOfDay(new Date());
  const todayMs = today.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekEnd = todayMs + 7 * dayMs;
  const fourteenDays = 14 * dayMs;

  const ref = (t: Task, isOverdue?: boolean): DailyBriefTaskRef => ({
    taskId: t.taskId,
    title: t.title.slice(0, 200),
    projectName: projectNames[t.projectId] || 'Project',
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : undefined,
    isOverdue,
  });

  const dueToday: DailyBriefTaskRef[] = [];
  const overdue: DailyBriefTaskRef[] = [];
  const thisWeek: DailyBriefTaskRef[] = [];
  const highPriorityOpen: DailyBriefTaskRef[] = [];
  const recentlyCompleted: DailyBriefTaskRef[] = [];

  for (const t of tasks) {
    if (t.status === 'done') {
      const updated = new Date(t.updatedAt).getTime();
      if (Date.now() - updated <= fourteenDays) {
        recentlyCompleted.push(ref(t));
      }
      continue;
    }
    const due = t.dueDate ? startOfDay(new Date(t.dueDate)).getTime() : null;
    if (due !== null) {
      if (due === todayMs) dueToday.push(ref(t));
      else if (due < todayMs) overdue.push(ref(t, true));
      else if (due <= weekEnd) thisWeek.push(ref(t));
    }
    if (t.priority === 'high') {
      highPriorityOpen.push(ref(t));
    }
  }

  return {
    userDisplayName,
    todayDate: format(today, 'EEEE, MMM d, yyyy'),
    totalAssigned: tasks.length,
    dueToday: dueToday.slice(0, 12),
    overdue: overdue.slice(0, 12),
    thisWeek: thisWeek.slice(0, 12),
    highPriorityOpen: highPriorityOpen.slice(0, 12),
    recentlyCompleted: recentlyCompleted.slice(0, 8),
    recentMentions: [],
  };
}

export const AIDailyBrief: React.FC<AIDailyBriefProps> = ({
  userId,
  userDisplayName,
  tasks,
  projectNames,
  onOpenTask,
}) => {
  const aiAvailable = isAIEnabled();
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = useMemo(
    () => buildSnapshot(tasks, projectNames, userDisplayName),
    [tasks, projectNames, userDisplayName],
  );

  /** Fingerprint of "what's on my plate today" — invalidates the cache when meaningfully changed. */
  const loadFingerprint = useMemo(() => {
    return [
      snapshot.totalAssigned,
      snapshot.dueToday.length,
      snapshot.overdue.length,
      snapshot.thisWeek.length,
      snapshot.highPriorityOpen.length,
      snapshot.recentlyCompleted.length,
    ].join('-');
  }, [snapshot]);

  // Load cached brief on mount / user change.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY(userId));
      if (!raw) return;
      const env = JSON.parse(raw) as CacheEnvelope;
      const todayKey = format(startOfDay(new Date()), 'yyyy-MM-dd');
      if (env.date === todayKey && env.loadFingerprint === loadFingerprint) {
        setBrief(env.brief);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateDailyBrief(userId, snapshot);
      setBrief(result);
      try {
        const env: CacheEnvelope = {
          date: format(startOfDay(new Date()), 'yyyy-MM-dd'),
          loadFingerprint,
          brief: result,
        };
        window.localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(env));
      } catch {
        /* ignore */
      }
    } catch (err) {
      const aiErr = err as AIError;
      setError(aiErr.message || 'Could not generate your brief.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      aria-label="AI Daily Brief"
      className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.06] via-card to-blue-500/[0.05] p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 ring-1 ring-violet-500/30 text-violet-500 flex items-center justify-center shrink-0">
            <Sunrise className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-foreground">Your AI brief</h2>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-500/80 bg-violet-500/10 ring-1 ring-violet-500/20 rounded-full px-1.5 py-0.5">
                Beta
              </span>
              {brief && (
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  · Generated {format(new Date(brief.generatedAt), 'p')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              A personal, calm read of where you stand today.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={brief ? 'outline' : 'default'}
          disabled={!aiAvailable || loading || tasks.length === 0}
          onClick={handleGenerate}
          className={
            brief
              ? ''
              : 'bg-gradient-to-r from-violet-500 to-blue-500 text-white border-0 hover:opacity-90'
          }
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Thinking…
            </>
          ) : brief ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Regenerate
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Generate
            </>
          )}
        </Button>
      </div>

      {!aiAvailable && (
        <div className="mt-3 flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            AI isn&apos;t configured yet. Deploy the <code>ai-chat</code> Supabase function and
            set <code>OPENAI_API_KEY</code> to enable this brief.
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!brief && !loading && !error && aiAvailable && tasks.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Click <span className="font-medium text-foreground">Generate</span> to get a tailored
          brief covering today&apos;s focus, blockers, and recent wins — using only your real
          task data.
        </p>
      )}

      {!brief && !loading && tasks.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          You don&apos;t have any tasks assigned to you yet. Once you do, the brief will summarize
          where to focus.
        </p>
      )}

      {loading && (
        <div className="mt-3 space-y-2">
          <div className="h-3 rounded bg-muted/70 animate-pulse w-2/3" />
          <div className="h-3 rounded bg-muted/70 animate-pulse w-1/2" />
          <div className="h-3 rounded bg-muted/70 animate-pulse w-3/4" />
        </div>
      )}

      {brief && (
        <div className="mt-4 space-y-4">
          {(brief.greeting || brief.summary) && (
            <div className="rounded-lg bg-card/70 border border-border/60 p-3">
              {brief.greeting && (
                <p className="text-sm font-medium leading-snug">{brief.greeting}</p>
              )}
              {brief.summary && (
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  {brief.summary}
                </p>
              )}
            </div>
          )}

          {brief.focus.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Today&apos;s focus
              </p>
              <ol className="space-y-1.5">
                {brief.focus.map((f, idx) => {
                  const t = tasks.find((task) => task.taskId === f.taskId);
                  return (
                    <li key={`${f.taskId}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => f.taskId && onOpenTask?.(f.taskId)}
                        className="w-full text-left rounded-md border border-border/60 bg-card hover:bg-muted/40 transition-colors p-2.5 flex gap-2.5"
                      >
                        <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 text-[11px] font-semibold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground truncate">
                            {t?.title || 'Task'}
                          </span>
                          <span className="block text-xs text-muted-foreground leading-snug mt-0.5">
                            {f.reason}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {brief.blockers.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
              <p className="text-[11px] uppercase tracking-wider text-red-600 dark:text-red-400 mb-1.5 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                Watch out
              </p>
              <ul className="space-y-1 text-sm leading-relaxed">
                {brief.blockers.map((b, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-red-500/70 mt-1 inline-block w-1 h-1 rounded-full shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.wins.length > 0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
              <p className="text-[11px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
                <Trophy className="w-3 h-3" />
                Recent wins
              </p>
              <ul className="space-y-1 text-sm leading-relaxed">
                {brief.wins.map((w, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-emerald-500/70 mt-1 inline-block w-1 h-1 rounded-full shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.closing && (
            <p className="text-xs text-muted-foreground italic">{brief.closing}</p>
          )}
        </div>
      )}
    </section>
  );
};

export default AIDailyBrief;
