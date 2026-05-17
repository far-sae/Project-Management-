// supabase/functions/crm-run-automations/actions/createTask.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

// Resolve the recipe creator id — used as the last-resort assignee
// fallback for Slack-triggered tasks where no deal/client owner exists.
const resolveRecipeCreator = async (ctx: any): Promise<string | null> => {
  const { data } = await ctx.admin
    .from("automation_recipes")
    .select("created_by")
    .eq("recipe_id", ctx.recipeId)
    .maybeSingle();
  return (data?.created_by as string) ?? null;
};

// Resolve auth.users by email — used for the slack_sender assignee path.
const resolveUserByEmail = async (
  admin: any, email: string,
): Promise<string | null> => {
  // auth.admin.listUsers does not support email filtering directly, so
  // we use the SECURITY DEFINER view exposed via PostgREST: the
  // auth.users table is accessible through the service-role client.
  try {
    const { data } = await admin
      .schema("auth").from("users")
      .select("id").eq("email", email).maybeSingle();
    return (data?.id as string) ?? null;
  } catch {
    return null;
  }
};

export const createTask: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const dealId = payload.deal_id as string | undefined;
  const clientId = payload.client_id as string | undefined;
  const isSlackEvent = ctx.event.event_type === "slack_message_received";

  if (!clientId && !dealId && !isSlackEvent) {
    return { status: "skipped", message: "No client or deal in event payload" };
  }

  // Resolve assignee. Order: explicit config.assignee → role-based
  // (deal_owner / client_owner / slack_sender) → recipe creator.
  let assigneeId: string | null = null;
  const assignee = config.assignee as string | undefined;
  if (assignee === "slack_sender") {
    const email = payload.user_email as string | undefined;
    if (email) assigneeId = await resolveUserByEmail(ctx.admin, email);
    if (!assigneeId) assigneeId = await resolveRecipeCreator(ctx);
  } else if (!assignee || assignee === "deal_owner") {
    if (dealId) {
      const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
      assigneeId = data?.owner_id ?? null;
    }
    if (!assigneeId && isSlackEvent) assigneeId = await resolveRecipeCreator(ctx);
  } else if (assignee === "client_owner") {
    if (clientId) {
      const { data } = await ctx.admin.from("clients").select("account_owner_id").eq("client_id", clientId).maybeSingle();
      assigneeId = data?.account_owner_id ?? null;
    }
    if (!assigneeId && isSlackEvent) assigneeId = await resolveRecipeCreator(ctx);
  } else {
    assigneeId = assignee;
  }

  const dueInDays = Number(config.due_in_days ?? 3);
  const due = new Date(Date.now() + dueInDays * 86400_000);

  const title = substitute(String(config.title ?? "Untitled task"), {
    deal: payload as any,
    client: { name: payload.client_name as string | undefined },
    recipe: { name: ctx.recipeName },
    // Slack-trigger payload is exposed under {{slack.*}} (text, channel_name,
    // user_name, user_email, permalink). Unknown placeholders pass through
    // unchanged, so this is backwards-compatible for non-Slack triggers.
    slack: payload as any,
  });

  // Optional dedupe — title-based de-duplication scoped to this client.
  const dedupeKey = config.dedupe_key as string | undefined;
  if (dedupeKey && clientId) {
    const { data: existing } = await ctx.admin
      .from("client_tasks")
      .select("task_id")
      .eq("client_id", clientId)
      .eq("title", dedupeKey)
      .maybeSingle();
    if (existing) {
      return { status: "skipped", message: "duplicate_dedupe_key" };
    }
  }

  const { data, error } = await ctx.admin
    .from("client_tasks")
    .insert({
      organization_id: ctx.orgId,
      client_id: clientId ?? null,
      title,
      status: "pending",
      due_at: due.toISOString(),
      assigned_to: assigneeId,
      created_by: assigneeId,
      created_by_name: `Automation: ${ctx.recipeName}`,
    })
    .select("task_id")
    .single();
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { task_id: (data as any).task_id } };
};
