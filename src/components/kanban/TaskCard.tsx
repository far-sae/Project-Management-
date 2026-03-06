import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar, MessageSquare, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
  isDragging?: boolean;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick, isDragging }) => {
  if (!task) return null;

  const assignees = Array.isArray(task.assignees) ? task.assignees : [];
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  const commentsCount = typeof task.commentsCount === 'number' ? task.commentsCount : 0;
  const priorityColor = task.priorityColor || '#9E9E9E';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: task.taskId,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCurrentlyDragging = isDragging || isSortableDragging;

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: priorityColor }}
      {...attributes}
      {...listeners}
      onClick={() => onClick?.(task)}
      className={cn(
        'bg-white rounded-lg shadow-sm p-4 mb-3 border-l-4 cursor-grab active:cursor-grabbing transition-all hover:shadow-md',
        isCurrentlyDragging && 'opacity-50 shadow-lg rotate-2',
      )}
    >
      <h4 className="font-medium text-gray-900 mb-2 line-clamp-2">{task.title}</h4>

      {task.description && (
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-3 flex-wrap">
          {task.urgent && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
              Urgent
            </span>
          )}
          {task.dueDate && (
            <div
              className={cn(
                'flex items-center gap-1',
                isOverdue && 'text-red-500'
              )}
            >
              <Calendar className="w-4 h-4" />
              <span>{formatDate(task.dueDate)}</span>
            </div>
          )}

          {commentsCount > 0 && (
            <div className="flex items-center gap-1">
              <MessageSquare className="w-4 h-4" />
              <span>{commentsCount}</span>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex items-center gap-1">
              <Paperclip className="w-4 h-4" />
              <span>{attachments.length}</span>
            </div>
          )}
        </div>

        {assignees.length > 0 && (
          <div className="flex -space-x-2">
            {assignees.slice(0, 3).map((assignee) => (
              <Avatar
                key={assignee.userId}
                className="w-6 h-6 border-2 border-white"
              >
                <AvatarImage src={assignee?.photoURL} alt={assignee?.displayName} />
                <AvatarFallback className="text-xs bg-orange-100 text-orange-700">
                  {(assignee?.displayName || '').charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center">
                <span className="text-xs text-gray-600">+{assignees.length - 3}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
