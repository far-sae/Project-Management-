import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useProjects } from '@/hooks/useProjects';
import { moveTaskToProject } from '@/services/supabase/taskMove';
import { DEFAULT_COLUMNS, type KanbanColumn } from '@/types/task';
import type { Project } from '@/types';

interface MoveTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: { taskId: string; title: string; status: string } | null;
  currentProjectId: string;
  projects: Project[];
  /** Called with the new project id after a successful move. */
  onMoved?: (projectId: string) => void;
}

function columnsOf(project: Project | undefined): KanbanColumn[] {
  const cols = project?.columns?.length ? project.columns : DEFAULT_COLUMNS;
  return [...cols].sort((a, b) => a.order - b.order);
}

/**
 * Pick the project a task should have been in (and which column) and move it
 * there, along with its sub-tasks, comments, files and history.
 */
export const MoveTaskDialog: React.FC<MoveTaskDialogProps> = ({
  open,
  onOpenChange,
  task,
  currentProjectId,
  projects,
  onMoved,
}) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [column, setColumn] = useState<string>('');
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (open) {
      setChoice(null);
      setColumn('');
      setQuery('');
    }
  }, [open, task?.taskId]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects
      .filter((p) => p.projectId !== currentProjectId)
      .filter((p) => !q || (p.name ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [projects, currentProjectId, query]);

  const target = projects.find((p) => p.projectId === choice);
  const targetColumns = useMemo(() => columnsOf(target), [target]);

  const pickProject = (projectId: string) => {
    setChoice(projectId);
    const cols = columnsOf(projects.find((p) => p.projectId === projectId));
    const same = cols.find((c) => c.id === task?.status);
    setColumn(same?.id ?? cols[0]?.id ?? '');
  };

  const handleMove = async () => {
    if (!task || !choice) return;
    setMoving(true);
    try {
      await moveTaskToProject(task.taskId, choice, column || null);
      toast.success(`Moved "${task.title}" to ${target?.name ?? 'the other project'}`);
      onOpenChange(false);
      onMoved?.(choice);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move the task');
    } finally {
      setMoving(false);
    }
  };

  const otherProjects = projects.filter((p) => p.projectId !== currentProjectId).length;

  return (
    <Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">Move “{task?.title}”</DialogTitle>
          <DialogDescription>
            Choose the project this task belongs in. Its sub-tasks, comments, files and history move
            with it.
          </DialogDescription>
        </DialogHeader>

        {otherProjects === 0 ? (
          <p className="text-sm text-muted-foreground">There's no other project to move it to.</p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                aria-label="Search projects"
                className="pl-8"
                disabled={moving}
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Destination project"
              className="max-h-64 space-y-1.5 overflow-y-auto"
            >
              {options.length === 0 && (
                <p className="px-1 py-2 text-sm text-muted-foreground">No projects match.</p>
              )}
              {options.map((p) => {
                const selected = choice === p.projectId;
                return (
                  <button
                    key={p.projectId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.name}
                    disabled={moving}
                    onClick={() => pickProject(p.projectId)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border hover:bg-secondary',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: p.coverColor || 'hsl(var(--primary))' }}
                        aria-hidden
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>

            {choice && (
              <div className="space-y-1.5">
                <label htmlFor="move-task-column" className="text-sm font-medium">
                  Column
                </label>
                <select
                  id="move-task-column"
                  value={column}
                  onChange={(e) => setColumn(e.target.value)}
                  disabled={moving}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {targetColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleMove()} disabled={!choice || moving}>
            {moving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Same dialog, loading the user's projects itself. Mount only while open. */
export const MoveTaskDialogWithProjects: React.FC<Omit<MoveTaskDialogProps, 'projects'>> = (props) => {
  const { projects } = useProjects();
  return <MoveTaskDialog {...props} projects={projects} />;
};
