import React from 'react';
import { Lock, LockOpen, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PROJECT_LOCK_COPY,
  projectProgress,
  type ProjectLockState,
} from '@/components/workspace/projectCardModel';

interface ProjectCardProps {
  project: {
    projectId: string;
    name: string;
    description?: string | null;
    coverColor?: string | null;
    stats?: { totalTasks?: number | null; completedTasks?: number | null } | null;
  };
  /** Open the project (the whole card is the click target). */
  onOpen: () => void;
  /** Lock control beside the name; omit for none. */
  lock?: { state: ProjectLockState; onClick: (e: React.MouseEvent) => void } | null;
  /** `DropdownMenuItem`s for the options menu; omit for no menu. */
  menu?: React.ReactNode;
  /** Small line under the progress, e.g. who owns a shared project. */
  note?: React.ReactNode;
}

/**
 * One project on the workspace home page: colour square, name, lock state,
 * options menu, one-line description and a plain progress bar.
 */
export const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen, lock, menu, note }) => {
  const { done, total, percent } = projectProgress(project.stats);
  const lockCopy = lock ? PROJECT_LOCK_COPY[lock.state] : null;
  const LockIcon = lock?.state === 'locked' ? Lock : LockOpen;

  return (
    <article className="relative flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex min-h-7 items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: project.coverColor || undefined }}
        />
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">
          {/* The ::after stretches over the card so the whole card opens the project. */}
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {project.name}
          </button>
        </h3>
        {lock && lockCopy && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative z-[1] shrink-0 rounded-full px-2 text-muted-foreground"
            title={lockCopy.title}
            aria-label={lockCopy.ariaLabel}
            onClick={(e) => {
              e.stopPropagation();
              lock.onClick(e);
            }}
          >
            <LockIcon className="h-3.5 w-3.5" aria-hidden />
            <span>{lockCopy.label}</span>
          </Button>
        )}
        {menu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Project options"
                className="relative z-[1] w-10 shrink-0 px-0 text-muted-foreground md:w-7"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="min-h-5 truncate text-[13px] text-muted-foreground">
        {project.description || 'No description'}
      </p>

      <div className="flex flex-col gap-1.5">
        <div
          className="h-1 overflow-hidden rounded-full bg-foreground/10"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Task completion"
        >
          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-xs tabular-nums text-muted-foreground">
          <span className="min-w-0 truncate">
            {done} of {total} tasks done
          </span>
          <span>{percent}%</span>
        </div>
        {note && <p className="truncate text-xs text-muted-foreground">{note}</p>}
      </div>
    </article>
  );
};

export default ProjectCard;
