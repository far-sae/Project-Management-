// supabase/functions/crm-run-automations/actions/tagClient.ts
import { ActionHandler } from "../shared/types.ts";

export const tagClient: ActionHandler = async (ctx, config) => {
  const clientId = (ctx.event.payload as any).client_id as string | undefined;
  if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

  const tag = config.tag as string;
  const mode = (config.mode as string) ?? "add";
  if (!tag) return { status: "failure", message: "tag config required" };

  const { data: row, error: readErr } = await ctx.admin
    .from("clients")
    .select("tags")
    .eq("client_id", clientId)
    .maybeSingle();
  if (readErr) return { status: "failure", message: readErr.message };
  const tags: string[] = Array.isArray(row?.tags) ? row.tags : [];

  let next: string[];
  if (mode === "remove") {
    next = tags.filter((t) => t !== tag);
  } else {
    next = tags.includes(tag) ? tags : [...tags, tag];
  }

  if (next.length === tags.length && JSON.stringify(next) === JSON.stringify(tags)) {
    return { status: "skipped", message: `Tag already ${mode === "remove" ? "absent" : "present"}` };
  }

  const { error } = await ctx.admin.from("clients").update({ tags: next }).eq("client_id", clientId);
  if (error) return { status: "failure", message: error.message };
  return { status: "success", meta: { tag, mode } };
};
