// supabase/functions/crm-run-automations/actions/setField.ts
import { ActionHandler } from "../shared/types.ts";

const DEAL_WHITELIST = new Set(["value", "currency", "expected_close_date", "description", "source", "tags"]);
const CLIENT_WHITELIST = new Set(["industry", "status", "rating", "source", "country", "description"]);

export const setField: ActionHandler = async (ctx, config) => {
  const entity = config.entity as string;
  const field = config.field as string;
  const value = config.value;

  if (entity !== "deal" && entity !== "client") {
    return { status: "failure", message: `Invalid entity '${entity}'` };
  }
  const allowed = entity === "deal" ? DEAL_WHITELIST : CLIENT_WHITELIST;
  if (!allowed.has(field)) {
    return { status: "failure", message: `Field '${field}' is not editable on ${entity}` };
  }

  const id = entity === "deal"
    ? (ctx.event.payload as any).deal_id
    : (ctx.event.payload as any).client_id;
  if (!id) return { status: "skipped", message: `No ${entity}_id in event payload` };

  const table = entity === "deal" ? "deals" : "clients";
  const idCol = entity === "deal" ? "deal_id" : "client_id";
  const { error } = await ctx.admin.from(table).update({ [field]: value }).eq(idCol, id);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { entity, field, value } };
};
