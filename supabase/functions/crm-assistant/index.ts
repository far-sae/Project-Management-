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
  type:
    | "draft_email" | "move_deal_stage"
    | "create_client" | "create_lead" | "create_contact" | "create_deal"
    | "create_meeting" | "create_call" | "log_note"
    | "update_deal" | "update_lead_status"
    | "create_client_task" | "create_pm_task" | "assign_task"
    | "create_project" | "create_workspace"
    | "create_automation" | "create_campaign";
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
  { name: "list_org_members", description: "List org members (user_id + name + role) so you can resolve 'assign to <name>'. Read-only.",
    input_schema: { type: "object", properties: {}, required: [] } },
  { name: "list_workspaces", description: "List all workspaces in the org (name + whether default). Read-only.",
    input_schema: { type: "object", properties: {}, required: [] } },
  { name: "list_projects", description: "List projects in the org, optionally only those in a named workspace. Read-only.",
    input_schema: { type: "object", properties: { workspace: { type: "string", description: "Optional workspace name to filter by." } }, required: [] } },
  { name: "find_records", description: "Find clients/deals/leads/projects/contacts by name. Returns up to 6 {id,label}. If more than one matches, ask the user which one. Read-only.",
    input_schema: { type: "object", properties: {
      entity: { type: "string", enum: ["client","deal","lead","project","contact"] },
      query: { type: "string" } }, required: ["entity","query"] } },
  { name: "propose_create_client", description: "Propose creating a client/account.",
    input_schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, industry: { type: "string" } }, required: ["name"] } },
  { name: "propose_create_lead", description: "Propose creating a lead.",
    input_schema: { type: "object", properties: { first_name: { type: "string" }, last_name: { type: "string" }, company: { type: "string" }, email: { type: "string" }, phone: { type: "string" } }, required: ["last_name","company"] } },
  { name: "propose_create_contact", description: "Propose adding a contact under a client (use find_records to get client_id).",
    input_schema: { type: "object", properties: { client_id: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } }, required: ["client_id","last_name"] } },
  { name: "propose_create_deal", description: "Propose creating a deal.",
    input_schema: { type: "object", properties: { title: { type: "string" }, client_id: { type: "string" }, value: { type: "number" }, currency: { type: "string" }, stage: { type: "string", enum: ["lead","qualified","proposal","negotiation","won","lost"] } }, required: ["title"] } },
  { name: "propose_create_meeting", description: "Propose scheduling a meeting (ISO start).",
    input_schema: { type: "object", properties: { title: { type: "string" }, start_at: { type: "string" }, client_id: { type: "string" } }, required: ["title","start_at"] } },
  { name: "propose_create_call", description: "Propose logging a call.",
    input_schema: { type: "object", properties: { subject: { type: "string" }, client_id: { type: "string" }, outcome: { type: "string" } }, required: ["subject"] } },
  { name: "propose_log_note", description: "Propose a note on a client (use find_records for client_id).",
    input_schema: { type: "object", properties: { client_id: { type: "string" }, body: { type: "string" } }, required: ["client_id","body"] } },
  { name: "propose_update_deal", description: "Propose editing a deal's value/currency/close date.",
    input_schema: { type: "object", properties: { deal_id: { type: "string" }, value: { type: "number" }, currency: { type: "string" }, expected_close_date: { type: "string" } }, required: ["deal_id"] } },
  { name: "propose_update_lead_status", description: "Propose changing a lead's status.",
    input_schema: { type: "object", properties: { lead_id: { type: "string" }, lead_status: { type: "string" } }, required: ["lead_id","lead_status"] } },
  { name: "propose_create_client_task", description: "Propose a CRM follow-up task; optional assignee_id (use list_org_members).",
    input_schema: { type: "object", properties: { title: { type: "string" }, client_id: { type: "string" }, due_at: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["title"] } },
  { name: "propose_create_pm_task", description: "Propose a project task (needs project_id via find_records); optional assignee.",
    input_schema: { type: "object", properties: { title: { type: "string" }, project_id: { type: "string" }, due_date: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["title","project_id"] } },
  { name: "propose_assign_task", description: "Propose assigning an existing task to a member.",
    input_schema: { type: "object", properties: { task_kind: { type: "string", enum: ["client","pm"] }, task_id: { type: "string" }, assignee_id: { type: "string" }, assignee_name: { type: "string" } }, required: ["task_kind","task_id","assignee_id"] } },
  { name: "propose_create_project", description: "Propose creating a project.",
    input_schema: { type: "object", properties: { name: { type: "string" }, workspace_id: { type: "string" } }, required: ["name"] } },
  { name: "propose_create_workspace", description: "Propose creating a workspace.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "propose_create_automation", description: "Propose creating an automation from a plain-English description, e.g. 'when a lead becomes hot, create a follow-up task and notify the owner'. Give a short name plus a full description of the trigger AND what should happen (conditions + actions). It is built into a recipe and saved live on confirm.",
    input_schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name","description"] } },
  { name: "propose_create_campaign", description: "Propose creating an outreach EMAIL CAMPAIGN — a timed sequence (send an email, wait N days, send another, …). Give a short name, a description of the email steps + timing, and the target segment in plain text (e.g. 'leads in category Enterprise'). Built into a sequence recipe and saved live on confirm.",
    input_schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, segment: { type: "string" } }, required: ["name","description"] } },
] as const;

