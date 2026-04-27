import { supabase } from "./config";
import {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskComment,
  CommentAttachment,
  PRIORITY_COLORS,
  GlobalComment,
} from "@/types";
import { ActivityEvent, CreateActivityInput } from "@/types/activity";
import { AppNotification, CreateNotificationInput } from "@/types/notification";
import { logger } from "@/lib/logger";
import { sendTaskAssignedEmail } from "@/services/email/taskAssignedEmail";
import { isAppOwner } from "@/lib/app-owner";
import { INDIA_PRICING } from "@/types/subscription";

// ============================================
// LIMIT HELPERS
// ============================================

/** App owner (builders) or organization owner has full access: no subscription or limit checks. */
export const isOrganizationOwner = async (
  userId: string,
  organizationId: string,
): Promise<boolean> => {
  if (isAppOwner(userId)) return true;
  if (!organizationId || organizationId.startsWith("local-")) return false;
  const { data } = await supabase
    .from("organizations")
    .select("owner_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.owner_id === userId;
};

// Get limits for a user based on their subscription
const getUserLimits = async (userId: string) => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, plan, trial_ends_at, extra_seats")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) console.warn("⚠️ getUserLimits query error:", error.message);

  // ✅ No subscription row = new user on trial → give advanced limits
  if (!data) return INDIA_PRICING.tiers.advanced.limits;

  const status = data.status;
  const plan = data.plan;

  // Trial = full advanced limits
  if (status === "trial") {
    const trialEnd = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
    if (trialEnd && trialEnd > new Date()) {
      return INDIA_PRICING.tiers.advanced.limits;
    }
    // Trial expired fallback
    return INDIA_PRICING.tiers.starter.limits;
  }

  if (status === "active" && plan) {
    const tier = plan as keyof typeof INDIA_PRICING.tiers;
    const base = INDIA_PRICING.tiers[tier]?.limits ?? INDIA_PRICING.tiers.starter.limits;
    // Advanced: allow 10 + paid extra seats
    if (tier === "advanced" && base.teamMembers !== null && typeof (data as { extra_seats?: number }).extra_seats === "number") {
      const extra = Math.max(0, (data as { extra_seats: number }).extra_seats);
      return { ...base, teamMembers: 10 + extra };
    }
    return base;
  }

  // Starter, expired, or cancelled = Starter limits only
  if (status === "starter" || status === "expired" || status === "cancelled") {
    return INDIA_PRICING.tiers.starter.limits;
  }

  return INDIA_PRICING.tiers.starter.limits;
};

// ── Project limit check ───────────────────────────────────────────────
export const checkProjectLimit = async (
  userId: string,
  organizationId: string,
): Promise<{
  allowed: boolean;
  current: number;
  max: number | null;
  message: string;
}> => {
  if (await isOrganizationOwner(userId, organizationId))
    return { allowed: true, current: 0, max: null, message: "" };
  const limits = await getUserLimits(userId);

  if (limits.projects === null)
    return { allowed: true, current: 0, max: null, message: "" };

  const { count } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  const current = count ?? 0;
  const allowed = current < limits.projects;

  return {
    allowed,
    current,
    max: limits.projects,
    message: allowed
      ? ""
      : `You've reached your ${limits.projects} project limit. Upgrade your plan to create more projects.`,
  };
};

// ── Workspace limit check ─────────────────────────────────────────────
export const checkWorkspaceLimit = async (
  userId: string,
  organizationId: string,
): Promise<{
  allowed: boolean;
  current: number;
  max: number | null;
  message: string;
}> => {
  if (await isOrganizationOwner(userId, organizationId))
    return { allowed: true, current: 0, max: null, message: "" };
  const limits = await getUserLimits(userId);

  if (limits.workspaces === null)
    return { allowed: true, current: 0, max: null, message: "" };

  // ✅ Don't count the default workspace — it's auto-created, not user-created
  const { count } = await supabase
    .from("workspaces")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("is_default", false); // ← only count non-default workspaces

  const current = count ?? 0;
  // ✅ Subtract 1 from max since default workspace is free/excluded
  const effectiveMax = limits.workspaces - 1;
  const allowed = effectiveMax <= 0 ? false : current < effectiveMax;

  return {
    allowed,
    current,
    max: effectiveMax,
    message: allowed
      ? ""
      : `You've reached your workspace limit on this plan. Upgrade to create more workspaces.`,
  };
};

// ── Task limit check ──────────────────────────────────────────────────
export const checkTaskLimit = async (
  userId: string,
  projectId: string,
): Promise<{
  allowed: boolean;
  current: number;
  max: number | null;
  message: string;
}> => {
  const { data: proj } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (proj?.organization_id && (await isOrganizationOwner(userId, proj.organization_id)))
    return { allowed: true, current: 0, max: null, message: "" };
  const limits = await getUserLimits(userId);

  if (limits.tasksPerProject === null)
    return { allowed: true, current: 0, max: null, message: "" };

  const { count } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);

  const current = count ?? 0;
  const allowed = current < limits.tasksPerProject;

  return {
    allowed,
    current,
    max: limits.tasksPerProject,
    message: allowed
      ? ""
      : `You've reached the ${limits.tasksPerProject} task limit per project. Upgrade your plan to add more tasks.`,
  };
};

// ── Team member limit check ───────────────────────────────────────────
export const checkTeamMemberLimit = async (
  userId: string,
  currentMemberCount: number,
  organizationId?: string,
): Promise<{ allowed: boolean; max: number | null; message: string }> => {
  if (organizationId && (await isOrganizationOwner(userId, organizationId)))
    return { allowed: true, max: null, message: "" };
  const limits = await getUserLimits(userId);

  if (limits.teamMembers === null)
    return { allowed: true, max: null, message: "" };

  const allowed = currentMemberCount < limits.teamMembers;

  return {
    allowed,
    max: limits.teamMembers,
    message: allowed
      ? ""
      : `You've reached your ${limits.teamMembers} team member limit. Upgrade your plan to add more members.`,
  };
};

// ============================================
// PROJECTS
// ============================================

