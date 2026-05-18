// supabase/functions/telegram-webhook/intent.ts
// Parses a free-text message into a structured Intent via OpenAI.

import type { Intent } from "./types.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_BOT_MODEL") ?? "gpt-4o-mini";

interface ParserContext {
  workspaces: string[];        // names, max ~50
  projects: string[];           // names, max ~50
  clients: string[];            // names, max ~50
  nowIso: string;               // for relative date resolution
  timezone: string;             // e.g., "Asia/Karachi"
}

const SYSTEM_PROMPT = `You are an intent parser for a project-management CRM bot. \
Given a user message and a list of known workspaces / projects / clients, return STRICT JSON \
(no prose, no markdown) matching this schema:

{
  "action": "create_workspace" | "create_project" | "create_task" | "create_client" | "create_client_task" | "switch_org" | "list_orgs" | "help" | "unknown",
  "workspace": string | null,
  "project": string | null,
  "client": string | null,
  "title": string | null,
  "name": string | null,
  "description": string | null,
  "due": string | null,        // ISO 8601 in user's timezone, or null
  "confidence": number          // 0..1
}

Rules:
- Resolve relative dates ("tomorrow 3pm", "next Friday") against the provided nowIso + timezone.
- If the user names an entity that is in the context list, copy the exact list value.
- If you are unsure of intent, set action="unknown" and confidence below 0.5.
- Do NOT invent entities not in the message.
- Return JSON only — no surrounding text.`;

export const parseIntent = async (
  message: string,
  ctx: ParserContext,
): Promise<Intent> => {
  if (!OPENAI_API_KEY) {
    return { action: "unknown", confidence: 0 };
  }
  const userPrompt = [
    `nowIso: ${ctx.nowIso}`,
    `timezone: ${ctx.timezone}`,
    `workspaces: ${JSON.stringify(ctx.workspaces)}`,
    `projects: ${JSON.stringify(ctx.projects)}`,
    `clients: ${JSON.stringify(ctx.clients)}`,
    ``,
    `message: ${message}`,
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    console.error("openai parse failed:", res.status, await res.text());
    return { action: "unknown", confidence: 0 };
  }
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as Intent;
    if (typeof parsed.action !== "string") {
      return { action: "unknown", confidence: 0 };
    }
    return parsed;
  } catch {
    return { action: "unknown", confidence: 0 };
  }
};
