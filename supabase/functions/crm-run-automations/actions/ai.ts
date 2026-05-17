// supabase/functions/crm-run-automations/actions/ai.ts
//
// AI block actions for the automation engine. All five handlers + shared
// callClaude helper + pure parser helpers (the parsers are exported for unit
// tests; the helpers stay in the same file to keep the prompt-and-shape
// definition next to the function that uses it).

import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.0";
import { ActionContext, ActionHandler, ActionResult } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";

const client = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

// Sonnet 4.6 pricing (May 2026): input $3/Mtok, output $15/Mtok.
//   $3  / 1_000_000 tokens = $0.000003 / token = 0.0003 cents / token
//   $15 / 1_000_000 tokens = $0.000015 / token = 0.0015 cents / token
export function computeCostCents(inputTokens: number, outputTokens: number): number {
  return inputTokens * 0.0003 + outputTokens * 0.0015;
}

// Validate + normalise the classify_lead response to one of hot|warm|cold.
// Returns null if the model produced an unparseable response.
export function parseClassifyResponse(raw: string): "hot" | "warm" | "cold" | null {
  if (!raw) return null;
  const firstWord = raw.trim().toLowerCase().split(/[\s.,—-]+/, 1)[0];
  if (firstWord === "hot" || firstWord === "warm" || firstWord === "cold") {
    return firstWord;
  }
  return null;
}

// Split the draft_email response into subject + body. Tolerates an optional
// leading "Subject:" prefix. Falls back to ("", fullText) if no blank line.
export function parseDraftEmailResponse(raw: string): { subject: string; body: string } {
  const text = raw.replace(/^\s*Subject:\s*/i, "");
  const idx = text.indexOf("\n\n");
  if (idx === -1) {
    return { subject: "", body: text.trim() };
  }
  return {
    subject: text.slice(0, idx).trim(),
    body: text.slice(idx + 2).trim(),
  };
}

// Parse the extract response as JSON. Strips ```json fences if model added
// them. Returns null on parse failure so the caller can mark the run as failed.
export function parseExtractResponse(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip markdown fences like ```json ... ```
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

interface CallOptions {
  actionType: string;
  system: string;
  user: string;
  maxTokens?: number;
}

interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
}

async function callClaude(ctx: ActionContext, opts: CallOptions): Promise<CallResult> {
  if (!client) throw new Error("ANTHROPIC_API_KEY not set on the worker");

  // Atomic cap check + increment. Throws ai_quota_exceeded if over the cap.
  const { data: allowed } = await ctx.admin.rpc("check_and_increment_ai_cap", { p_org: ctx.orgId });
  if (allowed === false) throw new Error("ai_quota_exceeded");

  const t0 = Date.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: [
      { type: "text", text: opts.system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: opts.user }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  const inputTokens =
    (res.usage.input_tokens ?? 0) +
    ((res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0) +
    ((res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0);
  const outputTokens = res.usage.output_tokens ?? 0;
  const costCents = computeCostCents(inputTokens, outputTokens);
  const durationMs = Date.now() - t0;

  // Best-effort logging; never let logging failure kill the action.
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    action_type: opts.actionType,
    model: MODEL,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd_cents: costCents.toFixed(4),
    status: "success",
    duration_ms: durationMs,
  }).then(() => undefined, () => undefined);

  return { text, inputTokens, outputTokens, costCents, durationMs };
}

async function logFailure(ctx: ActionContext, actionType: string, message: string): Promise<void> {
  await ctx.admin.from("ai_block_runs").insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    action_type: actionType,
    model: MODEL,
    status: "failure",
    error_message: message,
  }).then(() => undefined, () => undefined);
}

// Convert ai_quota_exceeded errors into ActionResult.skipped; everything else
// becomes ActionResult.failure. Centralised so each handler stays small.
function intoActionResult(err: unknown): ActionResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "ai_quota_exceeded") {
    return { status: "skipped", message: "ai_quota_exceeded" };
  }
  return { status: "failure", message: msg };
}

// ──────────────────────────────────────────────────────────────────────────
// ai_summarize
// ──────────────────────────────────────────────────────────────────────────

