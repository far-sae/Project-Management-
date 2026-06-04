// supabase/functions/crm-run-automations/actions/notify.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

/** In-app notification. config: { user: "deal_owner"|"client_owner"|"<user_id>", title, body } */
export const notify: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const who = String(config.user ?? "deal_owner");

  let userId: string | null = null;
  if (who === "deal_owner") {
    userId = (payload.owner_id as string | undefined) ?? null;
  } else if (who === "client_owner") {
    userId = (payload.account_owner_id as string | undefined) ?? null;
  } else {
    userId = who || null;
  }
  if (!userId) return { status: "skipped", message: `Could not resolve recipient "${who}"` };

  const scope = {
    deal: payload as any,
    client: { name: payload.client_name as string | undefined },
    recipe: { name: ctx.recipeName },
  };
  const title = substitute(String(config.title ?? "Automation"), scope) || "Automation";
  const body = substitute(String(config.body ?? ""), scope);

  // Primary: direct insert via the service-role admin client, which bypasses RLS.
  // The create_notification_v1 RPC requires auth.uid() (not available in an
  // edge-fn service-role context) and also restricts the type to a fixed
  // whitelist that excludes "automation". The direct insert is therefore the
  // reliable path for automation-triggered notifications.
  const { error } = await ctx.admin.from("notifications").insert({
    notification_id: crypto.randomUUID(),
    user_id: userId,
    type: "automation",
    title,
    message: body,
    read: false,
    created_at: new Date().toISOString(),
  });
  if (error) return { status: "failure", message: error.message };
  return { status: "success" };
};
