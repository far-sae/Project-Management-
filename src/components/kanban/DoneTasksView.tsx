import React, { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, ChevronDown, RotateCcw, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { boardColumnsWithoutDone, isCompletedTaskStatus } from '@/lib/kanbanTaskColumn';
import { finishedAt, groupDoneTasks } from '@/lib/doneTasks';
import type { KanbanColumn, Task } from '@/types';

interface DoneTasksViewProps {
  tasks: Task[];
  columns: KanbanColumn[];
  searchQuery: string;
  /** False for view-only members: no Reopen. */
  canEdit: boolean;
  onReopen: (task: Task, columnId: string) => Promise<void> | void;
  onOpenTask: (taskId: string) => void;
}

/** The project's finished tasks, newest first, with one-click Reopen. */
export const DoneTasksView: React.FC<DoneTasksViewProps> = ({
  tasks,
  columns,
  searchQuery,
  canEdit,
  onReopen,
  onOpenTask,
}) => {
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const doneTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        !t.parentTaskId &&
        isCompletedTaskStatus(t.status, columns) &&
        (!q || t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)),
    );
  }, [tasks, columns, searchQuery]);

  const groups = useMemo(() => groupDoneTasks(doneTasks), [doneTasks]);
  const reopenTargets = useMemo(
    () => boardColumnsWithoutDone(columns).sort((a, b) => a.order - b.order),
    [columns],
  );

  const reopen = async (task: Task, columnId: string) => {
    setReopeningId(task.taskId);
    try {
      await onReopen(task, columnId);
    } finally {
      setReopeningId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
          Done
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {doneTasks.length}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Finished tasks from this project. Click the circle on any card in the board to move it here.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
          <CheckCircle2 className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden />
          <p className="text-sm font-medium">
            {searchQuery.trim() ? 'No finished tasks match your search' : 'Nothing finished yet'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the circle on a task card and it will show up here.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-labelledby={`done-${group.label}`}>
            <h3
              id={`done-${group.label}`}
              className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {group.label} · {group.tasks.length}
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {group.tasks.map((task) => (
                <li key={task.taskId} className="flex items-center gap-3 px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                  <button
                    type="button"
                    onClick={() => onOpenTask(task.taskId)}
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate text-sm font-medium text-muted-foreground line-through decoration-muted-foreground/50">
                      {task.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Done {formatDistanceToNow(finishedAt(task), { addSuffix: true })}
                    </span>
                  </button>

                  {task.assignees.length > 0 && (
                    <div className="hidden shrink-0 -space-x-1.5 sm:flex" aria-label="Assignees">
                      {task.assignees.slice(0, 3).map((a) => (
                        <Avatar key={a.userId} className="h-6 w-6 ring-2 ring-card" title={a.displayName}>
                          <AvatarImage src={a.photoURL} alt="" />
                          <AvatarFallback className="text-[10px]">
                            {(a.displayName || '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                  )}

                  {canEdit && reopenTargets.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1 active:scale-[0.97]"
                          disabled={reopeningId === task.taskId}
                          aria-label={`Reopen "${task.title}"`}
                        >
                          {reopeningId === task.taskId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                          )}
                          <span className="hidden sm:inline">Reopen</span>
                          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Move back to</DropdownMenuLabel>
                        {reopenTargets.map((c) => (
                          <DropdownMenuItem key={c.id} onSelect={() => void reopen(task, c.id)}>
                            <span aria-hidden className="mr-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="truncate">{c.title}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};
