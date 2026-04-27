import React, { useState } from 'react';
import { TaskStatus, TASK_COLUMNS } from '@/types';
import type { KanbanColumn } from '@/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Clock, AlertCircle, Eye, ChevronDown } from 'lucide-react';

interface StatusFiltersProps {
  selectedStatus: TaskStatus | 'all';
  onStatusChange: (status: TaskStatus | 'all') => void;
  taskCounts: Record<string, number>;
  /** When provided, sidebar shows these columns (from board) so renames and new columns stay in sync */
  columns?: KanbanColumn[];
}

const STATUS_ICONS: Record<string, React.ElementType> = {
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
  columns: columnsProp,
}) => {
  const [open, setOpen] = useState(true);
  const columns = columnsProp && columnsProp.length > 0
    ? columnsProp.map((c) => ({ id: c.id, title: c.title, color: c.color }))
    : TASK_COLUMNS;

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 mb-0 px-1 py-0.5 rounded-md hover:bg-secondary/60 transition-colors text-left"
        aria-expanded={open}
      >
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Kanban Task
        </h3>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ease-out',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <nav className="space-y-1 pt-2">
            <button
              onClick={() => onStatusChange('all')}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                selectedStatus === 'all'
                  ? 'bg-primary-soft text-primary-soft-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span>All task</span>
              </div>
              <span className="text-xs text-muted-foreground">({taskCounts.all ?? 0})</span>
            </button>

            {columns.map((column) => {
              const Icon = STATUS_ICONS[column.id] ?? Circle;
              const isActive = selectedStatus === column.id;

              return (
                <button
                  key={column.id}
                  onClick={() => onStatusChange(column.id)}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary-soft text-primary-soft-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" style={{ color: column.color }} />
                    <span>{column.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">({taskCounts[column.id] ?? 0})</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
};

export default StatusFilters;