export const createProject = async (
  ownerId: string,
  _ownerEmail: string,
  _ownerName: string,
  _ownerPhoto: string,
  input: CreateProjectInput,
  organizationId: string,
): Promise<Project> => {
  // ✅ Check project limit BEFORE creating
  const limitCheck = await checkProjectLimit(ownerId, organizationId);
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.message);
  }

  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();

  console.log("🔧 Creating project with:", {
    organizationId,
    inputWorkspaceId: input.workspaceId,
  });

  let workspaceId = input.workspaceId;

  if (!workspaceId || workspaceId === "default") {
    console.log("📡 Fetching default workspace for organization...");

    try {
      const { data: workspace, error: wsError } = await Promise.race([
        supabase
          .from("workspaces")
          .select("workspace_id")
          .eq("organization_id", organizationId)
          .eq("is_default", true)
          .single(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Workspace fetch timeout")), 5000),
        ) as any,
      ]);

      console.log("📋 Workspace query result:", { workspace, error: wsError });

      if (wsError || !workspace) {
        console.log("⚠️ No default workspace found, creating one...");

        // ✅ Check workspace limit before auto-creating
        const wsLimitCheck = await checkWorkspaceLimit(ownerId, organizationId);
        if (!wsLimitCheck.allowed) {
          throw new Error(wsLimitCheck.message);
        }

        const defaultWsId = crypto.randomUUID();
        const { data: newWs, error: createErr } = await supabase
          .from("workspaces")
          .insert({
            workspace_id: defaultWsId,
            name: "Default Workspace",
            organization_id: organizationId,
            is_default: true,
            created_at: now,
            updated_at: now,
          })
          .select()
          .single();

        if (createErr || !newWs) {
          logger.error("Failed to create default workspace:", createErr);
          throw new Error("Failed to create workspace. Please try again.");
        }

        workspaceId = newWs.workspace_id;
        console.log("✅ Default workspace created:", workspaceId);
      } else {
        workspaceId = workspace.workspace_id;
        console.log("✅ Using existing default workspace:", workspaceId);
      }
    } catch (err) {
      logger.error("Error handling workspace:", err);
      throw err; // ← re-throw so limit messages bubble up
    }
  }

  const project = {
    project_id: projectId,
    name: input.name,
    description: input.description,
    cover_color: input.coverColor,
    owner_id: ownerId,
    organization_id: organizationId,
    workspace_id: workspaceId,
    created_by: ownerId,
    // members: [
    //   {
    //     userId: ownerId,
    //     email: ownerEmail,
    //     displayName: ownerName,
    //     photoURL: ownerPhoto,
    //     role: "owner",
    //     addedAt: now,
    //   },
    // ],
    columns: input.columns ?? [],
    created_at: now,
    updated_at: now,
  };

  console.log("📤 Inserting project:", project);

  const { data, error } = await supabase
    .from("projects")
    .insert(project)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create project:", error);
    throw error;
  }

  console.log("✅ Project created successfully:", data.project_id);

  return {
    projectId: data.project_id,
    name: data.name,
    description: data.description,
    coverColor: data.cover_color,
    ownerId: data.owner_id,
    organizationId: data.organization_id,
    workspaceId: data.workspace_id,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    members: data.members || [],
    settings: {
      isArchived: false,
      visibility: "private",
    },
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      membersCount: 1,
    },
    startDate: data.start_date ? new Date(data.start_date) : null,
    endDate: data.end_date ? new Date(data.end_date) : null,
  } as Project;
};

const convertToProject = (data: any): Project => {
  const members = (data.members || []).map((m: any) => {
    const normalizedUserId = m?.userId || m?.user_id || "";
    const normalizedAddedAt = m?.addedAt || m?.added_at || data.created_at;
    return {
      ...m,
      userId: normalizedUserId,
      addedAt:
        typeof normalizedAddedAt === "string"
          ? new Date(normalizedAddedAt)
          : normalizedAddedAt,
    };
  });

  const ownerInMembers = members.some((m: any) =>
    (m.userId || m.user_id) === data.owner_id
  );
  if (!ownerInMembers && data.owner_id) {
    members.unshift({
      userId: data.owner_id,
      email: "",
      displayName: "Owner",
      photoURL: "",
      role: "owner",
      addedAt: new Date(data.created_at),
    });
  }

  return {
    projectId: data.project_id,
    name: data.name,
    description: data.description || "",
    coverColor: data.cover_color || "#f97316",
    ownerId: data.owner_id,
    organizationId: data.organization_id,
    workspaceId: data.workspace_id,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    members,
    settings: data.settings || { isArchived: false, visibility: "private" },
    stats: data.stats || {
      totalTasks: 0,
      completedTasks: 0,
      membersCount: members.length,
    },
    columns: data.columns || [],
    startDate: data.start_date ? new Date(data.start_date) : null,
    endDate: data.end_date ? new Date(data.end_date) : null,
  };
};

export const getProject = async (
  projectId: string,
  organizationId: string,
  userId?: string,
  _userEmail?: string,
): Promise<Project | null> => {
  let query = supabase
    .from("projects")
    .select("*")
    .eq("project_id", projectId);

  if (organizationId && !organizationId.startsWith("local-")) {
    query = query.eq("organization_id", organizationId);
  }

  let { data, error } = await query.maybeSingle();

  // Fallback for stale/wrong org mapping after invitation acceptance.
  // Access is still enforced below via owner/member check.
  if (!data && userId) {
    const retry = await supabase
      .from("projects")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return null;
  }

  if (!data) return null;

  if (userId) {
    const isOwner = data.owner_id === userId;
    const isMember = Array.isArray(data.members) &&
      data.members.some((m: { userId?: string; user_id?: string }) =>
        (m?.userId || m?.user_id) === userId
      );
    if (!isOwner && !isMember) return null;
  }

  return convertToProject(data);
};

export const getUserProjects = async (
  userId: string,
  _organizationId: string,
  _userEmail?: string,
): Promise<Project[]> => {
  const { data: ownerProjects, error: ownerError } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", userId);

  if (ownerError) console.error("Failed to fetch owner projects:", ownerError);

  const { data: memberProjects, error: memberError } = await supabase
    .from("projects")
    .select("*")
    .contains("members", [{ userId }]);

  if (memberError) console.error("Failed to fetch member projects:", memberError);

  const { data: legacyMemberProjects, error: legacyMemberError } = await supabase
    .from("projects")
    .select("*")
    .contains("members", [{ user_id: userId }]);

  if (legacyMemberError) {
    console.error("Failed to fetch legacy member projects:", legacyMemberError);
  }

  const mergedMap = new Map<string, any>();
  for (const p of ownerProjects || []) mergedMap.set(p.project_id, p);
  for (const p of memberProjects || []) mergedMap.set(p.project_id, p);
  for (const p of legacyMemberProjects || []) mergedMap.set(p.project_id, p);

  return Array.from(mergedMap.values())
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .map(convertToProject);
};

export const updateProject = async (
  projectId: string,
  input: UpdateProjectInput,
  organizationId: string,
): Promise<void> => {
  const updateData: any = { updated_at: new Date().toISOString() };

  if (input.name) updateData.name = input.name;
  if (input.description !== undefined)
    updateData.description = input.description;
  if (input.coverColor) updateData.cover_color = input.coverColor;
  if (input.workspaceId) updateData.workspace_id = input.workspaceId;
  if (input.members) updateData.members = input.members;
  if (input.columns) updateData.columns = input.columns;
  if (input.startDate !== undefined) updateData.start_date = input.startDate;
  if (input.endDate !== undefined) updateData.end_date = input.endDate;

  const { error } = await supabase
    .from("projects")
    .update(updateData)
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to update project:", error);
    throw error;
  }
};

