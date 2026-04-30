// Supabase Edge Function: Proxy OpenAI chat requests (fixes CORS)
// Deploy: supabase functions deploy ai-chat
//
// Secrets (Dashboard → Edge Functions → Manage secrets):
//   OPENAI_API_KEY   — required (sk-… from OpenAI)
//
// Troubleshooting HTTP 502/503/500:
// • 503 MISSING_OPENAI_KEY — set OPENAI_API_KEY then redeploy
// • 401/403 from OpenAI — key revoked, typo, or org restrictions
// • 429 — rate/quota (check billing and usage limits at OpenAI)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.104.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
const allowedOrigins = allowedOriginsRaw
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))
      ? origin
      : (allowedOrigins[0] ?? "null");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));
  function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Require an authenticated user — prevents anonymous abuse of OPENAI_API_KEY billing.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (supabaseUrl && supabaseAnonKey) {
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      authHeader.slice(7),
    );
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const apiKeyRaw = Deno.env.get("OPENAI_API_KEY");
  const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
  if (!apiKey) {
    return json(
      {
        error:
          "OPENAI_API_KEY is not set on this Edge Function. In Supabase: Project Settings → Edge Functions → Secrets, add OPENAI_API_KEY with your OpenAI secret key (sk-…), then redeploy: supabase functions deploy ai-chat",
        code: "MISSING_OPENAI_KEY",
      },
      503,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const body = payload as {
      prompt?: unknown;
      model?: unknown;
      temperature?: unknown;
      max_tokens?: unknown;
    };
    const prompt = body.prompt;

    const model =
      typeof body.model === "string" && body.model.trim().length > 0
        ? body.model.trim()
        : "gpt-4o-mini";
    const temperature =
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? body.temperature
        : 0.7;
    const max_tokens =
      typeof body.max_tokens === "number" &&
        Number.isFinite(body.max_tokens) &&
        body.max_tokens > 0
        ? Math.min(Math.floor(body.max_tokens), 16_384)
        : 500;

    if (typeof prompt !== "string" || !prompt.trim()) {
      return json({ error: "Missing or invalid prompt" }, 400);
    }

    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens,
    });

    const content = response.choices[0]?.message?.content ?? "";
    return json({ content }, 200);
  } catch (err: unknown) {
    console.error("ai-chat error:", err);

    const any = err as {
      status?: number;
      code?: string;
      message?: string;
    };

    const msgRaw =
      typeof any.message === "string" && any.message.trim().length > 0
        ? any.message
        : err instanceof Error && err.message
          ? err.message
          : "AI request failed";

    let hint = msgRaw;
    const status =
      typeof any.status === "number" ? any.status : undefined;

    if (
      /\binvalid\b.*\bapi\b.*\bkey\b/i.test(msgRaw) ||
      msgRaw.toLowerCase().includes("incorrect api key") ||
      status === 401
    ) {
      hint =
        `${msgRaw}. Check OPENAI_API_KEY in Supabase Edge Function secrets (sk-… key must be active).`;
    } else if (status === 429 || /\bquota\b|\brate\b|\blimit\b/i.test(msgRaw)) {
      hint =
        `${msgRaw}. You may be rate-limited or out of quota—check usage and billing on platform.openai.com.`;
    } else if (status === 404) {
      hint =
        `${msgRaw}. The requested model may be unavailable or the name incorrect for your org.`;
    }

    const httpStatus =
      status === 429
        ? 429
        : typeof status === "number" &&
            status >= 400 &&
            status < 600
          ? 502
          : 500;

    return json(
      {
        error: hint,
        code: typeof any.code === "string"
          ? any.code
          : "OPENAI_REQUEST_FAILED",
      },
      httpStatus,
    );
  }
});
