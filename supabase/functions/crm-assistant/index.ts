// supabase/functions/crm-assistant/index.ts
//
// Conversational CRM assistant. The frontend posts a single user message
// (plus a short rolling history) and an organization context. We dispatch
// to Claude with a set of tools that can read the user's pipeline / leads
// / tasks and, where the user explicitly asked, propose write actions
// (draft email, classify lead, suggest stage move). All writes are still
// drafted, never executed silently — the assistant returns proposed_actions
// for the client to confirm before persisting.
//
// Role gating: members / admins / owners can all chat. Tool definitions
// flag write-class actions; the frontend hides confirm buttons for roles
// that lack the underlying permission.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 6;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

interface AssistantRequest {
  organization_id: string;
  user_message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface ProposedAction {
  type: "draft_email" | "create_task" | "move_deal_stage" | "classify_lead";
  label: string;
  payload: Record<string, unknown>;
}

const authorizeOrgRequest = async (
  req: Request,
  admin: SupabaseClient,
  orgId: string,
): Promise<{ ok: boolean; userId?: string; role?: string }> => {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { ok: false };
  if (token === SERVICE_KEY) return { ok: true, role: "owner" };

  const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
  const user = userInfo.user;
  if (userErr || !user) return { ok: false };

  const { data: org } = await admin
    .from("organizations")
    .select("owner_id, members")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!org) return { ok: false };

  if (org.owner_id === user.id) return { ok: true, userId: user.id, role: "owner" };
  const members = Array.isArray(org.members) ? org.members : [];
  const me = members.find((m) => {
    const row = (m ?? {}) as Record<string, unknown>;
    return row.userId === user.id || row.user_id === user.id || row.id === user.id;
  }) as Record<string, unknown> | undefined;
  if (!me) return { ok: false };
  return { ok: true, userId: user.id, role: String(me.role ?? "member") };
};

const TOOLS = [
  {
    name: "summarize_pipeline",
    description: "Return a per-stage summary of every open deal in the org: count, total value, weighted value. Read-only.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_overdue_tasks",
    description: "List client tasks past their due date that are not completed. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max rows to return (default 10).", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "list_hot_leads",
    description: "List leads currently graded as hot (score_band='hot') with name, company, owner. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  {
    name: "deal_detail",
    description: "Fetch a single deal by id with its title, stage, value, probability, close date, owner, and last 5 notes.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "UUID of the deal." },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "propose_draft_email",
    description: "Propose an email draft for a deal or client. Returns the draft as a proposed_action — the user reviews and sends from the UI. Use when the user asks to 'draft', 'write', or 'reach out'.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string" },
        client_id: { type: "string" },
        goal: { type: "string", description: "What the email should accomplish (e.g., 'schedule a discovery call')." },
        tone: { type: "string", enum: ["friendly", "professional", "concise"], default: "friendly" },
      },
      required: ["goal"],
    },
  },
  {
    name: "propose_move_deal_stage",
    description: "Propose moving a deal to a new stage. Returns a proposed_action — the user confirms before the move is committed.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string" },
        new_stage: { type: "string", enum: ["lead", "qualified", "proposal", "negotiation", "won", "lost"] },
      },
      required: ["deal_id", "new_stage"],
    },
  },
] as const;

