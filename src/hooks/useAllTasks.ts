import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  getOrganizationTasks,
  getTasksAssignedToUser,
} from "@/services/supabase/database";
import { Task } from "@/types";

export const useAllTasks = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const orgId = useMemo(
    () =>
      organization?.organizationId ||
      user?.organizationId ||
      (user ? `local-${user.userId}` : ""),
    [organization?.organizationId, user?.organizationId, user?.userId],
  );

  const refresh = useCallback(async () => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [orgTasks, assignedTasks] = await Promise.all([
        orgId && !orgId.startsWith("local-")
          ? getOrganizationTasks(orgId)
          : Promise.resolve([]),
        getTasksAssignedToUser(user.userId), // ← no orgId needed anymore
      ]);

      const merged = [...orgTasks, ...assignedTasks].filter(
        (t, i, arr) => arr.findIndex((x) => x.taskId === t.taskId) === i,
      );

      setTasks(merged);
    } catch (err) {
      console.error("❌ useAllTasks error:", err);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && user) refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh, user]);

  const tasksAssignedToMe = tasks.filter((t) =>
    t.assignees?.some((a) => a.userId === user?.userId),
  );

  const todayTasks = tasksAssignedToMe.filter((t) => {
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const upcomingTasks = tasksAssignedToMe
    .filter((t) => {
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return d >= today;
    })
    .sort(
      (a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime(),
    )
    .slice(0, 10);

  const overdueTasks = tasksAssignedToMe.filter((t) => {
    if (!t.dueDate || t.status === "done") return false;
    return new Date(t.dueDate) < new Date();
  });

  return {
    tasks,
    tasksAssignedToMe,
    todayTasks,
    upcomingTasks,
    overdueTasks,
    loading,
    refresh,
  };
};
