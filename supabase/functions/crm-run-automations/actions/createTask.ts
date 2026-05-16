// supabase/functions/crm-run-automations/actions/createTask.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

export const createTask: ActionHandler = async (ctx, config) => {
  const dealId = (ctx.event.payload as any).deal_id as string | undefined;
  const clientId = (ctx.event.payload as any).client_id as string | undefined;

  if (!clientId && !dealId) {
    return { status: "skipped", message: "No client or deal in event payload" };
  }

  // Resolve assignee.
  let assigneeId: string | null = null;
  const assignee = config.assignee as string | undefined;
  if (!assignee || assignee === "deal_owner") {
    if (dealId) {
      const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
      assigneeId = data?.owner_id ?? null;
    }
  } else if (assignee === "client_owner") {
    if (clientId) {
      const { data } = await ctx.admin.from("clients").select("account_owner_id").eq("client_id", clientId).maybeSingle();
      assigneeId = data?.account_owner_id ?? null;
    }
  } else {
    assigneeId = assignee;
  }

  const dueInDays = Number(config.due_in_days ?? 3);
  const due = new Date(Date.now() + dueInDays * 86400_000);

  const title = substitute(String(config.title ?? "Untitled task"), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
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
      due_date: due.toISOString().slice(0, 10),
      assigned_to: assigneeId,
      created_by: assigneeId,
      created_by_name: `Automation: ${ctx.recipeName}`,
    })
    .select("task_id")
    .single();
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { task_id: (data as any).task_id } };
};