export const deleteProject = async (
  projectId: string,
  organizationId: string,
): Promise<void> => {
  // Delete related comments for this project's tasks and global comments feed
  const { data: taskRows, error: taskFetchError } = await supabase
    .from("tasks")
    .select("task_id")
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);

  if (taskFetchError) {
    logger.error("Failed to load project tasks before delete:", taskFetchError);
    throw taskFetchError;
  }

  const taskIds = (taskRows || []).map((t: { task_id: string }) => t.task_id);
  if (taskIds.length > 0) {
    await supabase.from("comments").delete().in("task_id", taskIds);
    await supabase.from("global_comments").delete().in("task_id", taskIds);
  }

  // Also remove any remaining global comments keyed only by project_id
  await supabase
    .from("global_comments")
    .delete()
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);

  // Finally delete tasks and the project itself
  await supabase
    .from("tasks")
    .delete()
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to delete project:", error);
    throw error;
  }
};

export const subscribeToProjects = (
  userId: string,
  organizationId: string,
  userEmail: string | undefined,
  callback: (projects: Project[]) => void,
) => {
  getUserProjects(userId, organizationId, userEmail).then(callback);

  const channelName = `projects-${organizationId}-${Math.random().toString(36).slice(2, 11)}`;
  // console.log("🔌 Creating channel:", channelName);

  let channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "projects" },
      () => {
        console.log("📡 Project change detected, refreshing...");
        getUserProjects(userId, organizationId, userEmail).then(callback);
      },
    );

  if (userEmail) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "invitations",
        filter: `email=eq.${userEmail.toLowerCase().trim()}`,
      },
      () => {
        console.log("📡 Invitation change detected, refreshing projects...");
        getUserProjects(userId, organizationId, userEmail).then(callback);
      },
    );
  }

  const subscription = channel.subscribe((_status) => {
    // console.log("🔌 Channel status:", status);
  });

  return () => {
    // console.log("❌ Unsubscribing channel:", channelName);
    subscription.unsubscribe();
  };
};

// ============================================
// TASKS
// ============================================

export const createTask = async (
  userId: string,
  input: CreateTaskInput,
  organizationId: string,
): Promise<Task> => {
  // ✅ Check task limit BEFORE creating
  const limitCheck = await checkTaskLimit(userId, input.projectId);
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.message);
  }

  const now = new Date().toISOString();
  const taskId = crypto.randomUUID();
  const priority = input.priority || "medium";

  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("position")
    .eq("project_id", input.projectId)
    .eq("status", input.status || "undefined")
    .order("position", { ascending: false })
    .limit(1);

  const position =
    existingTasks && existingTasks.length > 0
      ? (existingTasks[0].position || 0) + 1
      : 0;

  const task = {
    task_id: taskId,
    project_id: input.projectId,
    organization_id: organizationId,
    title: input.title,
    description: input.description || "",
    status: input.status || "undefined",
    priority,
    priority_color: PRIORITY_COLORS[priority],
    due_date: input.dueDate || null,
    assignees: input.assignees || [],
    tags: input.tags || [],
    subtasks: input.subtasks || [],
    parent_task_id: input.parentTaskId || null,
    urgent: input.urgent || false,
    is_locked: input.isLocked || false,
    lock_pin_hash: input.lockPinHash ?? null,
    position,
    attachments: input.attachments || [],
    comments_count: 0,
    created_by: userId,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  const { data, error } = await supabase
    .from("tasks")
    .insert(task)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create task:", error);
    throw error;
  }

  return {
    taskId: data.task_id,
    projectId: data.project_id,
    organizationId: data.organization_id,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    priorityColor: data.priority_color,
    dueDate: data.due_date ? new Date(data.due_date) : null,
    assignees: data.assignees || [],
    tags: data.tags || [],
    subtasks: data.subtasks || [],
    parentTaskId: data.parent_task_id,
    urgent: data.urgent,
    isLocked: data.is_locked || false,
    lockPinHash: data.lock_pin_hash ?? null,
    position: data.position,
    attachments: data.attachments || [],
    commentsCount: data.comments_count || 0,
    createdBy: data.created_by,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    completedAt: data.completed_at ? new Date(data.completed_at) : null,
  } as Task;
};

export const getTask = async (
  taskId: string,
  organizationId: string,
): Promise<Task | null> => {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("task_id", taskId)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) return null;

  return {
    taskId: data.task_id,
    projectId: data.project_id,
    organizationId: data.organization_id,
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    priorityColor: data.priority_color,
    dueDate: data.due_date ? new Date(data.due_date) : null,
    assignees: data.assignees || [],
    tags: data.tags || [],
    subtasks: data.subtasks || [],
    parentTaskId: data.parent_task_id,
    urgent: data.urgent,
    isLocked: data.is_locked || false,
    lockPinHash: data.lock_pin_hash ?? null,
    position: data.position,
    attachments: data.attachments || [],
    commentsCount: data.comments_count || 0,
    createdBy: data.created_by,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    completedAt: data.completed_at ? new Date(data.completed_at) : null,
  } as Task;
};

export const getProjectTasks = async (
  projectId: string,
  organizationId?: string,
  userId?: string,
): Promise<Task[]> => {
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (organizationId && !organizationId.startsWith("local-")) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to get project tasks:", error);
    return [];
  }

  let tasks = (data || []).map((task) => ({
    taskId: task.task_id,
    projectId: task.project_id,
    organizationId: task.organization_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    priorityColor: task.priority_color,
    dueDate: task.due_date ? new Date(task.due_date) : null,
    assignees: task.assignees || [],
    tags: task.tags || [],
    subtasks: task.subtasks || [],
    parentTaskId: task.parent_task_id,
    urgent: task.urgent,
    isLocked: task.is_locked || false,
    position: task.position,
    attachments: task.attachments || [],
    commentsCount: task.comments_count || 0,
    createdBy: task.created_by,
    createdAt: new Date(task.created_at),
    updatedAt: new Date(task.updated_at),
    completedAt: task.completed_at ? new Date(task.completed_at) : null,
  })) as Task[];

  if (userId && tasks.some((t) => t.isLocked)) {
    const { data: projectRow } = await supabase
      .from("projects")
      .select("owner_id")
      .eq("project_id", projectId)
      .maybeSingle();
    const projectOwnerId = projectRow?.owner_id || null;
    tasks = tasks.filter((t) => {
      if (!t.isLocked) return true;
      if (t.createdBy === userId) return true;
      if (projectOwnerId === userId) return true;
      if ((t.assignees || []).some((a) => (a.userId || (a as { user_id?: string }).user_id) === userId)) return true;
      return false;
    });
  }

  return tasks;
};

