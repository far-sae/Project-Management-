import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Task } from '@/types';
import { TaskCard } from './TaskCard';
import { Plus, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface KanbanColumnProps {
  id: string;
  title: string;
  color: string;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onAddTask?: (status: string) => void;
  onEditColumn?: () => void;
}

export const KanbanColumnComponent: React.FC<KanbanColumnProps> = ({
  id,
  title,
  color,
  tasks,
  onTaskClick,
  onAddTask,
  onEditColumn,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { status: id },
  });

  return (
    <div
      className={cn(
        'flex flex-col w-72 min-w-72 bg-gray-50 rounded-xl',
        isOver && 'ring-2 ring-orange-400 ring-opacity-50'
      )}
    >
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h3 className="font-semibold text-gray-700">{title}</h3>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
              {tasks.length}
            </span>
            {onEditColumn && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-gray-400 hover:text-gray-600"
                onClick={onEditColumn}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-500 hover:text-gray-700"
          onClick={() => onAddTask?.(id)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add task
        </Button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 p-3 overflow-y-auto min-h-[200px] max-h-[calc(100vh-280px)]',
          isOver && 'bg-orange-50'
        )}
      >
        <SortableContext
          items={tasks.map((t) => t.taskId)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.taskId}
              task={task}
              onClick={onTaskClick}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-24 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-400">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Keep old name for backward compatibility
export const KanbanColumn = KanbanColumnComponent;

export default KanbanColumnComponent;
