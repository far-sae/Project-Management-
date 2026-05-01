import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon, Check, Loader2, Mail, Phone,
  Plus, RotateCcw, Trash2, Users as UsersIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import { useClientTasks } from '@/hooks/useClientTasks';
import {
  ClientTask, ClientTaskType, TASK_TYPE_LABEL,
} from '@/services/supabase/clientTasks';
import { Client } from '@/services/supabase/clients';
import { toast } from 'sonner';
import { NewClientTaskDialog } from './NewClientTaskDialog';

const TYPE_ICON: Record<ClientTaskType, React.ElementType> = {
  todo: Check,
  call: Phone,
  email: Mail,
  meeting: UsersIcon,
  followup: RotateCcw,
};

const BUCKET_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  thisweek: 'This week',
  later: 'Later',
  noDate: 'No due date',
};

const BUCKET_BADGE: Record<string, string> = {
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  today: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  thisweek: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  later: 'bg-secondary text-secondary-foreground',
  noDate: 'bg-secondary text-secondary-foreground',
};

interface Props {
  clients: Client[];
  /** When set, only this client's tasks render (for use inside ClientDetailDrawer). */
  scopedClientId?: string | null;
  /** When true, only "my tasks" filter is shown. */
  defaultMineOnly?: boolean;
  /** Compact list (used inside drawer). */
  compact?: boolean;
}

export const ClientTasksList: React.FC<Props> = ({
  clients,
  scopedClientId,
  defaultMineOnly,
  compact,
}) => {
  const [mineOnly, setMineOnly] = useState(!!defaultMineOnly);
  const [showNew, setShowNew] = useState(false);
  const { tasks, allTasks, buckets, loading, toggleDone, remove } = useClientTasks({
    clientId: scopedClientId ?? undefined,
    mineOnly,
  });

  const doneList = useMemo(
    () => tasks.filter((t) => t.status === 'done').slice(0, 20),
    [tasks],
  );

  const renderRow = (task: ClientTask) => {
    const Icon = TYPE_ICON[task.type] ?? Check;
    const overdue = task.dueAt && isPast(task.dueAt) && task.status !== 'done';
    const clientLabel =
      clients.find((c) => c.clientId === task.clientId)?.name ?? null;
    return (
      <li
        key={task.taskId}
        className="group flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2"
      >
        <button
          type="button"
          onClick={() =>
            toggleDone(task).catch((e) =>
              toast.error(e instanceof Error ? e.message : 'Failed'),
            )
          }
          className={cn(
            'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            task.status === 'done'
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-muted-foreground/40 hover:border-foreground',
          )}
          aria-label={task.status === 'done' ? 'Reopen task' : 'Mark done'}
        >
          {task.status === 'done' && <Check className="w-2.5 h-2.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span
              className={cn(
                'text-sm font-medium truncate',
                task.status === 'done' && 'line-through text-muted-foreground',
              )}
            >
              {task.title}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            <span>{TASK_TYPE_LABEL[task.type]}</span>
            {task.dueAt && (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  overdue && 'text-red-600 dark:text-red-400 font-medium',
                )}
              >
                <CalendarIcon className="w-3 h-3" />
                {format(task.dueAt, 'MMM d, p')}
                {overdue && (
                  <span>
                    ({formatDistanceToNow(task.dueAt, { addSuffix: true })})
                  </span>
                )}
              </span>
            )}
            {!scopedClientId && clientLabel && (
              <span className="inline-flex items-center gap-1">
                · {clientLabel}
              </span>
            )}
            {task.assignedToName && (
              <span>· {task.assignedToName}</span>
            )}
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          aria-label="Delete task"
          onClick={() =>
            remove(task.taskId).catch((e) =>
              toast.error(e instanceof Error ? e.message : 'Failed'),
            )
          }
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </li>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      {!compact && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mineOnly ? 'default' : 'outline'}
              onClick={() => setMineOnly((v) => !v)}
            >
              {mineOnly ? 'Showing my tasks' : 'Show my tasks'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {tasks.filter((t) => t.status === 'pending').length} open ·{' '}
              {tasks.filter((t) => t.status === 'done').length} done
            </span>
          </div>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New task
          </Button>
        </div>
      )}

      {compact && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> New task
          </Button>
        </div>
      )}

      {(['overdue', 'today', 'thisweek', 'later', 'noDate'] as const).map(
        (bucket) => {
          const list = buckets[bucket];
          if (!list || list.length === 0) return null;
          return (
            <div key={bucket} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-2">
                {BUCKET_LABEL[bucket]}
                <Badge variant="outline" className={BUCKET_BADGE[bucket]}>
                  {list.length}
                </Badge>
              </h4>
              <ul className="space-y-1.5">{list.map(renderRow)}</ul>
            </div>
          );
        },
      )}

      {tasks.filter((t) => t.status === 'pending').length === 0 && (
        <Card>
          <CardContent className="text-center py-6 text-sm text-muted-foreground">
            No open tasks. Click <strong>New task</strong> to add a follow-up.
          </CardContent>
        </Card>
      )}

      {!compact && doneList.length > 0 && (
        <details className="rounded-md border border-border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recently completed ({doneList.length})
          </summary>
          <ul className="space-y-1.5 px-2 pb-2">{doneList.map(renderRow)}</ul>
        </details>
      )}

      <NewClientTaskDialog
        open={showNew}
        onOpenChange={setShowNew}
        clients={clients}
        defaultClientId={scopedClientId ?? null}
      />
      {/* Reference allTasks just so the lint rule for unused returns doesn't strip it */}
      <span className="hidden">{allTasks.length}</span>
    </div>
  );
};

export default ClientTasksList;
