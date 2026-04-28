import React, { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Calendar,
  MessageSquare,
  Paperclip,
  Lock,
  AlertTriangle,
  CheckSquare,
  Check,
  KeyRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PresencePeer } from '@/hooks/usePresence';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { isTaskLockUnlockedInSession } from '@/lib/taskLockPin';

/** Stable id for dnd-kit when `task` is missing (hooks must run before any return). */
const PLACEHOLDER_SORTABLE_ID = '__task-card-placeholder__';

interface TaskCardProps {
  task: Task | null | undefined;
  onClick?: (task: Task, event?: React.MouseEvent) => void;
  isDragging?: boolean;
  /** When true, render in selectable mode with checkbox + selected state. */
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (taskId: string, event: React.MouseEvent) => void;
  /** Realtime peers currently focused on this task (excluding self). */
  peersOnTask?: PresencePeer[];
  /** When true, card cannot be dragged (e.g. locked task for non-privileged user). */
  dragDisabled?: boolean;
  /** First pick in swap-two-tasks mode. */
  swapHighlight?: boolean;
}

const PRIORITY_TONES: Record<
  string,
  { dot: string; label: string; chip: string }
> = {
  high: {
    dot: 'bg-destructive',
    label: 'High',
    chip: 'bg-destructive-soft text-destructive-soft-foreground',
  },
  medium: {
    dot: 'bg-warning',
    label: 'Medium',
    chip:
      'bg-warning-soft text-warning-soft-foreground border border-warning/35',
  },
  low: {
    dot: 'bg-success',
    label: 'Low',
    chip: 'bg-success-soft text-success-soft-foreground',
  },
};

