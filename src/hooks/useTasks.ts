import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  createTask,
  getProjectTasks,
  updateTask,
  deleteTask,
  subscribeToTasks,
} from "@/services/supabase/database";
import { Task, CreateTaskInput, UpdateTaskInput, TaskStatus } from "@/types";

export const useTasks = (
  projectId: string | null,
  organizationIdOverride?: string | null,
) => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ Limit modal state
  const [limitModal, setLimitModal] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const effectiveOrgId =
    organizationIdOverride ||
    user?.organizationId ||
    (user ? `local-${user.userId}` : "");

  useEffect(() => {
    if (!projectId || !effectiveOrgId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToTasks(
      projectId,
      effectiveOrgId,
      (updatedTasks) => {
        setTasks(updatedTasks);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [projectId, effectiveOrgId]);

  const addTask = useCallback(
    async (input: CreateTaskInput): Promise<Task | null> => {
      if (!user) return null;

      setError(null);
      try {
        if (!input) throw new Error("Input is required");

        const newTask = await createTask(user.userId, input, effectiveOrgId);
        return newTask;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create task";

        // ✅ Show limit modal instead of inline error
        if (message.includes("limit") || message.includes("reached")) {
          setLimitModal({ open: true, message });
        } else {
          setError(message);
        }
        return null;
      }
    },
    [user, effectiveOrgId],
  );

  const editTask = useCallback(
    async (taskId: string, input: UpdateTaskInput): Promise<boolean> => {
      setError(null);
      try {
        if (!user) throw new Error("User not authenticated");
        if (!input) throw new Error("Input is required");
        await updateTask(taskId, input, effectiveOrgId);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update task";
        setError(message);
        return false;
      }
    },
    [user, effectiveOrgId],
  );

  const removeTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      setError(null);
      try {
        await deleteTask(taskId, user ? effectiveOrgId : "");
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete task";
        setError(message);
        return false;
      }
    },
    [user, effectiveOrgId],
  );

  const moveTask = useCallback(
    async (taskId: string, newStatus: TaskStatus): Promise<boolean> => {
      setError(null);
      try {
        if (!user) throw new Error("User not authenticated");
        await updateTask(taskId, { status: newStatus }, effectiveOrgId);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to move task";
        setError(message);
        return false;
      }
    },
    [user, effectiveOrgId],
  );

  const refreshTasks = useCallback(async () => {
    if (!projectId || !effectiveOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const fetchedTasks = await getProjectTasks(projectId, effectiveOrgId);
      setTasks(fetchedTasks);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch tasks";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId, effectiveOrgId]);

  const getTasksByStatus = useCallback(
    (status: TaskStatus): Task[] =>
      tasks.filter((task) => task.status === status),
    [tasks],
  );

  return {
    tasks,
    loading,
    error,
    addTask,
    editTask,
    removeTask,
    moveTask,
    refreshTasks,
    getTasksByStatus,
    // ✅ Expose limit modal
    limitModal,
    closeLimitModal: () => setLimitModal({ open: false, message: "" }),
  };
};

export default useTasks;