// Gate Deals/Leads READ tools by the #4 module grant (the admin client bypasses
// RLS, so we must check explicitly). owner/admin pass via the helper. A
// service-role caller (no userId) passes.
const canRead = async (admin: SupabaseClient, userId: string | undefined, orgId: string, module: "deals" | "leads"): Promise<boolean> => {
  if (!userId) return true;
  const { data } = await admin.rpc("has_module_access", {
    p_user_id: userId, p_org_id: orgId, p_module: module, p_need_edit: false,
  });
  return data === true;
};

const runTool = async (
  admin: SupabaseClient,
  orgId: string,
  userId: string | undefined,
  name: string,
  input: Record<string, unknown>,
): Promise<{ result: unknown; proposed?: ProposedAction }> => {
  switch (name) {
    case "summarize_pipeline": {
      if (!(await canRead(admin, userId, orgId, "deals"))) return { result: { error: "no access" } };
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
      if (!(await canRead(admin, userId, orgId, "leads"))) return { result: { error: "no access" } };
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
      if (!(await canRead(admin, userId, orgId, "deals"))) return { result: { error: "no access" } };
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
    case "list_org_members": {
      const { data: org } = await admin.from("organizations").select("owner_id, members").eq("organization_id", orgId).maybeSingle();
      const members = (Array.isArray(org?.members) ? org!.members : []) as Array<Record<string, unknown>>;
      return { result: members.map((m) => ({ user_id: m.userId ?? m.user_id, name: m.displayName ?? m.email, role: m.role ?? "member" })) };
    }
    case "list_workspaces": {
      const { data } = await admin.from("workspaces").select("workspace_id, name, is_default").eq("organization_id", orgId).order("name").limit(200);
      return { result: (data ?? []).map((w) => { const r = w as Record<string, unknown>; return { id: r.workspace_id, name: r.name, default: !!r.is_default }; }) };
    }
    case "list_projects": {
      let pq = admin.from("projects").select("project_id, name, workspace_id").eq("organization_id", orgId);
      const wsName = String(input.workspace ?? "").trim();
      if (wsName) {
        const { data: ws } = await admin.from("workspaces").select("workspace_id").eq("organization_id", orgId).ilike("name", wsName).limit(1).maybeSingle();
        const wsId = (ws as { workspace_id?: string } | null)?.workspace_id;
        if (wsId) pq = pq.eq("workspace_id", wsId);
      }
      const { data } = await pq.order("created_at", { ascending: false }).limit(200);
      return { result: (data ?? []).map((p) => { const r = p as Record<string, unknown>; return { id: r.project_id, name: r.name, workspace_id: r.workspace_id }; }) };
    }
    case "find_records": {
      const entity = String(input.entity ?? "");
      const q = `%${String(input.query ?? "").trim()}%`;
      type CfgEntry = { table: string; pk: string; col: string };
      const cfgMap: { [k: string]: CfgEntry } = {
        client: { table: "clients", pk: "client_id", col: "name" },
        deal: { table: "deals", pk: "deal_id", col: "title" },
        lead: { table: "leads", pk: "lead_id", col: "last_name" },
        project: { table: "projects", pk: "project_id", col: "name" },
        contact: { table: "client_contacts", pk: "contact_id", col: "last_name" },
      };
      const cfg: CfgEntry | undefined = cfgMap[entity];
      if (!cfg) return { result: { error: "bad entity" } };
      if ((entity === "deal") && !(await canRead(admin, userId, orgId, "deals"))) return { result: { error: "no access" } };
      if ((entity === "lead") && !(await canRead(admin, userId, orgId, "leads"))) return { result: { error: "no access" } };
      const { data } = await admin.from(cfg.table as string).select(`${cfg.pk}, ${cfg.col}`).eq("organization_id", orgId).ilike(cfg.col, q).limit(6);
      return { result: (data ?? []).map((r) => { const row = r as unknown as Record<string,string>; return { id: row[cfg.pk], label: row[cfg.col] }; }) };
    }
    case "propose_create_deal":
      return { result: { status: "proposed" }, proposed: { type: "create_deal", label: `Create deal "${String(input.title ?? "")}"`, payload: input } };
    case "propose_create_client":
      return { result: { status: "proposed" }, proposed: { type: "create_client", label: `Create client "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_lead":
      return { result: { status: "proposed" }, proposed: { type: "create_lead", label: `Create lead ${String(input.last_name ?? "")} (${String(input.company ?? "")})`, payload: input } };
    case "propose_create_contact":
      return { result: { status: "proposed" }, proposed: { type: "create_contact", label: `Add contact ${String(input.last_name ?? "")}`, payload: input } };
    case "propose_create_meeting":
      return { result: { status: "proposed" }, proposed: { type: "create_meeting", label: `Schedule "${String(input.title ?? "")}"`, payload: input } };
    case "propose_create_call":
      return { result: { status: "proposed" }, proposed: { type: "create_call", label: `Log call "${String(input.subject ?? "")}"`, payload: input } };
    case "propose_log_note":
      return { result: { status: "proposed" }, proposed: { type: "log_note", label: `Add note`, payload: input } };
    case "propose_update_deal":
      return { result: { status: "proposed" }, proposed: { type: "update_deal", label: `Update deal`, payload: input } };
    case "propose_update_lead_status":
      return { result: { status: "proposed" }, proposed: { type: "update_lead_status", label: `Set lead status → ${String(input.lead_status ?? "")}`, payload: input } };
    case "propose_create_client_task":
      return { result: { status: "proposed" }, proposed: { type: "create_client_task", label: `Task "${String(input.title ?? "")}"${input.assignee_name ? ` → ${String(input.assignee_name)}` : ""}`, payload: input } };
    case "propose_create_pm_task":
      return { result: { status: "proposed" }, proposed: { type: "create_pm_task", label: `Project task "${String(input.title ?? "")}"`, payload: input } };
    case "propose_assign_task":
      return { result: { status: "proposed" }, proposed: { type: "assign_task", label: `Assign → ${String(input.assignee_name ?? input.assignee_id)}`, payload: input } };
    case "propose_create_project":
      return { result: { status: "proposed" }, proposed: { type: "create_project", label: `Create project "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_workspace":
      return { result: { status: "proposed" }, proposed: { type: "create_workspace", label: `Create workspace "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_automation":
      return { result: { status: "proposed" }, proposed: { type: "create_automation", label: `Create automation "${String(input.name ?? "")}"`, payload: input } };
    case "propose_create_campaign":
      return { result: { status: "proposed" }, proposed: { type: "create_campaign", label: `Create campaign "${String(input.name ?? "")}"${input.segment ? ` → ${String(input.segment)}` : ""}`, payload: input } };
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

  // Give the assistant up-front knowledge of the whole org structure: every
  // workspace and the projects inside it. This lets it answer "what's in
  // workspace X", route a new task/project to the right place, and reason
  // across all workspaces without a tool round-trip.
  const [{ data: wsRows }, { data: projRows }] = await Promise.all([
    admin.from("workspaces").select("workspace_id, name, is_default").eq("organization_id", body.organization_id).limit(200),
    admin.from("projects").select("project_id, name, workspace_id").eq("organization_id", body.organization_id).limit(500),
  ]);
  const workspaces = (wsRows ?? []) as Array<{ workspace_id: string; name: string; is_default?: boolean }>;
  const allProjects = (projRows ?? []) as Array<{ project_id: string; name: string; workspace_id: string | null }>;
  const structureLines = workspaces.map((w) => {
    const ps = allProjects.filter((p) => p.workspace_id === w.workspace_id).map((p) => p.name);
    return `• ${w.name}${w.is_default ? " (default)" : ""}: ${ps.length ? ps.join(", ") : "(no projects)"}`;
  });
  const orphan = allProjects.filter((p) => !p.workspace_id || !workspaces.some((w) => w.workspace_id === p.workspace_id)).map((p) => p.name);
  if (orphan.length) structureLines.push(`• (no workspace): ${orphan.join(", ")}`);
  const orgStructure = structureLines.length
    ? `\n\nYOUR ORG'S WORKSPACES → PROJECTS (you know all of these; use the exact names, and resolve ids with find_records before any write):\n${structureLines.join("\n")}`
    : "\n\nThis org has no workspaces or projects yet.";

  const systemPrompt = `You are a CRM assistant embedded in TaskCalendar. The current user's role is "${auth.role ?? "member"}".

You help reps, admins, and owners get work done across deals, leads, contacts, accounts, and tasks.

WRITING STYLE (important):
- Reply in plain, natural text. Do NOT use Markdown. No asterisks (*), no bold/**, no underscores for emphasis, no "#" headings, and no emoji. For lists, write short numbered points ("1. ...") or plain sentences — never "- " bullets.
- Be brief: usually 1-4 short sentences.

WHEN THE USER WANTS TO CREATE / ADD / CHANGE SOMETHING — this is the most important rule:
- If the user asks to create, add, make, schedule, log, update, move, or assign anything (a task, deal, client, lead, contact, meeting, call, note, project, workspace, stage move, etc.), you MUST call the matching propose_* tool in THIS turn. Do not just describe it in text — a request with no propose_* call leaves the user stuck with no Confirm button.
- Propose with whatever details the user gave. Most actions need very little: a task needs only a title; a client needs only a name. Fill required fields from the message and leave optional ones out.
- Only ask a clarifying question when a REQUIRED field is truly missing and you cannot reasonably infer it. Never ask for optional details (due date, assignee, client link) before proposing — propose first; the user can edit on confirm.
- Resolve ids only when the user named a specific existing record/person: use find_records (for a client/deal/lead/project/contact) or list_org_members (to assign by name) to get the id, then call the propose_* tool. Never invent an id. If find_records returns more than one match, ask which one. If the user did not name a specific record, propose without that id.
- Every write is proposal-only — the user reviews and confirms in the UI before anything is saved. Never claim you already did, saved, sent, or created something.

READS: call the read-only tools (summarize_pipeline / list_overdue_tasks / list_hot_leads / deal_detail / find_records / list_org_members / list_workspaces / list_projects) before stating numbers or facts. Never invent figures. You already know the workspace→project structure below, so you can answer "what workspaces/projects do I have" and "what's in <workspace>" directly; use list_projects only when you need fresh detail.

If the user is a "member" and asks for an admin-only change, tell them plainly and stop.${orgStructure}`;

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_TURNS) : [];
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.user_message },
  ];

  const proposed: ProposedAction[] = [];
  let response: Anthropic.Message;
  const toolLoopCap = 5;
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
      const out = await runTool(admin, body.organization_id, auth.userId, t.name, t.input as Record<string, unknown>);
      if (out.proposed) proposed.push(out.proposed);
      toolResults.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(out.result).slice(0, 8000),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  let textBlocks = response!.content.filter((c) => c.type === "text") as Array<Anthropic.TextBlock>;

  // If the tool loop was cut off while the model was still calling tools, it
  // never produced a closing message. Make one final tool-less call so the
  // user always gets a reply alongside any proposed actions (rather than the
  // chat looking "stuck" with no text).
  if (textBlocks.length === 0 && response!.stop_reason === "tool_use") {
    try {
      const closing = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [...messages, { role: "user", content: "Briefly tell me what you've prepared (plain text, no markdown). If there's an action to confirm, say so." }],
      });
      response = closing;
      textBlocks = closing.content.filter((c) => c.type === "text") as Array<Anthropic.TextBlock>;
    } catch (_) { /* fall through to the default below */ }
  }

  const joined = textBlocks.map((t) => t.text).join("\n").trim();
  const assistantText = joined
    || (proposed.length > 0
      ? "I've prepared the action below — review the details and tap Confirm to apply it."
      : "(no response)");

  return json({
    reply: assistantText,
    proposed_actions: proposed,
    usage: {
      input_tokens: response!.usage?.input_tokens ?? 0,
      output_tokens: response!.usage?.output_tokens ?? 0,
    },
  });
});