export const getOrganizationTasks = async (
  organizationId: string,
): Promise<Task[]> => {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("organization_id", organizationId)
    .order("due_date", { ascending: true });

  if (error) {
    logger.error("Failed to get organization tasks:", error);
    return [];
  }

  return (data || []).map((task) => ({
    taskId: task.task_id,
    projectId: task.project_id,
    organizationId: task.organization_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    priorityColor: task.priority_color,
    dueDate: task.due_date ? new Date(task.due_date) : null,
    assignees: task.assignees || [],
    tags: task.tags || [],
    subtasks: task.subtasks || [],
    parentTaskId: task.parent_task_id,
    urgent: task.urgent,
    isLocked: task.is_locked || false,
    lockPinHash: task.lock_pin_hash ?? null,
    position: task.position,
    attachments: task.attachments || [],
    commentsCount: task.comments_count || 0,
    createdBy: task.created_by,
    createdAt: new Date(task.created_at),
    updatedAt: new Date(task.updated_at),
    completedAt: task.completed_at ? new Date(task.completed_at) : null,
  })) as Task[];
};

export const updateTask = async (
  taskId: string,
  input: UpdateTaskInput,
  organizationId: string,
): Promise<void> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined)
    updateData.description = input.description;
  if (input.status !== undefined) {
    updateData.status = input.status;
    updateData.completed_at =
      input.status === "done" ? new Date().toISOString() : null;
  }
  if (input.priority !== undefined) {
    updateData.priority = input.priority;
    updateData.priority_color = PRIORITY_COLORS[input.priority];
  }
  if (input.dueDate !== undefined) updateData.due_date = input.dueDate;
  if (input.assignees !== undefined) updateData.assignees = input.assignees;
  if (input.tags !== undefined) updateData.tags = input.tags;
  if (input.subtasks !== undefined) updateData.subtasks = input.subtasks;
  if (input.urgent !== undefined) updateData.urgent = input.urgent;
  if (input.isLocked !== undefined) updateData.is_locked = input.isLocked;
  if (input.position !== undefined) updateData.position = input.position;
  if (input.attachments !== undefined)
    updateData.attachments = input.attachments;

  let query = supabase.from("tasks").update(updateData).eq("task_id", taskId);

  if (organizationId && !organizationId.startsWith("local-")) {
    query = query.eq("organization_id", organizationId);
  }

  const { error } = await query;
  if (error) {
    logger.error("Failed to update task:", error);
    throw error;
  }
};

export const deleteTask = async (
  taskId: string,
  organizationId?: string,
): Promise<void> => {
  await supabase.from("comments").delete().eq("task_id", taskId);
  await supabase.from("global_comments").delete().eq("task_id", taskId);

  let query = supabase.from("tasks").delete().eq("task_id", taskId);
  if (organizationId && !organizationId.startsWith("local-")) {
    query = query.eq("organization_id", organizationId);
  }

  const { error } = await query;

  if (error) {
    logger.error("Failed to delete task:", error);
    throw error;
  }
};

/**
 * Apply the same UpdateTaskInput patch to many tasks in parallel.
 * Used by the kanban bulk-action bar (Set status, Set priority, etc.).
 */
export const bulkUpdateTasks = async (
  taskIds: string[],
  patch: UpdateTaskInput,
  organizationId: string,
): Promise<void> => {
  await Promise.all(
    taskIds.map((id) => updateTask(id, patch, organizationId)),
  );
};

/**
 * Persist a new ordering of tasks within their column. Each entry
 * is `{ taskId, position }`; `status` is included to keep the row
 * anchored to its column even if a parallel move just happened.
 */
export const bulkReorderTasks = async (
  ordering: { taskId: string; position: number; status?: string }[],
  organizationId: string,
): Promise<void> => {
  await Promise.all(
    ordering.map(({ taskId, position, status }) =>
      updateTask(
        taskId,
        status ? { position, status } : { position },
        organizationId,
      ),
    ),
  );
};

