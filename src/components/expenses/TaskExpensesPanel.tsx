import React, { useState } from 'react';
import { Receipt, ExternalLink, Loader2, Check, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTaskExpenses, useExpenses } from '@/hooks/useExpenses';
import {
  Expense,
  ExpenseStatus,
  formatExpenseAmount,
} from '@/services/supabase/expenses';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const statusBadge = (s: ExpenseStatus) => {
  const map: Record<ExpenseStatus, string> = {
    approved:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    rejected:
      'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
    pending:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  };
  return (
    <Badge variant="outline" className={map[s]}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </Badge>
  );
};

interface Props {
  taskId: string;
  taskTitle: string;
  projectId?: string | null;
  projectName?: string | null;
}

/**
 * Compact list of expenses tied to a task. Renders inside TaskModal so
 * owner/admin can see what materials/receipts are attached to the work.
 *
 * Members see only their own expenses (RLS-enforced); owner+admin see all.
 */
export const TaskExpensesPanel: React.FC<Props> = ({
  taskId,
  taskTitle,
  projectId,
  projectName,
}) => {
  const { expenses, loading, reload, canManage } = useTaskExpenses(taskId);
  const { update } = useExpenses();
  const [busyId, setBusyId] = useState<string | null>(null);

  const setStatus = async (expense: Expense, status: ExpenseStatus) => {
    setBusyId(expense.expenseId);
    try {
      await update(expense.expenseId, { status });
      toast.success(
        status === 'approved'
          ? 'Expense approved'
          : status === 'rejected'
            ? 'Expense rejected'
            : 'Updated',
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusyId(null);
    }
  };

  const newExpenseHref =
    `/expenses?new=1&taskId=${encodeURIComponent(taskId)}` +
    `&taskTitle=${encodeURIComponent(taskTitle)}` +
    (projectId ? `&projectId=${encodeURIComponent(projectId)}` : '') +
    (projectName ? `&projectName=${encodeURIComponent(projectName)}` : '');

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <Receipt className="w-4 h-4 text-primary" />
          Expenses
          {expenses.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({expenses.length})
            </span>
          )}
        </h4>
        <Button asChild size="sm" variant="ghost" className="h-7">
          <Link to={newExpenseHref}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : expenses.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No expenses yet for this task.
        </p>
      ) : (
        <ul className="space-y-2">
          {expenses.map((e) => (
            <li
              key={e.expenseId}
              className="rounded-md border border-border bg-background p-2 text-sm space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{e.title}</span>
                    {statusBadge(e.status)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    <span>{e.userName ?? 'Unknown'}</span>
                    <span>{format(e.incurredOn, 'MMM d')}</span>
                    {e.vendor && <span>{e.vendor}</span>}
                  </div>
                </div>
                <span className="font-semibold text-foreground shrink-0">
                  {formatExpenseAmount(e.amount, e.currency)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {e.invoiceUrl && (
                  <a
                    href={e.invoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Invoice <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {canManage && e.status === 'pending' && (
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                      disabled={busyId === e.expenseId}
                      onClick={() => setStatus(e, 'approved')}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/10"
                      disabled={busyId === e.expenseId}
                      onClick={() => setStatus(e, 'rejected')}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TaskExpensesPanel;
