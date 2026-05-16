// supabase/functions/crm-run-automations/actions/sendEmail.ts
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

const resolveRecipient = async (ctx: any, spec: string): Promise<string | null> => {
  if (spec === "deal_owner_email") {
    const dealId = ctx.event.payload?.deal_id;
    if (!dealId) return null;
    const { data: deal } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (!deal?.owner_id) return null;
    // email lives in auth.users, not user_profiles
    const { data: userResp } = await ctx.admin.auth.admin.getUserById(deal.owner_id);
    return userResp?.user?.email ?? null;
  }
  if (spec === "client_email") {
    const clientId = ctx.event.payload?.client_id;
    if (!clientId) return null;
    const { data: client } = await ctx.admin.from("clients").select("email").eq("client_id", clientId).maybeSingle();
    return client?.email ?? null;
  }
  return spec; // assume literal address
};

export const sendEmail: ActionHandler = async (ctx, config) => {
  if (!await checkIntegration(ctx.admin, ctx.orgId, "gmail")) {
    return { status: "skipped", message: "No active Gmail integration — connect in Settings" };
  }
  const to = await resolveRecipient(ctx, String(config.to ?? ""));
  if (!to) return { status: "skipped", message: "Could not resolve recipient" };

  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });
  const body_html = substitute(String(config.body_html ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
  });

  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({
      action: "send-email",
      org_id: ctx.orgId,
      to, subject, body_html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Email send failed: ${res.status} ${body.slice(0, 200)}` };
  }
  return { status: "success", meta: { to } };
};
