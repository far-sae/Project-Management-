// supabase/functions/crm-run-automations/actions/addNote.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

export const addNote: ActionHandler = async (ctx, config) => {
  const clientId = (ctx.event.payload as any).client_id as string | undefined;
  if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

  const kind = (config.kind as string) ?? "note";
  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });
  const body = substitute(String(config.body ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });

  const { error } = await ctx.admin.from("client_notes").insert({
    organization_id: ctx.orgId,
    client_id: clientId,
    kind,
    subject: subject || null,
    body: body || null,
    occurred_at: new Date().toISOString(),
    author_name: `Automation: ${ctx.recipeName}`,
  });
  if (error) return { status: "failure", message: error.message };
  return { status: "success" };
};
