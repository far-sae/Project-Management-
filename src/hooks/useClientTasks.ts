import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  ClientTask,
  CreateClientTaskInput,
  TaskBucket,
  UpdateClientTaskInput,
  bucketFor,
  createClientTask as createSvc,
  deleteClientTask as deleteSvc,
  subscribeToClientTasks,
  updateClientTask as updateSvc,
} from "@/services/supabase/clientTasks";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useClientTasks = (filters?: {
  clientId?: string | null;
  dealId?: string | null;
  /** When true, only show tasks assigned to the signed-in user. */
  mineOnly?: boolean;
}) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [tasks, setTasks] = useState<ClientTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToClientTasks(orgId, (next) => {
      setTasks(next);
      setLoading(false);
    });
  }, [orgId]);

  const visible = useMemo(() => {
    let list = tasks;
    if (filters?.clientId) {
      list = list.filter((t) => t.clientId === filters.clientId);
    }
    if (filters?.dealId) {
      list = list.filter((t) => t.dealId === filters.dealId);
    }
    if (filters?.mineOnly && user?.userId) {
      list = list.filter(
        (t) => t.assignedTo === user.userId || t.createdBy === user.userId,
      );
    }
    return list;
  }, [tasks, filters?.clientId, filters?.dealId, filters?.mineOnly, user?.userId]);

  const buckets = useMemo(() => {
    const out: Record<TaskBucket, ClientTask[]> = {
      overdue: [],
      today: [],
      thisweek: [],
      later: [],
      noDate: [],
    };
    const now = new Date();
    visible
      .filter((t) => t.status === "pending")
      .forEach((t) => {
        out[bucketFor(t, now)].push(t);
      });
    return out;
  }, [visible]);

  const create = useCallback(
    async (input: CreateClientTaskInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const created = await createSvc(
        orgId,
        user.userId,
        user.displayName,
        input,
      );
      setTasks((prev) => [created, ...prev]);
      return created;
    },
    [orgId, user],
  );

  const update = useCallback(
    async (taskId: string, input: UpdateClientTaskInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      const updated = await updateSvc(orgId, taskId, input, {
        userId: user.userId,
        displayName: user.displayName,
      });
      setTasks((prev) => prev.map((t) => (t.taskId === taskId ? updated : t)));
      return updated;
    },
    [orgId, user],
  );

  const toggleDone = useCallback(
    async (task: ClientTask) =>
      update(task.taskId, {
        status: task.status === "done" ? "pending" : "done",
      }),
    [update],
  );

  const remove = useCallback(
    async (taskId: string) => {
      if (!orgId) return;
      await deleteSvc(orgId, taskId);
      setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    tasks: visible,
    allTasks: tasks,
    buckets,
    loading,
    create,
    update,
    toggleDone,
    remove,
    isOwner,
    isAdmin,
    canManage: isOwner || isAdmin,
  };
};