export const aiSummarize: ActionHandler = async (ctx, config) => {
  const actionType = "ai_summarize";
  try {
    const source = (config.source as string) ?? "client_notes";
    const limit = Number(config.limit ?? 5);
    const clientId = (ctx.event.payload as { client_id?: string }).client_id;

    let input = "";
    if (source === "client_notes") {
      if (!clientId) return { status: "skipped", message: "No client_id in event payload" };
      const { data: notes } = await ctx.admin
        .from("client_notes")
        .select("body, occurred_at, kind")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 20));
      input = (notes ?? [])
        .map((n: { occurred_at: string; kind: string; body: string }) =>
          `[${n.occurred_at}] (${n.kind}) ${n.body ?? ""}`)
        .join("\n\n");
      if (!input.trim()) {
        return { status: "skipped", message: "No notes to summarise" };
      }
    } else if (source === "free_text") {
      input = substitute(String(config.text ?? ""), ctx as any);
    } else {
      return { status: "failure", message: `Unknown source: ${source}` };
    }

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You summarise CRM customer activity into a 2-sentence brief for a busy sales rep. " +
        "Be concrete: mention specific things mentioned, deals, blockers. " +
        "Two sentences max. No bullet points, no headings.",
      user: input,
      maxTokens: 256,
    });

    // Write the summary as a note on the client (if we have one).
    let noteId: string | null = null;
    if (clientId) {
      const { data: noteRow } = await ctx.admin
        .from("client_notes")
        .insert({
          organization_id: ctx.orgId,
          client_id: clientId,
          kind: "note",
          subject: `AI summary (${ctx.recipeName})`,
          body: result.text,
          occurred_at: new Date().toISOString(),
          author_name: `Automation: ${ctx.recipeName}`,
        })
        .select("note_id")
        .single();
      noteId = (noteRow as { note_id?: string } | null)?.note_id ?? null;
    }

    return {
      status: "success",
      meta: {
        ai_output: result.text,
        note_id: noteId,
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_classify_lead
// ──────────────────────────────────────────────────────────────────────────

export const aiClassifyLead: ActionHandler = async (ctx, _config) => {
  const actionType = "ai_classify_lead";
  try {
    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    if (!clientId) return { status: "skipped", message: "No client_id in event payload" };

    const { data: clientRow } = await ctx.admin
      .from("clients")
      .select("name, industry, employee_count, annual_revenue, country, score, score_band")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!clientRow) return { status: "failure", message: "Client not found" };

    const { data: notes } = await ctx.admin
      .from("client_notes")
      .select("body, occurred_at")
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(5);

    const { count: openDealCount } = await ctx.admin
      .from("deals")
      .select("deal_id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .not("stage_id", "is", null);

    const input = [
      `Client: ${JSON.stringify(clientRow)}`,
      `Open deals (count): ${openDealCount ?? 0}`,
      "Recent notes (newest first):",
      ...(notes ?? []).map((n: { occurred_at: string; body: string }) =>
        `  [${n.occurred_at}] ${n.body ?? ""}`),
    ].join("\n");

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You classify a CRM lead as `hot`, `warm`, or `cold` based on the data. " +
        "Respond with EXACTLY one word: hot, warm, or cold. " +
        "Consider engagement recency, deal size, and stage progression. " +
        "No explanation, no punctuation, just the word.",
      user: input,
      maxTokens: 8,
    });

    const band = parseClassifyResponse(result.text);
    if (!band) {
      await logFailure(ctx, actionType, `Could not parse classify response: ${result.text}`);
      return { status: "failure", message: `Invalid classify response: "${result.text}"` };
    }

    await ctx.admin.from("clients").update({ score_band: band }).eq("client_id", clientId);

    return {
      status: "success",
      meta: { ai_output: band, cost_cents: result.costCents },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_draft_email
// ──────────────────────────────────────────────────────────────────────────

export const aiDraftEmail: ActionHandler = async (ctx, config) => {
  const actionType = "ai_draft_email";
  try {
    const goal = (config.goal as string)?.trim();
    if (!goal) return { status: "failure", message: "goal config required" };
    const tone = (config.tone as string) ?? "formal";
    const length = (config.length as string) ?? "short";

    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    let clientCtx = "";
    if (clientId) {
      const { data: c } = await ctx.admin
        .from("clients")
        .select("name, email, industry, country")
        .eq("client_id", clientId)
        .maybeSingle();
      if (c) clientCtx = `Client: ${JSON.stringify(c)}`;
    }

    const dealId = (ctx.event.payload as { deal_id?: string }).deal_id;
    let dealCtx = "";
    if (dealId) {
      const { data: d } = await ctx.admin
        .from("deals")
        .select("title, value, currency, stage")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (d) dealCtx = `Deal: ${JSON.stringify(d)}`;
    }

    const lengthHint = length === "medium"
      ? "Length: medium — 5 sentences max."
      : "Length: short — 3 sentences max.";

    const input = [
      `Goal: ${goal}`,
      clientCtx, dealCtx,
    ].filter(Boolean).join("\n");

    const result = await callClaude(ctx, {
      actionType,
      system:
        "You draft outbound sales emails. " +
        "Output format: subject line on first line, blank line, then body. " +
        `Tone: ${tone}. ${lengthHint} ` +
        "Do not include greeting or signature — the system adds those. " +
        "No markdown, plain text only.",
      user: input,
      maxTokens: 512,
    });

    const { subject, body } = parseDraftEmailResponse(result.text);

    return {
      status: "success",
      meta: {
        ai_output: result.text,
        ai_output_subject: subject,
        ai_output_body: body,
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_extract
// ──────────────────────────────────────────────────────────────────────────

export const aiExtract: ActionHandler = async (ctx, config) => {
  const actionType = "ai_extract";
  try {
    const sourceText = substitute(String(config.source_text ?? ""), ctx as any);
    const fields = Array.isArray(config.fields) ? (config.fields as string[]) : [];
    if (!sourceText.trim()) return { status: "skipped", message: "Empty source_text" };
    if (fields.length === 0) return { status: "failure", message: "fields config required" };

    const result = await callClaude(ctx, {
      actionType,
      system:
        "Extract these fields from the text. " +
        "Respond as a JSON object only — no prose, no markdown, no code fences. " +
        `Fields: ${fields.join(", ")}. ` +
        "Use null for any field not present in the text.",
      user: sourceText,
      maxTokens: 512,
    });

    const extracted = parseExtractResponse(result.text);
    if (!extracted) {
      await logFailure(ctx, actionType, `Could not parse extract response as JSON: ${result.text.slice(0, 200)}`);
      return { status: "failure", message: "Could not parse AI response as JSON" };
    }

    const clientId = (ctx.event.payload as { client_id?: string }).client_id;
    if (clientId) {
      // Postgres JSONB concat: existing keys overwritten, new keys appended.
      const { data: existing } = await ctx.admin
        .from("clients")
        .select("custom_fields")
        .eq("client_id", clientId)
        .maybeSingle();
      const merged = { ...(existing?.custom_fields ?? {}), ...extracted };
      await ctx.admin.from("clients").update({ custom_fields: merged }).eq("client_id", clientId);
    }

    return {
      status: "success",
      meta: {
        ai_output: JSON.stringify(extracted),
        fields_extracted: Object.keys(extracted),
        cost_cents: result.costCents,
      },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// ai_translate
// ──────────────────────────────────────────────────────────────────────────

export const aiTranslate: ActionHandler = async (ctx, config) => {
  const actionType = "ai_translate";
  try {
    const sourceText = substitute(String(config.source_text ?? ""), ctx as any);
    const target = (config.target_language as string)?.trim();
    if (!sourceText.trim()) return { status: "skipped", message: "Empty source_text" };
    if (!target) return { status: "failure", message: "target_language config required" };

    const result = await callClaude(ctx, {
      actionType,
      system:
        `Translate the following text to ${target}. ` +
        "Preserve formatting and line breaks. " +
        "Output only the translation, no explanation, no markdown.",
      user: sourceText,
      maxTokens: 1024,
    });

    return {
      status: "success",
      meta: { ai_output: result.text, cost_cents: result.costCents },
    };
  } catch (err) {
    const r = intoActionResult(err);
    if (r.status === "failure") await logFailure(ctx, actionType, r.message ?? "");
    return r;
  }
};
