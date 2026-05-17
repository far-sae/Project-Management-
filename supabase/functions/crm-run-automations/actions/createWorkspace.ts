import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

export const createWorkspace: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const name = substitute(String(config.name ?? ""), {
    workspace: payload as any,
    project: payload as any,
    task: payload as any,
    client: payload as any,
    recipe: { name: ctx.recipeName },
  }).trim();

  if (!name) return { status: "failure", message: "Workspace name is required" };

  const { data, error } = await ctx.admin
    .from("workspaces")
    .insert({
      organization_id: ctx.orgId,
      name,
      is_default: Boolean(config.is_default ?? false),
    })
    .select("workspace_id")
    .single();

  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { workspace_id: data.workspace_id } };
};
