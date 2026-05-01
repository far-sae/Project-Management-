import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ClientTaskType = "todo" | "call" | "email" | "meeting" | "followup";
export type ClientTaskStatus = "pending" | "done" | "snoozed";

export const TASK_TYPE_LABEL: Record<ClientTaskType, string> = {
  todo: "To-do",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  followup: "Follow-up",
};

export interface ClientTask {
  taskId: string;
  organizationId: string;
  clientId?: string | null;
  dealId?: string | null;
  title: string;
  description?: string | null;
  type: ClientTaskType;
  status: ClientTaskStatus;
  dueAt?: Date | null;
  doneAt?: Date | null;
  doneBy?: string | null;
  doneByName?: string | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientTaskInput {
  clientId?: string | null;
  dealId?: string | null;
  title: string;
  description?: string | null;
  type?: ClientTaskType;
  dueAt?: Date | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
}

export interface UpdateClientTaskInput {
  title?: string;
  description?: string | null;
  type?: ClientTaskType;
  status?: ClientTaskStatus;
  dueAt?: Date | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  clientId?: string | null;
  dealId?: string | null;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string) => `pm_client_tasks_${orgId}`;

const mapTask = (row: Record<string, unknown>): ClientTask => ({
  taskId: row.task_id as string,
  organizationId: row.organization_id as string,
  clientId: (row.client_id as string) ?? null,
  dealId: (row.deal_id as string) ?? null,
  title: row.title as string,
  description: (row.description as string) ?? null,
  type: ((row.type as string) || "todo") as ClientTaskType,
  status: ((row.status as string) || "pending") as ClientTaskStatus,
  dueAt: row.due_at ? new Date(row.due_at as string) : null,
  doneAt: row.done_at ? new Date(row.done_at as string) : null,
  doneBy: (row.done_by as string) ?? null,
  doneByName: (row.done_by_name as string) ?? null,
  assignedTo: (row.assigned_to as string) ?? null,
  assignedToName: (row.assigned_to_name as string) ?? null,
  createdBy: (row.created_by as string) ?? null,
  createdByName: (row.created_by_name as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const readLocal = (orgId: string): ClientTask[] => {
  try {
    const raw = localStorage.getItem(localKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as ClientTask[]).map((t) => ({
      ...t,
      dueAt: t.dueAt ? new Date(t.dueAt) : null,
      doneAt: t.doneAt ? new Date(t.doneAt) : null,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    }));
  } catch {
    return [];
  }
};
const writeLocal = (orgId: string, tasks: ClientTask[]) =>
  localStorage.setItem(localKey(orgId), JSON.stringify(tasks));

export const getOrganizationClientTasks = async (
  organizationId: string,
): Promise<ClientTask[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort((a, b) => {
      const ad = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bd = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
  }
  const { data, error } = await supabase
    .from("client_tasks")
    .select("*")
    .eq("organization_id", organizationId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) {
    logger.error("Failed to load client tasks:", error);
    return [];
  }
  return (data || []).map(mapTask);
};

export const createClientTask = async (
  organizationId: string,
  createdBy: string,
  createdByName: string,
  input: CreateClientTaskInput,
): Promise<ClientTask> => {
  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const task: ClientTask = {
      taskId: crypto.randomUUID(),
      organizationId,
      clientId: input.clientId ?? null,
      dealId: input.dealId ?? null,
      title: input.title,
      description: input.description ?? null,
      type: input.type ?? "todo",
      status: "pending",
      dueAt: input.dueAt ?? null,
      doneAt: null,
      doneBy: null,
      doneByName: null,
      assignedTo: input.assignedTo ?? createdBy,
      assignedToName: input.assignedToName ?? createdByName,
      createdBy,
      createdByName,
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [task, ...readLocal(organizationId)]);
    return task;
  }

  const row = {
    organization_id: organizationId,
    client_id: input.clientId ?? null,
    deal_id: input.dealId ?? null,
    title: input.title,
    description: input.description ?? null,
    type: input.type ?? "todo",
    status: "pending",
    due_at: input.dueAt ? input.dueAt.toISOString() : null,
    assigned_to: input.assignedTo ?? createdBy,
    assigned_to_name: input.assignedToName ?? createdByName,
    created_by: createdBy,
    created_by_name: createdByName,
  };
  const { data, error } = await supabase
    .from("client_tasks")
    .insert(row)
    .select()
    .single();
  if (error) {
    logger.error("Failed to create client task:", error);
    throw error;
  }
  return mapTask(data);
};

export const updateClientTask = async (
  organizationId: string,
  taskId: string,
  input: UpdateClientTaskInput,
  actor?: { userId: string; displayName: string },
): Promise<ClientTask> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((t) => t.taskId === taskId);
    if (idx === -1) throw new Error("Task not found");
    const merged: ClientTask = {
      ...all[idx],
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.assignedTo !== undefined
        ? { assignedTo: input.assignedTo }
        : {}),
      ...(input.assignedToName !== undefined
        ? { assignedToName: input.assignedToName }
        : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      ...(input.dealId !== undefined ? { dealId: input.dealId } : {}),
      ...(input.status !== undefined
        ? input.status === "done" && all[idx].status !== "done"
          ? {
              status: "done",
              doneAt: new Date(),
              doneBy: actor?.userId ?? null,
              doneByName: actor?.displayName ?? null,
            }
          : input.status !== "done" && all[idx].status === "done"
            ? {
                status: input.status,
                doneAt: null,
                doneBy: null,
                doneByName: null,
              }
            : { status: input.status }
        : {}),
      updatedAt: new Date(),
    };
    all[idx] = merged;
    writeLocal(organizationId, all);
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.type !== undefined) update.type = input.type;
  if (input.dueAt !== undefined)
    update.due_at = input.dueAt ? input.dueAt.toISOString() : null;
  if (input.assignedTo !== undefined) update.assigned_to = input.assignedTo;
  if (input.assignedToName !== undefined)
    update.assigned_to_name = input.assignedToName;
  if (input.clientId !== undefined) update.client_id = input.clientId;
  if (input.dealId !== undefined) update.deal_id = input.dealId;
  if (input.status !== undefined) {
    update.status = input.status;
    if (input.status === "done" && actor) {
      update.done_by_name = actor.displayName;
    }
  }

  const { data, error } = await supabase
    .from("client_tasks")
    .update(update)
    .eq("task_id", taskId)
    .select()
    .single();
  if (error) {
    logger.error("Failed to update client task:", error);
    throw error;
  }
  return mapTask(data);
};

export const deleteClientTask = async (
  organizationId: string,
  taskId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter((t) => t.taskId !== taskId);
    writeLocal(organizationId, all);
    return;
  }
  const { error } = await supabase
    .from("client_tasks")
    .delete()
    .eq("task_id", taskId);
  if (error) {
    logger.error("Failed to delete client task:", error);
    throw error;
  }
};

export const subscribeToClientTasks = (
  organizationId: string,
  callback: (tasks: ClientTask[]) => void,
): (() => void) => {
  getOrganizationClientTasks(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};
  const channelName = `client-tasks-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "client_tasks",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationClientTasks(organizationId).then(callback);
      },
    )
    .subscribe();
  return () => {
    channel.unsubscribe();
  };
};

export type TaskBucket = "overdue" | "today" | "thisweek" | "later" | "noDate";

export const bucketFor = (task: ClientTask, now: Date = new Date()): TaskBucket => {
  if (!task.dueAt) return "noDate";
  const due = task.dueAt.getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 86_400_000;
  const endOfWeek = startOfToday + 7 * 86_400_000;
  if (due < startOfToday) return "overdue";
  if (due < startOfTomorrow) return "today";
  if (due < endOfWeek) return "thisweek";
  return "later";
};