export const bulkDeleteTasks = async (
  taskIds: string[],
  organizationId?: string,
): Promise<void> => {
  await Promise.all(taskIds.map((id) => deleteTask(id, organizationId)));
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const subscribeToTasks = (
  projectId: string,
  organizationId: string | undefined,
  callback: (tasks: Task[]) => void,
  userId?: string,
) => {
  let cancelled = false;

  const pushTasks = (tasks: Task[]) => {
    if (!cancelled) callback(tasks);
  };

  const fetchAndPush = async (): Promise<void> => {
    try {
      const tasks = await getProjectTasks(projectId, organizationId, userId);
      pushTasks(tasks);
    } catch (err) {
      logger.warn("subscribeToTasks: initial fetch failed, retrying:", err);
      try {
        await sleep(1200);
        const tasks = await getProjectTasks(projectId, organizationId, userId);
        pushTasks(tasks);
      } catch (err2) {
        logger.error("subscribeToTasks: fetch failed after retry:", err2);
        try {
          await sleep(2500);
          const tasks = await getProjectTasks(projectId, organizationId, userId);
          pushTasks(tasks);
        } catch (err3) {
          logger.error("subscribeToTasks: all fetch attempts failed:", err3);
        }
      }
    }
  };

  void fetchAndPush();

  const channel = supabase
    .channel(`tasks-${projectId}-${Math.random().toString(36).slice(2, 11)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tasks",
        filter: `project_id=eq.${projectId}`,
      },
      () => {
        getProjectTasks(projectId, organizationId, userId)
          .then(pushTasks)
          .catch((err) => {
            logger.warn("subscribeToTasks: refetch after change failed:", err);
            void fetchAndPush();
          });
      },
    )
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        logger.warn("subscribeToTasks: realtime channel status:", status, err);
        void fetchAndPush();
      }
    });

  return () => {
    cancelled = true;
    channel.unsubscribe();
  };
};

export const getTasksAssignedToUser = async (
  userId: string,
  organizationId?: string,
): Promise<Task[]> => {
  let query = supabase
    .from("tasks")
    .select("*")
    .filter("assignees", "cs", `[{"userId":"${userId}"}]`);

  if (organizationId && !organizationId.startsWith("local-")) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  if (error) {
    logger.error("Failed to get assigned tasks:", error);
    return [];
  }

  return (data || []).map((task) => ({
    taskId: task.task_id,
    projectId: task.project_id,
    organizationId: task.organization_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    priorityColor: task.priority_color,
    dueDate: task.due_date ? new Date(task.due_date) : null,
    assignees: task.assignees || [],
    tags: task.tags || [],
    subtasks: task.subtasks || [],
    urgent: task.urgent,
    isLocked: task.is_locked || false,
    lockPinHash: task.lock_pin_hash ?? null,
    position: task.position,
    attachments: task.attachments || [],
    commentsCount: task.comments_count || 0,
    createdBy: task.created_by,
    createdAt: new Date(task.created_at),
    updatedAt: new Date(task.updated_at),
    completedAt: task.completed_at ? new Date(task.completed_at) : null,
  })) as Task[];
};

// ============================================
// COMMENTS
// ============================================

export const addComment = async (
  taskId: string,
  userId: string,
  displayName: string,
  photoURL: string,
  text: string,
  _organizationId: string,
  attachments?: CommentAttachment[],
  timeSpentMinutes?: number,
): Promise<TaskComment> => {
  const now = new Date().toISOString();
  const commentId = crypto.randomUUID();

  const comment = {
    comment_id: commentId,
    task_id: taskId,
    user_id: userId,
    user_name: displayName,
    user_photo: photoURL,
    text,
    attachments: attachments || [],
    time_spent: timeSpentMinutes || 0,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("comments")
    .insert(comment)
    .select()
    .single();

  if (error) {
    logger.error("Failed to add comment:", error);
    throw error;
  }

  return {
    commentId: data.comment_id,
    taskId: data.task_id,
    userId: data.user_id,
    displayName: data.user_name,
    photoURL: data.user_photo,
    text: data.text,
    attachments: data.attachments || [],
    timeSpentMinutes: data.time_spent,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    isEdited: false,
  } as TaskComment;
};

export const getTaskComments = async (
  taskId: string,
  _organizationId: string,
): Promise<TaskComment[]> => {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    logger.error("Failed to get task comments:", error);
    return [];
  }

  return (data || []).map((comment) => ({
    commentId: comment.comment_id,
    taskId: comment.task_id,
    userId: comment.user_id,
    displayName: comment.user_name,
    photoURL: comment.user_photo,
    text: comment.text,
    attachments: comment.attachments || [],
    timeSpentMinutes: comment.time_spent,
    createdAt: new Date(comment.created_at),
    updatedAt: new Date(comment.updated_at),
    isEdited: false,
  })) as TaskComment[];
};

/** Delete a comment from both comments and global_comments so Recent Comments stays in sync; decrements task comments_count. */
export const deleteComment = async (commentId: string): Promise<void> => {
  const { data: commentRow } = await supabase
    .from("comments")
    .select("task_id")
    .eq("comment_id", commentId)
    .maybeSingle();

  const taskId = commentRow?.task_id ?? null;

  const { error: errComments } = await supabase
    .from("comments")
    .delete()
    .eq("comment_id", commentId);

  if (errComments) {
    logger.error("deleteComment: comments delete failed", errComments);
    throw errComments;
  }

  const { error: errGlobal } = await supabase
    .from("global_comments")
    .delete()
    .eq("comment_id", commentId);

  if (errGlobal) {
    logger.error("deleteComment: global_comments delete failed", errGlobal);
    throw errGlobal;
  }

  if (taskId) {
    const { data: taskData } = await supabase
      .from("tasks")
      .select("comments_count")
      .eq("task_id", taskId)
      .single();

    if (taskData && (taskData.comments_count ?? 0) > 0) {
      await supabase
        .from("tasks")
        .update({ comments_count: Math.max(0, (taskData.comments_count || 0) - 1) })
        .eq("task_id", taskId);
    }
  }
};

export const subscribeToComments = (
  taskId: string,
  organizationId: string,
  callback: (comments: TaskComment[]) => void,
) => {
  getTaskComments(taskId, organizationId).then(callback);

  const channel = supabase
    .channel(`comments-${taskId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `task_id=eq.${taskId}`,
      },
      () => getTaskComments(taskId, organizationId).then(callback),
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// ============================================
// NOTIFICATIONS
// ============================================

export const createNotification = async (
  input: CreateNotificationInput,
): Promise<AppNotification> => {
  const now = new Date().toISOString();
  const notificationId = crypto.randomUUID();

  const notification = {
    notification_id: notificationId,
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.body,
    task_id: input.taskId || null,
    project_id: input.projectId || null,
    actor_user_id: input.actorUserId || null,
    actor_display_name: input.actorDisplayName || null,
    read: false,
    link: null,
    created_at: now,
  };

  const { data, error } = await supabase
    .from("notifications")
    .insert(notification)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create notification:", error);
    throw error;
  }

  return {
    notificationId: data.notification_id,
    userId: data.user_id,
    type: data.type,
    title: data.title,
    body: data.message,
    taskId: data.task_id,
    projectId: data.project_id,
    actorUserId: data.actor_user_id,
    actorDisplayName: data.actor_display_name,
    read: data.read,
    createdAt: new Date(data.created_at),
  } as AppNotification;
};

export const markNotificationRead = async (
  userId: string,
  notificationId: string,
): Promise<void> => {
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("notification_id", notificationId)
    .eq("user_id", userId);
};

/** Mark every unread notification for the user as read. */
export const markAllNotificationsRead = async (
  userId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) {
    throw new Error(
      `markAllNotificationsRead failed for userId=${userId}: ${error.message}`,
    );
  }
};

/** Permanently delete a single notification for the user (used by Inbox). */
export const deleteNotification = async (
  userId: string,
  notificationId: string,
): Promise<void> => {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("notification_id", notificationId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(
      `deleteNotification failed for notificationId=${notificationId}, userId=${userId}: ${error.message}`,
    );
  }
};

/** Notify assignees when a task is assigned, completed, or updated (workflow notifications). */
export const createNotificationsForTaskUpdate = async (params: {
  taskId: string;
  projectId: string;
  projectName: string;
  taskTitle: string;
  previousAssignees: { userId: string }[];
  newAssignees: { userId: string; displayName?: string }[];
  previousStatus?: string;
  newStatus?: string;
  actorUserId: string;
  actorDisplayName: string;
  /** When set (e.g. org members), sends optional EmailJS assignee email if env is configured. */
  getAssigneeEmail?: (userId: string) => string | undefined;
}): Promise<void> => {
  const {
    taskId,
    projectId,
    projectName,
    taskTitle,
    previousAssignees,
    newAssignees,
    previousStatus,
    newStatus,
    actorUserId,
    actorDisplayName,
    getAssigneeEmail,
  } = params;

  const previousIds = new Set(previousAssignees.map((a) => a.userId));
  const newIds = new Set(newAssignees.map((a) => a.userId));

  try {
    // New assignees: task_assigned
    for (const a of newAssignees) {
      if (!previousIds.has(a.userId) && a.userId !== actorUserId) {
        await createNotification({
          userId: a.userId,
          type: "task_assigned",
          title: "Task assigned to you",
          body: `${actorDisplayName} assigned you to "${taskTitle}" in ${projectName}`,
          taskId,
          projectId,
          actorUserId,
          actorDisplayName,
        }).catch((e) => logger.warn("createNotification task_assigned:", e));

        const email = getAssigneeEmail?.(a.userId)?.trim();
        if (email && email.includes("@")) {
          const taskUrl =
            typeof window !== "undefined"
              ? `${window.location.origin}/project/${projectId}?taskId=${taskId}`
              : "";
          void sendTaskAssignedEmail({
            toEmail: email,
            assigneeDisplayName: a.displayName,
            taskTitle,
            projectName,
            actorDisplayName,
            taskUrl,
          });
        }
      }
    }

    // Status → done: task_completed (notify all current assignees)
    if (newStatus === "done" && previousStatus !== "done") {
      for (const a of newAssignees) {
        if (a.userId !== actorUserId) {
          await createNotification({
            userId: a.userId,
            type: "task_completed",
            title: "Task completed",
            body: `"${taskTitle}" was marked done in ${projectName}`,
            taskId,
            projectId,
            actorUserId,
            actorDisplayName,
          }).catch((e) => logger.warn("createNotification task_completed:", e));
        }
      }
    }

    // Any other update: task_updated (notify assignees who didn't trigger it)
    const hadChange =
      newStatus !== previousStatus ||
      [...newIds].some((id) => !previousIds.has(id)) ||
      [...previousIds].some((id) => !newIds.has(id));
    if (hadChange && newStatus !== "done") {
      for (const a of newAssignees) {
        if (a.userId !== actorUserId && previousIds.has(a.userId)) {
          await createNotification({
            userId: a.userId,
            type: "task_updated",
            title: "Task updated",
            body: `${actorDisplayName} updated "${taskTitle}" in ${projectName}`,
            taskId,
            projectId,
            actorUserId,
            actorDisplayName,
          }).catch((e) => logger.warn("createNotification task_updated:", e));
        }
      }
    }
  } catch (e) {
    logger.warn("createNotificationsForTaskUpdate error:", e);
  }
};

/** Create due-date reminder notifications for assignees (automation). Call when loading tasks/dashboard. Skips if we already sent a reminder for that task to that user in the last 24h. */
export const createDueReminderNotifications = async (params: {
  tasks: { taskId: string; projectId: string; title: string; dueDate: string | null; assignees: { userId: string }[]; status: string }[];
  projectNames: Record<string, string>;
  hoursAhead?: number;
}): Promise<void> => {
  const { tasks, projectNames, hoursAhead = 24 } = params;
  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  for (const task of tasks) {
    if (task.status === "done" || !task.dueDate) continue;
    const due = new Date(task.dueDate);
    if (due <= now || due > cutoff) continue;
    const projectName = projectNames[task.projectId] || "Project";
    for (const a of task.assignees || []) {
      const { data: existing } = await supabase
        .from("notifications")
        .select("notification_id")
        .eq("user_id", a.userId)
        .eq("task_id", task.taskId)
        .eq("type", "task_reminder")
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();
      if (existing) continue;
      await createNotification({
        userId: a.userId,
        type: "task_reminder",
        title: "Due soon",
        body: `"${task.title}" is due in ${projectName} within ${hoursAhead}h`,
        taskId: task.taskId,
        projectId: task.projectId,
      }).catch(() => {});
    }
  }
};

export const fetchUserNotifications = async (
  userId: string,
  limit: number = 30,
): Promise<AppNotification[]> => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("Failed to fetch notifications:", error);
    return [];
  }

  return (data || []).map((n) => ({
    notificationId: n.notification_id,
    userId: n.user_id,
    type: n.type,
    title: n.title,
    body: n.message,
    taskId: n.task_id,
    projectId: n.project_id,
    actorUserId: n.actor_user_id,
    actorDisplayName: n.actor_display_name,
    read: n.read,
    createdAt: new Date(n.created_at),
  }));
};

