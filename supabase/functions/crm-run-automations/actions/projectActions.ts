import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const DEFAULT_COLUMNS = [
  { id: "undefined", title: "Undefined task", color: "#9E9E9E", order: 0 },
  { id: "todo", title: "To-do", color: "#FF9800", order: 1 },
  { id: "inprogress", title: "On-Progress", color: "#2196F3", order: 2 },
  { id: "done", title: "Done", color: "#4CAF50", order: 3 },
  { id: "needreview", title: "Need review", color: "#9C27B0", order: 4 },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "#FF4444",
  medium: "#FFA500",
  low: "#4CAF50",
};

const buildTemplateContext = (ctx: any) => ({
  workspace: ctx.event.payload as any,
  project: ctx.event.payload as any,
  task: ctx.event.payload as any,
  client: ctx.event.payload as any,
  deal: ctx.event.payload as any,
  email: ctx.event.payload as any,
  recipe: { name: ctx.recipeName },
  aiOutputs: ctx.aiOutputs,
});

const resolveRecipeCreator = async (ctx: any): Promise<string | null> => {
  const { data } = await ctx.admin
    .from("automation_recipes")
    .select("created_by")
    .eq("recipe_id", ctx.recipeId)
    .maybeSingle();
  return (data?.created_by as string) ?? null;
};

const resolveProjectId = (ctx: any, config: Record<string, unknown>): string | null =>
  (config.project_id as string | undefined) ??
  ((ctx.event.payload as any).project_id as string | undefined) ??
  null;

const resolveTaskId = (ctx: any, config: Record<string, unknown>): string | null =>
  (config.task_id as string | undefined) ??
  ((ctx.event.payload as any).task_id as string | undefined) ??
  null;

export const createProject: ActionHandler = async (ctx, config) => {
  const templateCtx = buildTemplateContext(ctx);
  const name = substitute(String(config.name ?? ""), templateCtx).trim();
  if (!name) return { status: "failure", message: "Project name is required" };

  const ownerId = (config.owner_id as string | undefined) ?? await resolveRecipeCreator(ctx);
  if (!ownerId) return { status: "skipped", message: "Could not resolve project owner" };

  const workspaceId =
    (config.workspace_id as string | undefined) ??
    ((ctx.event.payload as any).workspace_id as string | undefined) ??
    null;
  const dueInDays = config.due_in_days === undefined ? null : Number(config.due_in_days);
  const endDate = Number.isFinite(dueInDays)
    ? new Date(Date.now() + Number(dueInDays) * 86400_000).toISOString()
    : null;

  const { data, error } = await ctx.admin
    .from("projects")
    .insert({
      organization_id: ctx.orgId,
      name,
      description: substitute(String(config.description ?? ""), templateCtx),
      cover_color: (config.cover_color as string | undefined) ?? "#3B82F6",
      owner_id: ownerId,
      workspace_id: workspaceId,
      columns: DEFAULT_COLUMNS,
      members: [],
      settings: { visibility: "team", is_archived: false },
      stats: { totalTasks: 0, completedTasks: 0, membersCount: 0 },
      end_date: endDate,
    })
    .select("project_id")
    .single();

  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { project_id: data.project_id } };
};

export const createProjectTask: ActionHandler = async (ctx, config) => {
  const projectId = resolveProjectId(ctx, config);
  if (!projectId) return { status: "skipped", message: "No project_id available" };

  const templateCtx = buildTemplateContext(ctx);
  const title = substitute(String(config.title ?? ""), templateCtx).trim();
  if (!title) return { status: "failure", message: "Task title is required" };

  const priority = (config.priority as string | undefined) ?? "medium";
  const assigneeId = (config.assignee_id as string | undefined) ?? null;
  const assignees = assigneeId ? [{ userId: assigneeId, displayName: "", email: "", photoURL: "" }] : [];
  const dueInDays = config.due_in_days === undefined ? null : Number(config.due_in_days);
  const dueDate = Number.isFinite(dueInDays)
    ? new Date(Date.now() + Number(dueInDays) * 86400_000).toISOString()
    : null;

  const { data, error } = await ctx.admin
    .from("tasks")
    .insert({
      organization_id: ctx.orgId,
      project_id: projectId,
      title,
      description: substitute(String(config.description ?? ""), templateCtx),
      status: (config.status as string | undefined) ?? "todo",
      priority,
      priority_color: PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.medium,
      due_date: dueDate,
      assignees,
      attachments: [],
      comments_count: 0,
      position: Number(config.position ?? 0),
      created_by: (config.created_by as string | undefined) ?? await resolveRecipeCreator(ctx),
    })
    .select("task_id")
    .single();

  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { task_id: data.task_id, project_id: projectId } };
};

export const assignTask: ActionHandler = async (ctx, config) => {
  const taskId = resolveTaskId(ctx, config);
  const assigneeId = config.assignee_id as string | undefined;
  if (!taskId) return { status: "skipped", message: "No task_id available" };
  if (!assigneeId) return { status: "failure", message: "assignee_id is required" };

  const { data: user } = await ctx.admin.auth.admin.getUserById(assigneeId);
  const metadata = user?.user?.user_metadata ?? {};
  const assignee = {
    userId: assigneeId,
    displayName: metadata.display_name ?? metadata.full_name ?? user?.user?.email ?? "",
    email: user?.user?.email ?? "",
    photoURL: metadata.avatar_url ?? metadata.photo_url ?? "",
  };

  const { data: task } = await ctx.admin
    .from("tasks")
    .select("assignees")
    .eq("task_id", taskId)
    .maybeSingle();
  const existing = Array.isArray(task?.assignees) ? task.assignees : [];
  const next = existing.some((a: any) => a?.userId === assigneeId)
    ? existing
    : [...existing, assignee];

  const { error } = await ctx.admin
    .from("tasks")
    .update({ assignees: next, updated_at: new Date().toISOString() })
    .eq("task_id", taskId);

  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { task_id: taskId, assignee_id: assigneeId } };
};
