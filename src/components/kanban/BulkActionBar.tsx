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

const Divider = () => <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" />;

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
        // The wrapper centres the bar; the bar itself only animates, so the
        // motion transform never fights the centring.
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-border bg-card p-1.5 text-sm text-foreground shadow-lg"
            role="toolbar"
            aria-label="Bulk task actions"
          >
            <div className="flex items-center gap-2 px-2">
              <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="whitespace-nowrap font-medium tabular-nums">
                {count} selected
                {tasks.length > count && (
                  <button
                    type="button"
                    className="ml-2 rounded-sm text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={onSelectAll}
                  >
                    Select all {tasks.length}
                  </button>
                )}
              </span>
            </div>

            <Divider />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost">
                  <CheckCircle2 aria-hidden />
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
                      aria-hidden
                      className="mr-2 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: col.color }}
                    />
                    {col.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost">
                  <Flag aria-hidden />
                  Priority
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => onSetPriority('high')}>
                  <span aria-hidden className="mr-2 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                  High
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetPriority('medium')}>
                  <span aria-hidden className="mr-2 h-2 w-2 shrink-0 rounded-full bg-warning" />
                  Medium
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetPriority('low')}>
                  <span aria-hidden className="mr-2 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60" />
                  Low
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost">
                  <Calendar aria-hidden />
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

            <Divider />

            {confirmDelete ? (
              <div className="flex items-center gap-1 pl-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span className="mr-1 whitespace-nowrap font-medium tabular-nums">Delete {count}?</span>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={async () => {
                    await onDelete();
                    setConfirmDelete(false);
                  }}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={onClear}
              aria-label="Clear selection"
            >
              <X aria-hidden />
            </Button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default BulkActionBar;