/** Resolve @mentions in comment/chat text to member user IDs (best-effort). */
export const findMentionedUserIdsFromText = (
  text: string,
  members: { userId: string; displayName: string; email: string }[],
  excludeUserId: string,
): string[] => {
  const lower = text.toLowerCase();
  const mentioned = new Set<string>();
  for (const m of members) {
    if (!m.userId || m.userId === excludeUserId) continue;
    const name = (m.displayName || "").trim();
    const emailLocal = (m.email || "").split("@")[0]?.toLowerCase() || "";
    const candidates = new Set<string>();
    if (name) {
      candidates.add(name.toLowerCase());
      const first = name.split(/\s+/)[0]?.toLowerCase();
      if (first) candidates.add(first);
      candidates.add(name.replace(/\s+/g, "").toLowerCase());
    }
    if (emailLocal) candidates.add(emailLocal);
    for (const c of candidates) {
      if (c.length < 2) continue;
      if (lower.includes(`@${c}`)) {
        mentioned.add(m.userId);
        break;
      }
    }
  }
  return [...mentioned];
};

/** Fire in-app notifications for @mentions in a task comment (non-blocking). */
export const notifyTaskCommentMentions = async (params: {
  text: string;
  members: { userId: string; displayName: string; email: string }[];
  actorUserId: string;
  actorDisplayName: string;
  taskId: string;
  projectId: string;
  projectName: string;
  taskTitle: string;
}): Promise<void> => {
  const {
    text,
    members,
    actorUserId,
    actorDisplayName,
    taskId,
    projectId,
    projectName,
    taskTitle,
  } = params;
  const ids = findMentionedUserIdsFromText(text, members, actorUserId);
  for (const userId of ids) {
    await createNotification({
      userId,
      type: "comment_mention",
      title: "You were mentioned",
      body: `${actorDisplayName} mentioned you on "${taskTitle}" in ${projectName}`,
      taskId,
      projectId,
      actorUserId,
      actorDisplayName,
    }).catch((e) => logger.warn("comment_mention notify:", e));
  }
};

/** @mentions in project chat (no task link). Returns user IDs notified. */
export const notifyProjectChatMentions = async (params: {
  text: string;
  members: { userId: string; displayName: string; email: string }[];
  actorUserId: string;
  actorDisplayName: string;
  projectId: string;
  projectName: string;
}): Promise<string[]> => {
  const { text, members, actorUserId, actorDisplayName, projectId, projectName } =
    params;
  const ids = findMentionedUserIdsFromText(text, members, actorUserId);
  for (const userId of ids) {
    await createNotification({
      userId,
      type: "comment_mention",
      title: "You were mentioned",
      body: `${actorDisplayName} mentioned you in ${projectName} chat`,
      projectId,
      actorUserId,
      actorDisplayName,
    }).catch((e) => logger.warn("project_chat mention:", e));
  }
  return ids;
};

/** Notify project members about a new chat message (excluding author and optional skips). */
export const notifyProjectChatMessageToMembers = async (params: {
  projectId: string;
  projectName: string;
  actorUserId: string;
  actorDisplayName: string;
  body: string;
  memberUserIds: string[];
  skipUserIds: string[];
}): Promise<void> => {
  const skip = new Set(params.skipUserIds.filter(Boolean));
  const preview =
    params.body.length > 140
      ? `${params.body.slice(0, 137)}…`
      : params.body;
  for (const userId of params.memberUserIds) {
    if (!userId || userId === params.actorUserId || skip.has(userId)) continue;
    await createNotification({
      userId,
      type: "project_chat_message",
      title: `Chat: ${params.projectName}`,
      body: `${params.actorDisplayName}: ${preview}`,
      projectId: params.projectId,
      actorUserId: params.actorUserId,
      actorDisplayName: params.actorDisplayName,
    }).catch((e) => logger.warn("project_chat broadcast:", e));
  }
};