/** Human-friendly relative day label, e.g. "Today", "Tomorrow", "in 3d", "2d ago". */
const relativeDay = (date: Date): string => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 1 && diffDays <= 6) return `in ${diffDays}d`;
  if (diffDays < -1 && diffDays >= -6) return `${Math.abs(diffDays)}d ago`;
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onClick,
  isDragging,
  selectable = false,
  selected = false,
  onSelectChange,
  peersOnTask,
  dragDisabled = false,
  swapHighlight = false,
}) => {
  const { user } = useAuth();
  const { isAdmin } = useOrganization();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: task?.taskId ?? PLACEHOLDER_SORTABLE_ID,
    data: { type: 'task' as const, task: task ?? undefined },
    disabled: !task || selectable || dragDisabled,
  });

  const subtaskProgress = useMemo(() => {
    if (!task) return null;
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    if (subtasks.length === 0) return null;
    const done = subtasks.filter((s) => s.completed).length;
    return { done, total: subtasks.length, pct: (done / subtasks.length) * 100 };
  }, [task]);

  /**
   * A locked task hides title/description/tags/comment counts on the board until the
   * viewer either (a) is the creator / an assignee / a workspace admin, or (b) has
   * already entered the PIN this session. Not memoized — `isTaskLockUnlockedInSession`
   * reads sessionStorage and must re-run every render after unlock.
   */
  let isLockMasked = false;
  if (task?.isLocked) {
    if (task.hasLockPin && !isTaskLockUnlockedInSession(task.taskId)) {
      isLockMasked = true;
    } else if (!user) {
      isLockMasked = true;
    } else if (isAdmin) {
      isLockMasked = false;
    } else if (task.createdBy === user.userId) {
      isLockMasked = false;
    } else if (
      Array.isArray(task.assignees) &&
      task.assignees.some((a) => a.userId === user.userId)
    ) {
      isLockMasked = false;
    } else {
      isLockMasked = true;
    }
  }

  if (!task) return null;

  const assignees = Array.isArray(task.assignees) ? task.assignees : [];
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  const commentsCount =
    typeof task.commentsCount === 'number' ? task.commentsCount : 0;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCurrentlyDragging = isDragging || isSortableDragging;

  const isOverdue =
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== 'done';

  const priorityTone =
    task.priority && PRIORITY_TONES[task.priority]
      ? PRIORITY_TONES[task.priority]
      : null;

  const priorityColor = task.priorityColor || 'hsl(var(--muted-foreground))';
  const isUrgentActive = Boolean(task.urgent && task.status !== 'done');

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeftColor: isUrgentActive ? 'hsl(var(--destructive))' : priorityColor,
      }}
      {...(selectable ? {} : attributes)}
      {...(selectable ? {} : listeners)}
      onClick={(e) => {
        if (selectable && onSelectChange) {
          onSelectChange(task.taskId, e);
          return;
        }
        onClick?.(task, e);
      }}
      className={cn(
        'group relative mb-2.5 rounded-lg border border-border/70 border-l-[3px] bg-background/80 p-3 text-card-foreground shadow-sm',
        'transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-md',
        isUrgentActive &&
          'border-destructive/45 bg-destructive/[0.07] ring-1 ring-destructive/25 hover:border-destructive/50 hover:bg-destructive/[0.09]',
        selectable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        swapHighlight && 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background',
        isCurrentlyDragging && 'opacity-60 shadow-lg',
        // Compact density
        '[.dense_&]:p-2 [.dense_&]:mb-1.5',
      )}
      data-task-card
    >
      {/* Selection checkbox in selectable mode */}
      {selectable && (
        <div
          className={cn(
            'absolute top-2 right-2 w-4 h-4 rounded-sm border flex items-center justify-center transition-colors',
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background border-border',
          )}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </div>
      )}

      {/* Realtime peer indicator: shows up to 3 avatars of other users
          currently viewing this task. */}
      {!selectable && peersOnTask && peersOnTask.length > 0 && (
        <div
          className="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-card border border-border shadow-sm"
          title={`${peersOnTask
            .map((p) => p.displayName)
            .join(', ')} viewing this task`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="flex -space-x-1.5">
            {peersOnTask.slice(0, 3).map((peer) => (
              <span key={peer.userId} className="block">
                {peer.photoURL ? (
                  <img
                    src={peer.photoURL}
                    alt={peer.displayName}
                    className="w-4 h-4 rounded-full ring-1 ring-card object-cover"
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-primary-soft text-primary-soft-foreground text-[8px] font-semibold flex items-center justify-center ring-1 ring-card">
                    {(peer.displayName || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
            ))}
          </span>
          {peersOnTask.length > 3 && (
            <span className="text-[9px] text-muted-foreground font-medium">
              +{peersOnTask.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Title row */}
      <div className="flex items-start gap-2 mb-1.5">
        {isLockMasked ? (
          <div className="flex-1 flex items-center gap-2 rounded-md bg-warning-soft/60 px-2 py-1.5 ring-1 ring-warning/30">
            <Lock className="w-3.5 h-3.5 text-warning-soft-foreground shrink-0" />
            <span className="text-[12px] font-medium text-warning-soft-foreground tracking-wide">
              Locked task
            </span>
            {task.hasLockPin && (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning-soft-foreground/80"
                title="A PIN is required to view"
              >
                <KeyRound className="w-3 h-3" />
                PIN
              </span>
            )}
          </div>
        ) : (
          <h4 className="flex-1 font-medium text-sm text-foreground line-clamp-2 [.dense_&]:text-[13px] leading-snug">
            {task.title}
          </h4>
        )}
      </div>

      {!isLockMasked && task.description && (
        <p className="text-xs text-muted-foreground/90 mb-2 line-clamp-2 [.dense_&]:hidden">
          {task.description}
        </p>
      )}

      {isLockMasked && (
        <p className="text-[11px] text-muted-foreground mb-2 [.dense_&]:hidden">
          Title, description, and comments are hidden until you unlock this task.
        </p>
      )}

      {/* Subtask progress */}
      {!isLockMasked && subtaskProgress && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-0.5">
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="w-3 h-3" />
              {subtaskProgress.done}/{subtaskProgress.total}
            </span>
            <span>{Math.round(subtaskProgress.pct)}%</span>
          </div>
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${subtaskProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Tags */}
      {!isLockMasked && task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 [.dense_&]:hidden">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground"
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer row: chips + assignees */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {priorityTone && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                priorityTone.chip,
              )}
              title={`Priority: ${priorityTone.label}`}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', priorityTone.dot)} />
              {priorityTone.label}
            </span>
          )}

          {task.urgent && (
            <span className="inline-flex items-center gap-1 rounded-md bg-destructive-soft px-1.5 py-0.5 text-[10px] font-medium text-destructive-soft-foreground">
              <AlertTriangle className="w-3 h-3" />
              Urgent
            </span>
          )}

          {task.isLocked && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning-soft-foreground"
              title="Locked - only visible to creator, assignees, and project owner"
            >
              <Lock className="w-3 h-3" />
              Locked
            </span>
          )}

          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                isOverdue
                  ? 'bg-destructive-soft text-destructive-soft-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
              title={new Date(task.dueDate).toLocaleDateString()}
            >
              <Calendar className="w-3 h-3" />
              {relativeDay(new Date(task.dueDate))}
            </span>
          )}

          {!isLockMasked && commentsCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageSquare className="w-3 h-3" />
              {commentsCount}
            </span>
          )}

          {!isLockMasked && attachments.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Paperclip className="w-3 h-3" />
              {attachments.length}
            </span>
          )}
        </div>

        {!isLockMasked && assignees.length > 0 && (
          <div className="flex -space-x-1.5 shrink-0">
            {assignees.slice(0, 3).map((assignee) => (
              <Avatar
                key={assignee.userId}
                className="w-6 h-6 border-2 border-card ring-0 [.dense_&]:w-5 [.dense_&]:h-5"
                title={assignee?.displayName}
              >
                <AvatarImage
                  src={assignee?.photoURL}
                  alt={assignee?.displayName}
                />
                <AvatarFallback className="text-[10px] bg-primary-soft text-primary-soft-foreground font-medium">
                  {(assignee?.displayName || '').charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 && (
              <div
                className="w-6 h-6 rounded-full bg-secondary border-2 border-card flex items-center justify-center [.dense_&]:w-5 [.dense_&]:h-5"
                title={assignees
                  .slice(3)
                  .map((a) => a.displayName)
                  .join(', ')}
              >
                <span className="text-[10px] text-secondary-foreground font-medium">
                  +{assignees.length - 3}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
