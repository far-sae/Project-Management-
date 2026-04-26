import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  Calendar,
  Flag,
  Trash2,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
import { Task, KanbanColumn, TaskPriority } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface BulkActionBarProps {
  selectedIds: Set<string>;
  tasks: Task[];
  columns: KanbanColumn[];
  onClear: () => void;
  onSelectAll: () => void;
  onSetStatus: (status: string) => Promise<void> | void;
  onSetPriority: (priority: TaskPriority) => Promise<void> | void;
  onSetDue: (date: Date | null) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

/** Floating bottom action bar shown while at least one task is selected. */
export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedIds,
  tasks,
  columns,
  onClear,
  onSelectAll,
  onSetStatus,
  onSetPriority,
  onSetDue,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const count = selectedIds.size;
  const visible = count > 0;

  const setQuickDue = async (offsetDays: number | null) => {
    if (offsetDays === null) {
      await onSetDue(null);
      return;
    }
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    await onSetDue(d);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={cn(
            'fixed bottom-4 left-1/2 -translate-x-1/2 z-40',
            'flex items-center gap-1 px-2 py-2 rounded-xl',
            'bg-card border border-border shadow-lg',
            'text-sm text-foreground',
          )}
          role="toolbar"
          aria-label="Bulk task actions"
        >
          <div className="flex items-center gap-2 px-2">
            <ListChecks className="w-4 h-4 text-primary" />
            <span className="font-medium">
              {count} selected
              {tasks.length > count && (
                <button
                  type="button"
                  className="ml-2 text-xs text-primary hover:underline"
                  onClick={onSelectAll}
                >
                  Select all {tasks.length}
                </button>
              )}
            </span>
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                Status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Move to column</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuItem
                  key={col.id}
                  onClick={() => onSetStatus(col.id)}
                >
                  <span
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ background: col.color }}
                  />
                  {col.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                <Flag className="w-4 h-4 mr-1.5" />
                Priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onSetPriority('high')}>
                <span className="w-2 h-2 rounded-full bg-destructive mr-2" />
                High
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSetPriority('medium')}>
                <span className="w-2 h-2 rounded-full bg-warning mr-2" />
                Medium
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSetPriority('low')}>
                <span className="w-2 h-2 rounded-full bg-success mr-2" />
                Low
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                <Calendar className="w-4 h-4 mr-1.5" />
                Due
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setQuickDue(0)}>
                Today
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickDue(1)}>
                Tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQuickDue(7)}>
                Next week
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setQuickDue(null)}>
                Clear due date
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-5 bg-border mx-1" />

          {confirmDelete ? (
            <div className="flex items-center gap-1 pl-2 pr-1">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-xs">Delete {count}?</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={async () => {
                  await onDelete();
                  setConfirmDelete(false);
                }}
              >
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BulkActionBar;