export interface ProjectChatMessage {
  messageId: string;
  projectId: string;
  organizationId: string | null;
  userId: string;
  displayName: string;
  photoURL: string;
  body: string;
  taskId: string | null;
  createdAt: Date;
}

const mapProjectChatRow = (d: Record<string, unknown>): ProjectChatMessage => ({
  messageId: d.message_id as string,
  projectId: d.project_id as string,
  organizationId: (d.organization_id as string) ?? null,
  userId: d.user_id as string,
  displayName: (d.display_name as string) || "",
  photoURL: (d.user_photo as string) || "",
  body: d.body as string,
  taskId: (d.task_id as string) ?? null,
  createdAt: new Date(d.created_at as string),
});

export const fetchProjectChatMessages = async (
  projectId: string,
  limit: number = 200,
): Promise<ProjectChatMessage[]> => {
  const { data, error } = await supabase
    .from("project_chat_messages")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.warn("fetchProjectChatMessages:", error.message);
    return [];
  }
  const rows = (data || []).map(mapProjectChatRow);
  return rows.reverse();
};

export const insertProjectChatMessage = async (params: {
  projectId: string;
  organizationId: string;
  userId: string;
  displayName: string;
  photoURL?: string;
  body: string;
  taskId?: string | null;
}): Promise<ProjectChatMessage> => {
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    message_id: messageId,
    project_id: params.projectId,
    organization_id: params.organizationId || null,
    user_id: params.userId,
    display_name: params.displayName,
    user_photo: params.photoURL || null,
    body: params.body.trim(),
    task_id: params.taskId || null,
    created_at: now,
  };

  const { data, error } = await supabase
    .from("project_chat_messages")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("insertProjectChatMessage:", error);
    throw error;
  }
  return mapProjectChatRow(data as Record<string, unknown>);
};

