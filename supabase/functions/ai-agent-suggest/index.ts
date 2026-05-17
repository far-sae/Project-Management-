// supabase/functions/ai-agent-suggest/index.ts
// Service-role-only entrypoint invoked by:
//  - crm-run-automations when an agent_intake recipe matches client_created
//  - crm-stuck-deal-scanner for re-engagement
// Flow: cap-check → load context → Apollo enrich → LLM draft → insert
// agent_suggestions row.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";
import { enrich, EnrichmentSnapshot } from "../_shared/apollo.ts";
import {
  SYSTEM_PROMPT, buildUserMessage,
  ClientFacts, DealFacts, StageRef,
} from "./draftPrompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";

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

interface SuggestRequest {
  trigger_type: "intake" | "re_engagement";
  organization_id: string;
  client_id?: string;
  deal_id?: string;
  source_event_id?: string;
}

const computeCostCents = (inputTokens: number, outputTokens: number): number =>
  inputTokens * 0.0003 + outputTokens * 0.0015;

const isOrgMember = (members: unknown, userId: string): boolean => {
  const rows = Array.isArray(members) ? members : [];
  return rows.some((m) => {
    const row = (m ?? {}) as Record<string, unknown>;
    return row.userId === userId || row.user_id === userId || row.id === userId;
  });
};

const authorizeOrgRequest = async (
  req: Request,
  admin: SupabaseClient,
  orgId: string,
): Promise<boolean> => {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return false;
  if (token === SERVICE_KEY) return true;

  const { data: userInfo, error: userErr } = await admin.auth.getUser(token);
  const user = userInfo.user;
  if (userErr || !user) return false;

  const { data: org } = await admin
    .from("organizations")
    .select("owner_id, members")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!org) return false;
  return org.owner_id === user.id || isOrgMember(org.members, user.id);
};

