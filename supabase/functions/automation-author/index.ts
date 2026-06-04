// supabase/functions/automation-author/index.ts
//
// Converts a plain-English automation description into a RecipeDraft JSON
// via a single Claude call. The frontend then sanitizes the result with
// sanitizeDraft() before opening the RecipeBuilder pre-filled — it is
// never auto-saved.
//
// Auth: requires a valid user bearer token that is an org member.

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

const SYSTEM = `You convert a plain-English description into a CRM/PM automation recipe.
Output ONLY minified JSON matching: {"name":"...","description":"...","trigger":{"type":"...","config":{}},"conditions":[{"field":"...","operator":"...","value":"..."}],"actions":[{"type":"...","config":{}}]}.
Valid trigger.type: deal_stage_entered, deal_field_changed, deal_score_band_changed, form_submitted, client_created, client_tagged, workspace_created, project_created, task_created, task_assigned, task_status_changed, email_reply_received, task_overdue, scheduled, agent_intake, slack_message_received, slack_reaction_added, date_relative, deal_inactive.
Valid action.type: create_task, create_project_task, assign_task, create_project, create_workspace, add_note, tag, set_field, change_owner, move_deal_stage, send_email, send_sms, notify, slack_post, webhook, ai_summarize, ai_classify_lead, ai_draft_email, ai_extract, ai_translate, wait, create_google_meet.
Valid condition.operator: eq, neq, gt, gte, lt, lte, in, contains, exists.
No prose, no markdown — JSON only.`;

interface AuthorRequest {
  organization_id: string;
  description: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ANTHROPIC_KEY) return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);

  let body: AuthorRequest;
  try { body = await req.json() as AuthorRequest; }
  catch { return json({ error: "Invalid JSON" }, 400); }

  if (!body.organization_id || !body.description?.trim()) {
    return json({ error: "organization_id + description required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const auth = await authorizeOrgRequest(req, admin, body.organization_id);
  if (!auth.ok) return json({ error: "Forbidden" }, 403);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content: body.description.trim() }],
    });
    const textBlocks = response.content.filter((c) => c.type === "text") as Array<{ type: "text"; text: string }>;
    rawText = textBlocks.map((t) => t.text).join("").trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Claude call failed: ${msg}` }, 502);
  }

  // Strip optional code fences (```json ... ``` or ``` ... ```)
  const fenced = rawText.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  const jsonText = fenced ? fenced[1].trim() : rawText;

  let draft: unknown;
  try {
    draft = JSON.parse(jsonText);
  } catch {
    return json({ error: "Model did not return valid JSON", raw: rawText.slice(0, 500) }, 422);
  }

  return json({ draft });
});