export const subscribeToProjectChat = (
  projectId: string,
  callback: (messages: ProjectChatMessage[]) => void,
  limit: number = 200,
) => {
  const load = () => {
    fetchProjectChatMessages(projectId, limit).then(callback);
  };

  load();

  const channel = supabase
    .channel(
      `project-chat-${projectId}-${Math.random().toString(36).slice(2, 9)}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "project_chat_messages",
        filter: `project_id=eq.${projectId}`,
      },
      load,
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

export const subscribeToUserNotifications = (
  userId: string,
  callback: (notifications: AppNotification[]) => void,
  limit: number = 30,
  onFetchError?: (message: string) => void,
) => {
  const fetchNotifications = () =>
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (error) {
          logger.warn("Notifications fetch failed (table may be missing):", error.message);
          onFetchError?.(error.message);
          callback([]);
          return;
        }
        if (data)
          callback(
            data.map((n) => ({
              notificationId: n.notification_id,
              userId: n.user_id,
              type: n.type,
              title: n.title,
              body: n.message,
              taskId: n.task_id,
              projectId: n.project_id,
              actorUserId: n.actor_user_id,
              actorDisplayName: n.actor_display_name,
              read: n.read,
              createdAt: new Date(n.created_at),
            })),
          );
        else
          callback([]);
      });

  fetchNotifications();

  const channel = supabase
    .channel(
      `notifications-${userId}-${Math.random().toString(36).slice(2, 9)}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      fetchNotifications,
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// ============================================
// GLOBAL COMMENTS
// ============================================

export const subscribeToUserComments = (
  userId: string,
  organizationId: string,
  callback: (comments: GlobalComment[]) => void,
) => {
  supabase
    .from("comments")
    .select(`*, tasks!inner(project_id, title, organization_id)`)
    .eq("user_id", userId)
    .eq("tasks.organization_id", organizationId)
    .order("created_at", { ascending: false })
    .then(({ data }) => {
      if (data) {
        callback(
          data.map((c) => ({
            commentId: c.comment_id,
            taskId: c.task_id,
            taskTitle: c.tasks?.title || "",
            projectId: c.tasks?.project_id || "",
            projectName: "",
            userId: c.user_id,
            displayName: c.user_name,
            photoURL: c.user_photo,
            text: c.text,
            attachments: c.attachments || [],
            timeSpentMinutes: c.time_spent,
            createdAt: new Date(c.created_at),
            updatedAt: new Date(c.updated_at),
            isEdited: false,
            visibleToUserIds: [],
            organizationId,
          })),
        );
      }
    });

  const channel = supabase
    .channel("user-comments-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        supabase
          .from("comments")
          .select(`*, tasks!inner(project_id, title, organization_id)`)
          .eq("user_id", userId)
          .eq("tasks.organization_id", organizationId)
          .order("created_at", { ascending: false })
          .then(({ data }) => {
            if (data) {
              callback(
                data.map((c) => ({
                  commentId: c.comment_id,
                  taskId: c.task_id,
                  taskTitle: c.tasks?.title || "",
                  projectId: c.tasks?.project_id || "",
                  projectName: "",
                  userId: c.user_id,
                  displayName: c.user_name,
                  photoURL: c.user_photo,
                  text: c.text,
                  attachments: c.attachments || [],
                  timeSpentMinutes: c.time_spent,
                  createdAt: new Date(c.created_at),
                  updatedAt: new Date(c.updated_at),
                  isEdited: false,
                  visibleToUserIds: [],
                  organizationId,
                })),
              );
            }
          });
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

export const addCommentWithGlobalSync = async (
  taskId: string,
  projectId: string,
  projectName: string,
  taskTitle: string,
  userId: string,
  displayName: string,
  photoURL: string,
  text: string,
  visibleToUserIds: string[],
  organizationId: string,
  attachments?: CommentAttachment[],
  timeSpentMinutes?: number,
): Promise<TaskComment> => {
  const now = new Date().toISOString();
  const commentId = crypto.randomUUID();

  const comment = {
    comment_id: commentId,
    task_id: taskId,
    user_id: userId,
    user_name: displayName,
    user_photo: photoURL,
    text,
    attachments: attachments || [],
    time_spent: timeSpentMinutes || 0,
    created_at: now,
    updated_at: now,
  };

  const globalComment = {
    comment_id: commentId,
    task_id: taskId,
    task_title: taskTitle,
    project_id: projectId,
    project_name: projectName,
    user_id: userId,
    user_name: displayName,
    user_photo: photoURL,
    text,
    attachments: attachments || [],
    time_spent: timeSpentMinutes || 0,
    visible_to_user_ids: visibleToUserIds,
    organization_id: organizationId,
    created_at: now,
    updated_at: now,
  };

  try {
    await supabase.from("comments").insert(comment);
    await supabase.from("global_comments").insert(globalComment);

    const { data: taskData } = await supabase
      .from("tasks")
      .select("comments_count")
      .eq("task_id", taskId)
      .single();

    if (taskData) {
      await supabase
        .from("tasks")
        .update({ comments_count: (taskData.comments_count || 0) + 1 })
        .eq("task_id", taskId);
    }

    await logActivity({
      taskId,
      projectId,
      projectName,
      taskTitle,
      organizationId,
      type: "comment_added",
      userId,
      displayName,
      photoURL,
    }).catch((err) =>
      logger.warn("logActivity(comment_added) failed — check org UUID and activity RLS:", err),
    );

    // Notify assignees about new comment (except comment author)
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("assignees")
      .eq("task_id", taskId)
      .maybeSingle();
    const assignees = (taskRow?.assignees as { userId: string }[]) || [];
    for (const a of assignees) {
      if (a.userId === userId) continue;
      await createNotification({
        userId: a.userId,
        type: "comment_added",
        title: "New comment",
        body: `${displayName} commented on "${taskTitle}" in ${projectName}`,
        taskId,
        projectId,
        actorUserId: userId,
        actorDisplayName: displayName,
      }).catch(() => {});
    }

    return {
      commentId,
      taskId,
      userId,
      displayName,
      photoURL,
      text,
      attachments: attachments || [],
      timeSpentMinutes: timeSpentMinutes || 0,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      isEdited: false,
    } as TaskComment;
  } catch (error) {
    logger.error("Failed to add comment with global sync:", error);
    throw error;
  }
};

export const getUserComments = async (
  _userId: string,
  organizationId: string,
): Promise<any[]> => {
  const { data, error } = await supabase
    .from("global_comments")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to get user comments:", error);
    return [];
  }

  return (data || []).map((c) => ({
    commentId: c.comment_id,
    taskId: c.task_id,
    taskTitle: c.task_title,
    projectId: c.project_id,
    projectName: c.project_name,
    userId: c.user_id,
    displayName: c.user_name,
    photoURL: c.user_photo,
    text: c.text,
    attachments: c.attachments || [],
    timeSpentMinutes: c.time_spent,
    createdAt: new Date(c.created_at),
    updatedAt: new Date(c.updated_at),
    isEdited: false,
    visibleToUserIds: c.visible_to_user_ids || [],
    organizationId: c.organization_id,
  }));
};

export const subscribeToGlobalUserComments = (
  userId: string,
  organizationId: string,
  callback: (comments: any[]) => void,
) => {
  getUserComments(userId, organizationId).then(callback);

  const channel = supabase
    .channel("global-user-comments-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "global_comments",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getUserComments(userId, organizationId).then(callback);
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// ============================================
// ACTIVITY EVENTS
// ============================================

export const logActivity = async (
  input: CreateActivityInput,
): Promise<ActivityEvent> => {
  const now = new Date().toISOString();
  const activityId = crypto.randomUUID();

  const event = {
    activity_id: activityId,
    task_id: input.taskId,
    project_id: input.projectId,
    project_name: input.projectName,
    task_title: input.taskTitle,
    organization_id: input.organizationId,
    type: input.type,
    user_id: input.userId,
    display_name: input.displayName,
    photo_url: input.photoURL,
    payload: input.payload || null,
    created_at: now,
  };

  const { data, error } = await supabase
    .from("activity")
    .insert(event)
    .select()
    .single();

  if (error) {
    logger.error("Failed to log activity:", error);
    throw error;
  }

  return {
    activityId: data.activity_id,
    taskId: data.task_id,
    projectId: data.project_id,
    projectName: data.project_name,
    taskTitle: data.task_title,
    organizationId: data.organization_id,
    type: data.type,
    userId: data.user_id,
    displayName: data.display_name,
    photoURL: data.photo_url,
    payload: data.payload,
    createdAt: new Date(data.created_at),
  } as ActivityEvent;
};

/** Skip activity for "local-xxx" org IDs (not real UUIDs); avoids 400 when activity.organization_id is UUID */
function isRealOrganizationId(organizationId: string): boolean {
  return Boolean(organizationId && !organizationId.startsWith("local-"));
}

export const subscribeToActivity = (
  organizationId: string,
  callback: (events: ActivityEvent[]) => void,
  limit: number = 50,
) => {
  if (!isRealOrganizationId(organizationId)) {
    callback([]);
    return () => {};
  }
  const fetch = () =>
    supabase
      .from("activity")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (error) {
          logger.warn("Activity fetch failed (table may be missing or RLS):", error.message);
          callback([]);
          return;
        }
        if (data)
          callback(
            data.map((d) => ({
              activityId: d.activity_id,
              taskId: d.task_id,
              projectId: d.project_id,
              projectName: d.project_name,
              taskTitle: d.task_title,
              organizationId: d.organization_id,
              type: d.type,
              userId: d.user_id,
              displayName: d.display_name,
              photoURL: d.photo_url,
              payload: d.payload,
              createdAt: new Date(d.created_at),
            })),
          );
      });

  fetch();

  const channel = supabase
    .channel(
      `activity-${organizationId}-${Math.random().toString(36).slice(2, 9)}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "activity",
        filter: `organization_id=eq.${organizationId}`,
      },
      fetch,
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

export const subscribeToTaskActivity = (
  taskId: string,
  organizationId: string,
  callback: (events: ActivityEvent[]) => void,
) => {
  if (!isRealOrganizationId(organizationId)) {
    callback([]);
    return () => {};
  }
  supabase
    .from("activity")
    .select("*")
    .eq("task_id", taskId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .then(({ data, error }) => {
      if (error) {
        logger.warn("Task activity fetch failed:", error.message);
        callback([]);
        return;
      }
      if (data) {
        callback(
          data.map((d) => ({
            activityId: d.activity_id,
            taskId: d.task_id,
            projectId: d.project_id,
            projectName: d.project_name,
            taskTitle: d.task_title,
            organizationId: d.organization_id,
            type: d.type,
            userId: d.user_id,
            displayName: d.display_name,
            photoURL: d.photo_url,
            payload: d.payload,
            createdAt: new Date(d.created_at),
          })),
        );
      }
    });

  const channel = supabase
    .channel(
      `task-activity-${taskId}-${Math.random().toString(36).slice(2, 11)}`,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "activity",
        filter: `task_id=eq.${taskId}`,
      },
      () => {
        supabase
          .from("activity")
          .select("*")
          .eq("task_id", taskId)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .then(({ data, error }) => {
            if (error) return;
            if (data) {
              callback(
                data.map((d) => ({
                  activityId: d.activity_id,
                  taskId: d.task_id,
                  projectId: d.project_id,
                  projectName: d.project_name,
                  taskTitle: d.task_title,
                  organizationId: d.organization_id,
                  type: d.type,
                  userId: d.user_id,
                  displayName: d.display_name,
                  photoURL: d.photo_url,
                  payload: d.payload,
                  createdAt: new Date(d.created_at),
                })),
              );
            }
          });
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};
