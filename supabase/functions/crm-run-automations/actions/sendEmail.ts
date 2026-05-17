// supabase/functions/crm-run-automations/actions/sendEmail.ts
// Recipe-engine wrapper around the shared Gmail send helper.

import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";
import { sendViaGmail } from "../../_shared/gmailSend.ts";

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

export const sendEmail: ActionHandler = async (ctx, config) => {
  const senderUserId = await resolveSenderUserId(ctx);
  if (!senderUserId) {
    return { status: "skipped", message: "Could not resolve sender for this event" };
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

  try {
    const r = await sendViaGmail({
      admin: ctx.admin,
      senderUserId,
      to,
      subject,
      bodyHtml,
      replyToToken: ctx.recipeRunId ?? ctx.recipeId,
      inboundDomain: INBOUND_DOMAIN,
    });
    return {
      status: "success",
      meta: {
        message_id: r.messageId,
        thread_id: r.threadId,
        to: r.to,
        reply_to: r.replyTo,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("no active Gmail integration")) {
      return {
        status: "skipped",
        message: "No active Gmail integration for the sender — connect in Settings → Integrations",
      };
    }
    return { status: "failure", message: msg };
  }
};
