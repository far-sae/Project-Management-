// supabase/functions/crm-run-automations/actions/sendEmail.ts

import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";
import { decrypt } from "../../_shared/crypto.ts";

const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY");
const INBOUND_DOMAIN = Deno.env.get("SEQUENCE_INBOUND_DOMAIN") ?? "inbound.taskcalendar.co.uk";

interface ResolveContext {
  admin: any;
  orgId: string;
  payload: Record<string, unknown>;
}

const resolveRecipient = async (ctx: ResolveContext, spec: string): Promise<string | null> => {
  if (spec === "deal_owner_email") {
    const dealId = ctx.payload.deal_id as string | undefined;
    if (!dealId) return null;
    const { data: deal } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (!deal?.owner_id) return null;
    const { data: userResp } = await ctx.admin.auth.admin.getUserById(deal.owner_id);
    return userResp?.user?.email ?? null;
  }
  if (spec === "client_email") {
    const clientId = ctx.payload.client_id as string | undefined;
    if (!clientId) return null;
    const { data: client } = await ctx.admin.from("clients").select("email").eq("client_id", clientId).maybeSingle();
    return client?.email ?? null;
  }
  return spec; // literal address
};

// Sender user_id = deal owner, fallback to recipe creator.
const resolveSenderUserId = async (ctx: any): Promise<string | null> => {
  const dealId = (ctx.event.payload as { deal_id?: string }).deal_id;
  if (dealId) {
    const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (data?.owner_id) return data.owner_id;
  }
  const { data: recipe } = await ctx.admin
    .from("automation_recipes").select("created_by").eq("recipe_id", ctx.recipeId).maybeSingle();
  return recipe?.created_by ?? null;
};

const buildRawMessage = (
  fromEmail: string, fromName: string | null,
  to: string, replyTo: string, subject: string, bodyHtml: string,
): string => {
  const fromHeader = fromName ? `${fromName.replace(/"/g, "")} <${fromEmail}>` : fromEmail;
  const boundary = `tcb_${crypto.randomUUID()}`;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    bodyHtml.replace(/<[^>]+>/g, ""),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    bodyHtml,
    "",
    `--${boundary}--`,
  ];
  const utf8 = new TextEncoder().encode(lines.join("\r\n"));
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const sendEmail: ActionHandler = async (ctx, config) => {
  if (!TOKEN_KEY) {
    return { status: "failure", message: "INTEGRATION_TOKEN_KEY not set on the worker" };
  }

  const senderUserId = await resolveSenderUserId(ctx);
  if (!senderUserId) {
    return { status: "skipped", message: "Could not resolve sender for this event" };
  }

  const { data: integration } = await ctx.admin
    .from("integrations")
    .select("access_token_encrypted, status, metadata")
    .eq("user_id", senderUserId)
    .eq("provider", "gmail")
    .eq("status", "active")
    .maybeSingle();
  if (!integration) {
    return {
      status: "skipped",
      message: "No active Gmail integration for the sender — connect in Settings → Integrations",
    };
  }

  let accessToken: string;
  try {
    accessToken = await decrypt(integration.access_token_encrypted as string, TOKEN_KEY);
  } catch (err) {
    return { status: "failure", message: `Token decrypt failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const to = await resolveRecipient(
    { admin: ctx.admin, orgId: ctx.orgId, payload: ctx.event.payload as any },
    String(config.to ?? ""),
  );
  if (!to) return { status: "skipped", message: "Could not resolve recipient" };

  const subject = substitute(String(config.subject ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
    aiOutputs: ctx.aiOutputs,
  });
  const bodyHtml = substitute(String(config.body_html ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    recipe: { name: ctx.recipeName },
    aiOutputs: ctx.aiOutputs,
  });

  const fromEmail = (integration.metadata as { email?: string })?.email;
  if (!fromEmail) {
    return { status: "failure", message: "Connected Gmail account has no email in metadata — reconnect to populate" };
  }
  const fromName = (integration.metadata as { name?: string })?.name ?? null;
  const replyTo = `reply+${ctx.recipeRunId ?? ctx.recipeId}@${INBOUND_DOMAIN}`;

  const raw = buildRawMessage(fromEmail, fromName, to, replyTo, subject, bodyHtml);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "failure", message: `Gmail HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const respBody = await res.json();
  return {
    status: "success",
    meta: {
      message_id: (respBody as { id?: string }).id ?? null,
      thread_id: (respBody as { threadId?: string }).threadId ?? null,
      to,
      reply_to: replyTo,
    },
  };
};
