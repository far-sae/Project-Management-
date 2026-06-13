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
  if (spec === "task_assignee_email") {
    const taskId = ctx.payload.task_id as string | undefined;
    if (!taskId) return null;
    const { data: task } = await ctx.admin.from("tasks").select("assignees").eq("task_id", taskId).maybeSingle();
    const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
    return (assignees[0]?.email as string | undefined) ?? null;
  }
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
  if (spec === "lead_email") {
    const leadId = ctx.payload.lead_id as string | undefined;
    if (!leadId) return null;
    const { data: lead } = await ctx.admin
      .from("leads").select("email, email_opt_out").eq("lead_id", leadId).maybeSingle();
    // Honour the lead's opt-out — campaigns must never email an opted-out lead.
    if (!lead?.email || lead.email_opt_out) return null;
    return lead.email;
  }
  return spec; // literal address
};

// Sender user_id = deal owner, fallback to recipe creator.
const resolveSenderUserId = async (ctx: any): Promise<string | null> => {
  const taskId = (ctx.event.payload as { task_id?: string }).task_id;
  if (taskId) {
    const { data } = await ctx.admin.from("tasks").select("created_by").eq("task_id", taskId).maybeSingle();
    if (data?.created_by) return data.created_by;
  }
  const dealId = (ctx.event.payload as { deal_id?: string }).deal_id;
  if (dealId) {
    const { data } = await ctx.admin.from("deals").select("owner_id").eq("deal_id", dealId).maybeSingle();
    if (data?.owner_id) return data.owner_id;
  }
  const leadId = (ctx.event.payload as { lead_id?: string }).lead_id;
  if (leadId) {
    const { data } = await ctx.admin.from("leads").select("lead_owner_id").eq("lead_id", leadId).maybeSingle();
    if (data?.lead_owner_id) return data.lead_owner_id;
  }
  const { data: recipe } = await ctx.admin
    .from("automation_recipes").select("created_by").eq("recipe_id", ctx.recipeId).maybeSingle();
  return recipe?.created_by ?? null;
};

const buildTemplateContext = async (ctx: any) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  let task = payload;
  const taskId = payload.task_id as string | undefined;
  if (taskId) {
    const { data } = await ctx.admin
      .from("tasks")
      .select("task_id, title, description, status, priority, due_date, assignees, google_meet_link")
      .eq("task_id", taskId)
      .maybeSingle();
    if (data) task = data as Record<string, unknown>;
  }

  // Lead campaigns: expose the lead so templates can address it
  // ({{lead.first_name}}, {{client.name}} for a friendly fallback).
  let lead: Record<string, unknown> | null = null;
  const leadId = payload.lead_id as string | undefined;
  if (leadId) {
    const { data } = await ctx.admin
      .from("leads")
      .select("first_name, last_name, company, email, salutation, title")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (data) lead = data as Record<string, unknown>;
  }
  const leadName = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || (lead.company as string) || undefined
    : undefined;

  return {
    deal: payload as any,
    lead: (lead ?? payload) as any,
    client: { name: (payload.client_name as string | undefined) ?? leadName },
    workspace: payload as any,
    project: payload as any,
    task: task as any,
    email: payload as any,
    recipe: { name: ctx.recipeName },
    aiOutputs: ctx.aiOutputs,
  };
};

export const sendEmail: ActionHandler = async (ctx, config) => {
  const senderUserId = await resolveSenderUserId(ctx);
  if (!senderUserId) {
    return { status: "skipped", message: "Could not resolve sender for this event" };
  }

  // Lead enrolments (campaigns) always go to the lead — the authored
  // `to` may say client_email/literal, but this event is for a lead.
  const payload = ctx.event.payload as { lead_id?: string };
  const toSpec = payload.lead_id ? "lead_email" : String(config.to ?? "");
  const to = await resolveRecipient(
    { admin: ctx.admin, orgId: ctx.orgId, payload: ctx.event.payload as any },
    toSpec,
  );
  if (!to) {
    return {
      status: "skipped",
      message: payload.lead_id
        ? "Lead has no email or opted out — skipped"
        : "Could not resolve recipient",
    };
  }

  const templateCtx = await buildTemplateContext(ctx);
  const subject = substitute(String(config.subject ?? ""), templateCtx);
  const bodyHtml = substitute(String(config.body_html ?? ""), templateCtx);

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