const runTool = async (
  admin: SupabaseClient,
  orgId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<{ result: unknown; proposed?: ProposedAction }> => {
  switch (name) {
    case "summarize_pipeline": {
      const { data } = await admin
        .from("deals")
        .select("stage, value, probability")
        .eq("organization_id", orgId);
      const rows = (data ?? []) as Array<{ stage: string; value: number; probability: number }>;
      const byStage = new Map<string, { count: number; total: number; weighted: number }>();
      for (const r of rows) {
        const cur = byStage.get(r.stage) ?? { count: 0, total: 0, weighted: 0 };
        cur.count += 1;
        cur.total += Number(r.value) || 0;
        cur.weighted += (Number(r.value) || 0) * (Number(r.probability) || 0) / 100;
        byStage.set(r.stage, cur);
      }
      return { result: Object.fromEntries(byStage) };
    }
    case "list_overdue_tasks": {
      const limit = Math.min(50, Math.max(1, Number((input.limit ?? 10) as number)));
      const { data } = await admin
        .from("client_tasks")
        .select("task_id, title, due_date, status, client_id, deal_id, assigned_to_name")
        .eq("organization_id", orgId)
        .lt("due_date", new Date().toISOString().slice(0, 10))
        .neq("status", "done")
        .order("due_date", { ascending: true })
        .limit(limit);
      return { result: data ?? [] };
    }
    case "list_hot_leads": {
      const limit = Math.min(50, Math.max(1, Number((input.limit ?? 10) as number)));
      const { data } = await admin
        .from("leads")
        .select("lead_id, first_name, last_name, company, lead_owner_name, lead_status, score_band")
        .eq("organization_id", orgId)
        .eq("score_band", "hot")
        .limit(limit);
      return { result: data ?? [] };
    }
    case "deal_detail": {
      const dealId = String(input.deal_id ?? "");
      if (!dealId) return { result: { error: "deal_id required" } };
      const { data: deal } = await admin
        .from("deals")
        .select("*")
        .eq("organization_id", orgId)
        .eq("deal_id", dealId)
        .maybeSingle();
      if (!deal) return { result: { error: "Deal not found in this org." } };
      const { data: notes } = await admin
        .from("client_notes")
        .select("kind, subject, body, occurred_at, author_name")
        .eq("organization_id", orgId)
        .eq("deal_id", dealId)
        .order("occurred_at", { ascending: false })
        .limit(5);
      return { result: { deal, recent_notes: notes ?? [] } };
    }
    case "propose_draft_email": {
      return {
        result: { status: "draft_proposed" },
        proposed: {
          type: "draft_email",
          label: `Draft email${input.deal_id ? ` for deal ${String(input.deal_id).slice(0, 8)}` : ""} — goal: ${String(input.goal ?? "").slice(0, 80)}`,
          payload: input,
        },
      };
    }
    case "propose_move_deal_stage": {
      return {
        result: { status: "move_proposed" },
        proposed: {
          type: "move_deal_stage",
          label: `Move deal ${String(input.deal_id).slice(0, 8)} → ${String(input.new_stage)}`,
          payload: input,
        },
      };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);

  let body: AssistantRequest;
  try { body = await req.json() as AssistantRequest; }
  catch { return json({ error: "Invalid JSON" }, 400); }

  if (!body.organization_id || !body.user_message?.trim()) {
    return json({ error: "organization_id + user_message required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const auth = await authorizeOrgRequest(req, admin, body.organization_id);
  if (!auth.ok) return json({ error: "Forbidden" }, 403);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const systemPrompt = `You are a CRM assistant embedded in TaskCalendar. The current user's role is "${auth.role ?? "member"}".

You help reps, admins, and owners get work done across deals, leads, contacts, accounts, and tasks. Be brief and concrete — bullet points beat prose.

Rules:
- For reads: call the read-only tools (summarize_pipeline / list_overdue_tasks / list_hot_leads / deal_detail) before answering with numbers or facts. Never invent figures.
- For writes (email drafts, stage moves): use the propose_* tools so the user can review + confirm in the UI. Never claim you sent something.
- If the user is a "member" and asks for an admin-only change (e.g., delete a deal), tell them so and stop.
- Keep replies under 6 sentences unless the user explicitly asks for more.`;

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_TURNS) : [];
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.user_message },
  ];

  const proposed: ProposedAction[] = [];
  let response: Anthropic.Message;
  const toolLoopCap = 4;
  let loop = 0;

  while (true) {
    loop += 1;
    if (loop > toolLoopCap) break;
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS as unknown as Anthropic.Tool[],
      messages,
    });
    const toolUses = response.content.filter((c) => c.type === "tool_use") as Array<Anthropic.ToolUseBlock>;
    if (toolUses.length === 0) break;
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      const out = await runTool(admin, body.organization_id, t.name, t.input as Record<string, unknown>);
      if (out.proposed) proposed.push(out.proposed);
      toolResults.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(out.result).slice(0, 8000),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const textBlocks = response!.content.filter((c) => c.type === "text") as Array<Anthropic.TextBlock>;
  const assistantText = textBlocks.map((t) => t.text).join("\n").trim() || "(no response)";

  return json({
    reply: assistantText,
    proposed_actions: proposed,
    usage: {
      input_tokens: response!.usage?.input_tokens ?? 0,
      output_tokens: response!.usage?.output_tokens ?? 0,
    },
  });
});
