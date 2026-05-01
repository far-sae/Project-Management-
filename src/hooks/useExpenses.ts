import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  CreateExpenseInput,
  Expense,
  UpdateExpenseInput,
  createExpense as createExpenseSvc,
  deleteExpense as deleteExpenseSvc,
  getTaskExpenses,
  subscribeToExpenses,
  updateExpense as updateExpenseSvc,
} from "@/services/supabase/expenses";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useExpenses = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToExpenses(orgId, (next) => {
      setExpenses(next);
      setLoading(false);
    });
  }, [orgId]);

  const create = useCallback(
    async (input: CreateExpenseInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const created = await createExpenseSvc(
        orgId,
        user.userId,
        user.displayName,
        input,
      );
      return created;
    },
    [orgId, user],
  );

  const update = useCallback(
    async (expenseId: string, input: UpdateExpenseInput) => {
      if (!orgId) throw new Error("No organization");
      return updateExpenseSvc(orgId, expenseId, input, user?.userId);
    },
    [orgId, user?.userId],
  );

  const remove = useCallback(
    async (expenseId: string) => {
      if (!orgId) return;
      await deleteExpenseSvc(orgId, expenseId);
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    expenses,
    loading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    canManage: isOwner || isAdmin,
  };
};

/**
 * Lightweight per-task hook for showing expenses inside a task panel.
 * Loads once on open and re-loads on demand; does NOT subscribe to realtime
 * so we avoid spinning up a channel per task modal.
 */
export const useTaskExpenses = (taskId: string | null | undefined) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId || !taskId) return;
    setLoading(true);
    try {
      const list = await getTaskExpenses(orgId, taskId);
      setExpenses(list);
    } finally {
      setLoading(false);
    }
  }, [orgId, taskId]);

  useEffect(() => {
    if (!orgId || !taskId) {
      setExpenses([]);
      return;
    }
    reload();
  }, [orgId, taskId, reload]);

  return {
    organizationId: orgId,
    expenses,
    loading,
    reload,
    canManage: isOwner || isAdmin,
    isOwner,
    isAdmin,
  };
};
