// supabase/functions/dashboard-ai/index.ts
//
// Insights "Ask AI" (slice 7b). The frontend posts a plain-English question
// plus a compact `catalog` derived from the client-side metric registry
// (`src/services/dashboards/metrics.ts`). We make a single, temperature-0
// Anthropic call that must reply with ONLY a minified JSON widget spec +
// one-line takeaway, then we VALIDATE that spec against the supplied catalog
// server-side so a bad/unknown spec never reaches the client.
//
// The catalog travels from the client so the edge fn never drifts from the
// registry: whatever metrics/dimensions/chart types/timeframes the app knows
// about are exactly what the AI is allowed to pick from. We still re-validate
// against that same catalog here (defence in depth — the client also
// re-sanitizes via getMetric on the way back).
//
// Auth + cors + Anthropic setup mirror crm-assistant: a valid org-member
// bearer is required (reuse authorizeOrgRequest), model claude-sonnet-4-6,
// single no-tool call.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";

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

// The compact catalog the client sends (derived from METRICS). Kept minimal so
// the model has just enough to pick a valid, renderable spec.
interface CatalogEntry {
  id: string;
  label: string;
  group: string;
  dimensions: { id: string; label: string }[];
  chartTypes: string[];
  timeframe: boolean;
}

interface DashboardAiRequest {
  organization_id: string;
  question: string;
  catalog: CatalogEntry[];
}

interface AiWidget {
  metricId: string;
  dimension: string | null;
  chartType: string;
  timeframe: string | null;
  title: string;
}

const TIMEFRAMES = new Set(["30d", "90d", "qtd", "ytd"]);

// Reused verbatim from crm-assistant: a valid org-member (or service-role)
// bearer token gates the call.
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

// Strip ```json fences / surrounding prose and parse the first JSON object.
const parseJson = (raw: string): unknown => {
  let s = raw.trim();
  // Remove a leading ```json / ``` fence and the trailing ``` if present.
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Fall back to the first {...} block if the model added stray text.
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object");
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
};

// Validate the model's spec against the catalog the client sent. Returns a
// clean widget on success or null on any mismatch (unknown metric, chartType
// not allowed for that metric, dimension not in its list, timeframe on a
// metric that doesn't support one).
const validateWidget = (
  raw: unknown,
  catalog: CatalogEntry[],
): AiWidget | null => {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const metricId = typeof w.metricId === "string" ? w.metricId : "";
  const chartType = typeof w.chartType === "string" ? w.chartType : "";
  const metric = catalog.find((m) => m.id === metricId);
  if (!metric) return null;
  if (!metric.chartTypes.includes(chartType)) return null;

  // dimension: must be one the metric offers, or null/omitted.
  let dimension: string | null = null;
  if (typeof w.dimension === "string" && w.dimension.length > 0) {
    if (!metric.dimensions.some((d) => d.id === w.dimension)) return null;
    dimension = w.dimension;
  }

  // timeframe: only allowed when the metric supports a window, and must be a
  // known window value.
  let timeframe: string | null = null;
  if (typeof w.timeframe === "string" && w.timeframe.length > 0) {
    if (!metric.timeframe) return null;
    if (!TIMEFRAMES.has(w.timeframe)) return null;
    timeframe = w.timeframe;
  }

  const title =
    typeof w.title === "string" && w.title.trim().length > 0
      ? w.title.trim().slice(0, 80)
      : metric.label;

  return { metricId, dimension, chartType, timeframe, title };
};

// Defensive: only keep catalog entries with the exact shape we expect, so a
// malformed body can't smuggle anything past validation.
const sanitizeCatalog = (raw: unknown): CatalogEntry[] => {
  if (!Array.isArray(raw)) return [];
  const out: CatalogEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.label !== "string") continue;
    const chartTypes = Array.isArray(e.chartTypes)
      ? e.chartTypes.filter((c): c is string => typeof c === "string")
      : [];
    const dimensions = Array.isArray(e.dimensions)
      ? (e.dimensions as unknown[])
          .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
          .filter((d) => typeof d.id === "string" && typeof d.label === "string")
          .map((d) => ({ id: d.id as string, label: d.label as string }))
      : [];
    out.push({
      id: e.id,
      label: e.label,
      group: typeof e.group === "string" ? e.group : "",
      dimensions,
      chartTypes,
      timeframe: Boolean(e.timeframe),
    });
  }
  return out;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);

  let body: DashboardAiRequest;
  try {
    body = (await req.json()) as DashboardAiRequest;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.organization_id || !body.question?.trim()) {
    return json({ error: "organization_id + question required" }, 400);
  }

  const catalog = sanitizeCatalog(body.catalog);
  if (catalog.length === 0) {
    return json({ error: "A non-empty catalog is required." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const auth = await authorizeOrgRequest(req, admin, body.organization_id);
  if (!auth.ok) return json({ error: "Forbidden" }, 403);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const systemPrompt =
    'Return ONLY minified JSON {"widget":{"metricId","dimension"|null,"chartType",' +
    '"timeframe"|null,"title"},"takeaway"}. Pick metricId/chartType/dimension/timeframe ' +
    "ONLY from this catalog: " +
    JSON.stringify(catalog) +
    ". The takeaway is one short sentence about what the chart shows. No prose, no markdown.";

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: body.question.trim().slice(0, 500) }],
    });
  } catch (e) {
    return json({ error: `AI request failed: ${e instanceof Error ? e.message : "unknown"}` });
  }

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  let parsed: unknown;
  try {
    parsed = parseJson(text);
  } catch {
    return json({ error: "Couldn't turn that into a chart." });
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const widget = validateWidget(obj.widget, catalog);
  if (!widget) {
    return json({ error: "Couldn't turn that into a chart." });
  }

  const takeaway =
    typeof obj.takeaway === "string" && obj.takeaway.trim().length > 0
      ? obj.takeaway.trim().slice(0, 240)
      : "";

  return json({ widget, takeaway });
});
