import React from 'react';
import { TaskStatus, TASK_COLUMNS } from '@/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Clock, AlertCircle, Eye } from 'lucide-react';

interface StatusFiltersProps {
  selectedStatus: TaskStatus | 'all';
  onStatusChange: (status: TaskStatus | 'all') => void;
  taskCounts: Record<TaskStatus | 'all', number>;
}

const STATUS_ICONS: Record<TaskStatus, React.ElementType> = {
  undefined: Circle,
  todo: Clock,
  inprogress: AlertCircle,
  done: CheckCircle2,
  needreview: Eye,
};

export const StatusFilters: React.FC<StatusFiltersProps> = ({
  selectedStatus,
  onStatusChange,
  taskCounts,
}) => {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Kanban Task
      </h3>
      <nav className="space-y-1">
        <button
          onClick={() => onStatusChange('all')}
          className={cn(
            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            selectedStatus === 'all'
              ? 'bg-orange-100 text-orange-700'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500" />
            <span>All task</span>
          </div>
          <span className="text-xs text-gray-500">({taskCounts.all})</span>
        </button>

        {TASK_COLUMNS.map((column) => {
          const Icon = STATUS_ICONS[column.id];
          const isActive = selectedStatus === column.id;

          return (
            <button
              key={column.id}
              onClick={() => onStatusChange(column.id)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-orange-100 text-orange-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4" style={{ color: column.color }} />
                <span>{column.title}</span>
              </div>
              <span className="text-xs text-gray-500">({taskCounts[column.id] || 0})</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default StatusFilters;
