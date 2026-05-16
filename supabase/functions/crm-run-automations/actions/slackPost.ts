// supabase/functions/crm-run-automations/actions/slackPost.ts
import { ActionHandler } from "../shared/types.ts";
import { SUPABASE_URL, SERVICE_KEY } from "../shared/client.ts";
import { substitute } from "../shared/substitute.ts";

const checkIntegration = async (admin: any, orgId: string, provider: string): Promise<boolean> => {
  const { data } = await admin
    .from("integrations")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
};

export const slackPost: ActionHandler = async (ctx, config) => {
  const channelId = config.channel_id as string;
  if (!channelId) return { status: "failure", message: "channel_id required" };

  if (!await checkIntegration(ctx.admin, ctx.orgId, "slack")) {
    return { status: "skipped", message: "No active Slack integration — connect in Settings" };
  }

  const text = substitute(String(config.text ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    actor: "Automation",
    recipe: { name: ctx.recipeName },
  });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      action: "slack-post",
      org_id: ctx.orgId,
      channel_id: channelId,
      text,
      blocks: config.blocks ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Slack post failed: ${res.status} ${body.slice(0, 200)}` };
  }
  return { status: "success" };
};
