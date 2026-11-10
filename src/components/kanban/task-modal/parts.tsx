import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, ListTree, Loader2, MessageSquare, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatDistanceSafe } from '@/lib/utils';
import type { ActivityEvent } from '@/types/activity';
import type { CommentSummary } from '@/services/ai';
import type { PresencePeer } from '@/hooks/usePresence';
import { PRESS } from './styles';

/** Re-renders every `intervalMs` while `enabled`, returning the current time. */
export function useNow(intervalMs: number, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

const PROPERTY_LABEL =
  'flex h-10 md:h-8 items-center gap-1.5 text-[13px] text-muted-foreground select-none';

/** One label → value row in the properties panel. */
export const PropertyRow: React.FC<{
  label: string;
  /** id of the control the label activates (makes the label clickable). */
  htmlFor?: string;
  labelId?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, labelId, className, children }) => (
  <div className={cn('grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-2', className)}>
    {htmlFor ? (
      <label htmlFor={htmlFor} id={labelId} className={cn(PROPERTY_LABEL, 'cursor-pointer')}>
        {label}
      </label>
    ) : (
      <span id={labelId} className={PROPERTY_LABEL}>
        {label}
      </span>
    )}
    <div className="flex min-h-10 md:min-h-8 min-w-0 flex-col justify-center">{children}</div>
  </div>
);

/** Stacked avatars of teammates who currently have this task open. */
export const PresenceAvatars: React.FC<{ peers: PresencePeer[] }> = ({ peers }) => {
  if (peers.length === 0) return null;
  const names = peers.map((p) => p.displayName).join(', ');
  return (
    <div
      className="hidden sm:flex items-center gap-1.5 pr-1"
      title={`${names} viewing this task`}
      aria-label={`${peers.length} ${peers.length === 1 ? 'person' : 'people'} viewing: ${names}`}
      role="img"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
      <div className="flex -space-x-1.5" aria-hidden>
        {peers.slice(0, 3).map((peer) =>
          peer.photoURL ? (
            <img
              key={peer.userId}
              src={peer.photoURL}
              alt=""
              className="h-6 w-6 rounded-full object-cover ring-2 ring-card"
            />
          ) : (
            <span
              key={peer.userId}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary-soft-foreground ring-2 ring-card"
            >
              {(peer.displayName || '?').charAt(0).toUpperCase()}
            </span>
          ),
        )}
      </div>
      {peers.length > 3 && (
        <span aria-hidden className="text-[11px] font-medium text-muted-foreground tabular-nums">
          +{peers.length - 3}
        </span>
      )}
    </div>
  );
};

/** "Ana is typing…" line under the comment composer. */
export const TypingIndicator: React.FC<{ peers: PresencePeer[] }> = ({ peers }) => {
  if (peers.length === 0) return null;
  const names = peers.map((p) => p.displayName);
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`;
  return (
    <div className="flex items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground" aria-live="polite">
      <span className="inline-flex gap-0.5" aria-hidden>
        <span className="h-1 w-1 rounded-full bg-muted-foreground motion-safe:animate-pulse" />
        <span
          className="h-1 w-1 rounded-full bg-muted-foreground motion-safe:animate-pulse"
          style={{ animationDelay: '120ms' }}
        />
        <span
          className="h-1 w-1 rounded-full bg-muted-foreground motion-safe:animate-pulse"
          style={{ animationDelay: '240ms' }}
        />
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
};

/** Placeholder rows while a list loads, so the layout doesn't jump. */
export const ListSkeleton: React.FC<{ rows?: number; label: string }> = ({ rows = 3, label }) => (
  <div className="space-y-4" role="status" aria-label={label}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-3">
        <div className="h-8 w-8 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

/** Task activity feed (Activity tab). */
export const ActivityList: React.FC<{ events: ActivityEvent[]; loading: boolean }> = ({
  events,
  loading,
}) => {
  if (loading) return <ListSkeleton label="Loading activity" />;
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity yet — changes, subtasks and comments will show up here.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {events.map((ev) => (
        <li key={ev.activityId} className="flex items-start gap-3 text-sm">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted',
              ev.type === 'task_created' && 'bg-success-soft',
              (ev.type === 'subtask_created' || ev.type === 'subtask_done') && 'bg-info-soft',
            )}
          >
            {ev.type === 'task_created' && <CheckCircle2 className="h-3 w-3 text-success-soft-foreground" />}
            {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && (
              <ListTree className="h-3 w-3 text-info-soft-foreground" />
            )}
            {ev.type === 'comment_added' && <MessageSquare className="h-3 w-3 text-muted-foreground" />}
          </span>
          <p className="min-w-0 flex-1 leading-6">
            <span className="font-medium text-foreground">{ev.displayName}</span>
            <span className="text-muted-foreground">
              {ev.type === 'task_created' && ' created this task'}
              {ev.type === 'subtask_created' && ' added subtask '}
              {ev.type === 'subtask_done' && ' completed subtask '}
              {ev.type === 'comment_added' && ' commented'}
            </span>
            {(ev.type === 'subtask_created' || ev.type === 'subtask_done') && ev.payload?.subtaskTitle && (
              <span className="text-foreground"> &quot;{ev.payload.subtaskTitle}&quot;</span>
            )}
            <span className="text-muted-foreground tabular-nums"> · {formatDistanceSafe(ev.createdAt)}</span>
          </p>
        </li>
      ))}
    </ol>
  );
};

/** AI TL;DR card shown above long comment threads. */
export const CommentSummaryCard: React.FC<{
  count: number;
  summary: CommentSummary | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
  onSummarize: () => void;
}> = ({ count, summary, loading, error, open, onToggle, onSummarize }) => (
  <section className="rounded-lg border border-border bg-muted/40" aria-label="AI thread summary">
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold leading-tight text-foreground">AI thread summary</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            <span className="tabular-nums">{count}</span> comments · TL;DR with decisions and action items
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {summary && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={open}
            className={cn('h-8 min-h-0 px-2 text-xs', PRESS)}
            onClick={onToggle}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn('h-8 min-h-0 px-2 text-xs', PRESS)}
          disabled={loading}
          onClick={onSummarize}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Reading
            </>
          ) : summary ? (
            'Refresh'
          ) : (
            <>
              <Sparkles aria-hidden />
              Summarize
            </>
          )}
        </Button>
      </div>
    </div>
    {open && (
      <div className="space-y-3 border-t border-border px-3 py-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {loading && !summary && (
          <div className="space-y-2" role="status" aria-label="Summarizing">
            <div className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
          </div>
        )}
        {summary && (
          <>
            {summary.tldr && (
              <p className="text-xs leading-relaxed">
                <span className="mr-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">TL;DR</span>
                {summary.tldr}
              </p>
            )}
            {summary.decisions.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Decisions</p>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {summary.decisions.map((d, i) => (
                    <li key={i} className="flex gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" aria-hidden />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.openQuestions.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Open questions</p>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {summary.openQuestions.map((q, i) => (
                    <li key={i} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.actionItems.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Action items</p>
                <ul className="space-y-1 text-xs leading-relaxed">
                  {summary.actionItems.map((a, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="shrink-0 text-primary" aria-hidden>→</span>
                      <span>
                        <span className="font-medium">{a.owner}:</span> {a.what}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    )}
  </section>
);