const countToday = async (
  admin: SupabaseClient, orgId: string, actionType: string,
): Promise<number> => {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("ai_block_runs")
    .select("run_id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("action_type", actionType)
    .gte("created_at", todayStart.toISOString());
  return count ?? 0;
};

const insertCapReached = async (
  admin: SupabaseClient, body: SuggestRequest, note: string,
): Promise<string> => {
  const { data, error } = await admin.from("agent_suggestions").insert({
    organization_id: body.organization_id,
    trigger_type: body.trigger_type,
    client_id: body.client_id ?? null,
    deal_id: body.deal_id ?? null,
    source_event_id: body.source_event_id ?? null,
    status: "cap_reached",
    rejected_note: note,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
};

const loadContext = async (admin: SupabaseClient, body: SuggestRequest) => {
  let client: ClientFacts = { name: "", email: "", company: null };
  let deal: DealFacts | null = null;
  const recentActivity: string[] = [];

  if (body.deal_id) {
    const { data: d } = await admin.from("deals")
      .select("title, value, stage_id, last_activity_at, client_id")
      .eq("deal_id", body.deal_id).maybeSingle();
    if (d) {
      const { data: s } = await admin.from("pipeline_stages")
        .select("label").eq("stage_id", d.stage_id).maybeSingle();
      const days = Math.floor(
        (Date.now() - new Date(d.last_activity_at as string).getTime()) /
          (24 * 3600 * 1000),
      );
      deal = {
        title: (d.title as string) ?? "(untitled)",
        value: Number(d.value ?? 0),
        stageName: (s?.label as string) ?? "(unknown)",
        daysInStage: days,
        lastActivityAt: d.last_activity_at as string,
      };
      if (!body.client_id && d.client_id) body.client_id = d.client_id as string;
    }
  }

  if (body.client_id) {
    const { data: c } = await admin.from("clients")
      .select("name, email, legal_name, industry")
      .eq("client_id", body.client_id).maybeSingle();
    if (c) {
      // In this CRM the "client" is an account/company; contact people live in
      // `client_contacts`. We use the client.name as both the company name and
      // the recipient placeholder — the LLM stitches them together.
      client = {
        name: (c.name as string) ?? "",
        email: (c.email as string) ?? "",
        company: (c.legal_name as string) ?? (c.name as string) ?? null,
      };
    }
    const { data: notes } = await admin.from("client_notes")
      .select("body")
      .eq("client_id", body.client_id)
      .order("occurred_at", { ascending: false })
      .limit(5);
    for (const n of notes ?? []) {
      if (n.body) recentActivity.push(`Note: ${String(n.body).slice(0, 120)}`);
    }
  }

  return { client, deal, recentActivity };
};

const loadStages = async (
  admin: SupabaseClient, orgId: string,
): Promise<StageRef[]> => {
  const { data } = await admin.from("pipeline_stages")
    .select("stage_id, label, pipeline_id, pipelines!inner(organization_id)")
    .eq("pipelines.organization_id", orgId);
  return (data ?? []).map((r) => ({
    stageId: r.stage_id as string,
    name: r.label as string,
  }));
};

const callLlm = async (system: string, user: string): Promise<{
  draft: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}> => {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const t0 = Date.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.5,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? (b as { text: string }).text : ""))
    .join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM did not return JSON");
  const draft = JSON.parse(m[0]);
  const inputTokens =
    (res.usage.input_tokens ?? 0) +
    ((res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0) +
    ((res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0);
  return {
    draft,
    inputTokens,
    outputTokens: res.usage.output_tokens ?? 0,
    durationMs: Date.now() - t0,
  };
};

const logUsage = async (
  admin: SupabaseClient,
  orgId: string,
  actionType: "apollo_lookup" | "agent_draft",
  fields: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsdCents?: number;
    durationMs?: number;
    status?: "success" | "failure" | "skipped";
    errorMessage?: string;
  },
): Promise<void> => {
  await admin.from("ai_block_runs").insert({
    organization_id: orgId,
    action_type: actionType,
    model: fields.model ?? "n/a",
    input_tokens: fields.inputTokens ?? null,
    output_tokens: fields.outputTokens ?? null,
    cost_usd_cents: fields.costUsdCents ?? null,
    duration_ms: fields.durationMs ?? null,
    status: fields.status ?? "success",
    error_message: fields.errorMessage ?? null,
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const body = await req.json() as SuggestRequest;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!await authorizeOrgRequest(req, admin, body.organization_id)) {
    return json({ error: "unauthorized" }, 401);
  }

  const { data: org } = await admin.from("organizations")
    .select("ai_agent_enabled, ai_agent_apollo_daily_cap, ai_agent_draft_daily_cap")
    .eq("organization_id", body.organization_id).maybeSingle();
  if (!org || !org.ai_agent_enabled) {
    return json({ skipped: "agent disabled" });
  }

  // Apollo cap (skip enrichment if hit — still allow generic draft).
  const apolloCap = Number(org.ai_agent_apollo_daily_cap ?? 20);
  const apolloUsedToday = await countToday(admin, body.organization_id, "apollo_lookup");
  const apolloAllowed = apolloUsedToday < apolloCap;

  const { client, deal, recentActivity } = await loadContext(admin, body);
  const emailLocal = client.email ?? "";
  const domain = emailLocal.includes("@") ? emailLocal.split("@")[1] : null;

  let enrichment: EnrichmentSnapshot | null = null;
  if (apolloAllowed) {
    try {
      const r = await enrich({
        admin,
        email: emailLocal || null,
        domain,
      });
      enrichment = r.snapshot;
      if (!r.cacheHit) {
        await logUsage(admin, body.organization_id, "apollo_lookup", {
          status: r.snapshot ? "success" : "skipped",
        });
      }
    } catch (e) {
      console.error("apollo enrich failed:", e);
      await logUsage(admin, body.organization_id, "apollo_lookup", {
        status: "failure", errorMessage: (e as Error).message,
      });
    }
  }

  // LLM cap (hard — no draft if hit).
  const draftCap = Number(org.ai_agent_draft_daily_cap ?? 50);
  const draftUsedToday = await countToday(admin, body.organization_id, "agent_draft");
  if (draftUsedToday >= draftCap) {
    const id = await insertCapReached(admin, body, "llm_cap");
    return json({ suggestion_id: id, status: "cap_reached" });
  }

  const stages = await loadStages(admin, body.organization_id);
  const userMsg = buildUserMessage({
    triggerType: body.trigger_type,
    client, deal,
    enrichment: enrichment as Record<string, unknown> | null,
    recentActivity, stages,
  });

  let draft: Record<string, unknown>;
  try {
    const r = await callLlm(SYSTEM_PROMPT, userMsg);
    draft = r.draft;
    await logUsage(admin, body.organization_id, "agent_draft", {
      model: MODEL,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsdCents: computeCostCents(r.inputTokens, r.outputTokens),
      durationMs: r.durationMs,
      status: "success",
    });
  } catch (e) {
    await logUsage(admin, body.organization_id, "agent_draft", {
      model: MODEL, status: "failure", errorMessage: (e as Error).message,
    });
    const { data } = await admin.from("agent_suggestions").insert({
      organization_id: body.organization_id,
      trigger_type: body.trigger_type,
      client_id: body.client_id ?? null,
      deal_id: body.deal_id ?? null,
      source_event_id: body.source_event_id ?? null,
      status: "failed",
      rejected_note: `llm_error: ${(e as Error).message}`.slice(0, 300),
    }).select("id").single();
    return json({ suggestion_id: data?.id, status: "failed" });
  }

  const { data: row, error } = await admin.from("agent_suggestions").insert({
    organization_id: body.organization_id,
    trigger_type: body.trigger_type,
    client_id: body.client_id ?? null,
    deal_id: body.deal_id ?? null,
    source_event_id: body.source_event_id ?? null,
    draft,
    enrichment_snapshot: enrichment,
    confidence: typeof draft.confidence === "number" ? draft.confidence : null,
    reasoning: (draft.reasoning as string) ?? null,
    suggested_next_stage_id: (draft.suggested_next_stage_id as string) ?? null,
    status: "pending",
  }).select("id").single();
  if (error) throw error;

  return json({ suggestion_id: row.id, status: "pending" });
});
