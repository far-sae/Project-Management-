// supabase/functions/crm-run-automations/actions/changeOwner.ts
import { ActionHandler } from "../shared/types.ts";

export const changeOwner: ActionHandler = async (ctx, config) => {
  const entity = config.entity as string;
  const ownerSpec = config.owner_id as string;
  if (entity !== "deal" && entity !== "client") {
    return { status: "failure", message: `Invalid entity '${entity}'` };
  }
  if (!ownerSpec) return { status: "failure", message: "owner_id required" };

  const id = entity === "deal"
    ? (ctx.event.payload as any).deal_id
    : (ctx.event.payload as any).client_id;
  if (!id) return { status: "skipped", message: `No ${entity}_id in event payload` };

  let resolved = ownerSpec;
  if (ownerSpec === "previous_owner" || ownerSpec === "creator") {
    const table = entity === "deal" ? "deals" : "clients";
    const idCol = entity === "deal" ? "deal_id" : "client_id";
    const col = ownerSpec === "creator" ? "created_by" : (entity === "deal" ? "owner_id" : "account_owner_id");
    const { data } = await ctx.admin.from(table).select(col).eq(idCol, id).maybeSingle();
    resolved = (data as any)?.[col];
    if (!resolved) return { status: "skipped", message: `No ${ownerSpec} available` };
  }

  // Look up display name.
  const { data: prof } = await ctx.admin.from("user_profiles").select("display_name").eq("id", resolved).maybeSingle();
  const name = (prof as any)?.display_name ?? null;

  const table = entity === "deal" ? "deals" : "clients";
  const idCol = entity === "deal" ? "deal_id" : "client_id";
  const update = entity === "deal"
    ? { owner_id: resolved, owner_name: name }
    : { account_owner_id: resolved, account_owner_name: name };

  const { error } = await ctx.admin.from(table).update(update).eq(idCol, id);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { entity, owner_id: resolved } };
};
