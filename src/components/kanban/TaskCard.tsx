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
  CheckSquare,
  Check,
  KeyRound,
  Video,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PriorityPill,
  TASK_LEVEL_SURFACE,
  TASK_PILL,
  UrgentBadge,
  taskLevel,
} from '@/components/common/TaskBadges';
import { getMeetingStatus, toMeetingDate } from './task-modal/meeting';
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
  /** Shows a ✓ circle that marks the task done in one click. */
  onMarkDone?: (task: Task) => void;
}

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
  onMarkDone,
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

  // Meeting badge — status is computed at render (the board refetches often
  // enough that "In 2 h" / "Live now" stays current without a timer per card).
  const meetingStart = toMeetingDate(task.meetingStartsAt);
  const meeting = meetingStart
    ? { start: meetingStart, status: getMeetingStatus(meetingStart, task.meetingDurationMinutes, new Date()) }
    : null;


  const isDone = task.status === 'done';
  // How loud the card is: urgent > high priority > everything else.
  const level = taskLevel(task);

  return (
    <div
      ref={setNodeRef}
      data-no-pan
      style={style}
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
        'group relative mb-2 flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground',
        'transition-[border-color,box-shadow] duration-150 hover:shadow-sm',
        TASK_LEVEL_SURFACE[level],
        level === 'urgent' && 'hover:border-destructive/70',
        level === 'high' && 'hover:border-destructive/50',
        level === 'normal' && 'hover:border-foreground/25',
        selectable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        swapHighlight && 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background',
        isCurrentlyDragging && 'opacity-60 shadow-lg',
        // Compact density
        '[.dense_&]:gap-1.5 [.dense_&]:p-2 [.dense_&]:mb-1.5',
      )}
      data-task-card
      data-level={level}
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

      {/* Label row: urgency and priority lead, so the eye lands on them first. */}
      {(task.urgent || task.priority || task.isLocked || (!isLockMasked && task.tags && task.tags.length > 0)) && (
        <div className={cn('flex flex-wrap items-center gap-1', selectable && 'pr-6')}>
          {task.urgent && <UrgentBadge muted={isDone} />}

          <PriorityPill priority={task.priority} color={task.priorityColor} muted={isDone} />

          {task.isLocked && (
            <span
              className={cn(TASK_PILL, 'border-warning/40 bg-warning-soft text-warning-soft-foreground')}
              title="Locked - only visible to creator, assignees, and project owner"
            >
              <Lock className="h-3 w-3" aria-hidden />
              Locked
            </span>
          )}

          {!isLockMasked &&
            task.tags &&
            task.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex h-5 items-center rounded border border-border bg-background px-1.5 text-xs text-muted-foreground [.dense_&]:hidden"
              >
                {tag}
              </span>
            ))}
          {!isLockMasked && task.tags && task.tags.length > 3 && (
            <span className="text-xs text-muted-foreground [.dense_&]:hidden">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Title row */}
      <div className="flex items-start gap-2">
        {onMarkDone && !selectable && !isLockMasked && !dragDisabled && (
          <button
            type="button"
            aria-label={`Mark "${task.title}" as done`}
            title="Mark as done"
            // Keep the press from starting a card drag or opening the task.
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMarkDone(task);
            }}
            className="group/done -m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.92] transition-transform duration-150 ease-out [.dense_&]:h-7 [.dense_&]:w-7"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-muted-foreground/50 bg-background text-transparent transition-colors duration-150 group-hover/done:border-success group-hover/done:bg-success group-hover/done:text-success-foreground">
              <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
            </span>
          </button>
        )}
        {isLockMasked ? (
          <div className="flex-1 flex items-center gap-2 rounded-md bg-warning-soft/60 px-2 py-1.5 ring-1 ring-warning/30">
            <Lock className="w-3.5 h-3.5 text-warning-soft-foreground shrink-0" />
            <span className="text-xs font-medium text-warning-soft-foreground tracking-wide">
              Locked task
            </span>
            {task.hasLockPin && (
              <span
                className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] uppercase tracking-wider text-warning-soft-foreground/80"
                title="A PIN is required to view"
              >
                <KeyRound className="w-3 h-3" />
                PIN
              </span>
            )}
          </div>
        ) : (
          <h4
            className={cn(
              'flex-1 text-sm font-medium leading-snug line-clamp-2 [.dense_&]:text-sm',
              isDone ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {task.title}
          </h4>
        )}
      </div>

      {!isLockMasked && task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 [.dense_&]:hidden">
          {task.description}
        </p>
      )}

      {isLockMasked && (
        <p className="text-xs text-muted-foreground [.dense_&]:hidden">
          Title, description, and comments are hidden until you unlock this task.
        </p>
      )}

      {/* Subtask progress */}
      {!isLockMasked && subtaskProgress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckSquare className="h-3 w-3 shrink-0" aria-hidden />
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-foreground/70 transition-all"
              style={{ width: `${subtaskProgress.pct}%` }}
            />
          </div>
          <span className="tabular-nums">
            {subtaskProgress.done}/{subtaskProgress.total}
          </span>
        </div>
      )}

      {/* Footer row: dates, counts + assignees */}
      <div className="flex min-h-5 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                isOverdue && 'font-medium text-destructive',
              )}
              title={new Date(task.dueDate).toLocaleDateString()}
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {relativeDay(new Date(task.dueDate))}
            </span>
          )}

          {meeting && meeting.status.kind !== 'ended' && (
            <span
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-xs font-medium tabular-nums',
                meeting.status.kind === 'live'
                  ? 'bg-destructive-soft text-destructive-soft-foreground'
                  : meeting.status.kind === 'soon'
                    ? 'bg-warning-soft text-warning-soft-foreground'
                    : 'bg-secondary text-secondary-foreground',
              )}
              title={`Meeting: ${meeting.start.toLocaleString()}`}
            >
              <Video className="w-3 h-3" aria-hidden />
              {meeting.status.kind === 'upcoming'
                ? meeting.start.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
                : meeting.status.label}
            </span>
          )}

          {!isLockMasked && commentsCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {commentsCount}
            </span>
          )}

          {!isLockMasked && attachments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {attachments.length}
            </span>
          )}
        </div>

        {!isLockMasked && assignees.length > 0 && (
          <div className="flex -space-x-1.5 shrink-0">
            {assignees.slice(0, 3).map((assignee) => (
              <Avatar
                key={assignee.userId}
                className="h-5 w-5 border-2 border-card ring-0"
                title={assignee?.displayName}
              >
                <AvatarImage
                  src={assignee?.photoURL}
                  alt={assignee?.displayName}
                />
                <AvatarFallback className="text-[0.6875rem] bg-primary-soft text-primary-soft-foreground font-medium">
                  {(assignee?.displayName || '').charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 && (
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-secondary"
                title={assignees
                  .slice(3)
                  .map((a) => a.displayName)
                  .join(', ')}
              >
                <span className="text-[0.6875rem] text-secondary-foreground font-medium">
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
