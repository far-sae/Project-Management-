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
Return STRICT JSON (no prose, no markdown) matching this schema:

{
  "action": "create_workspace" | "create_project" | "create_task" | "create_client" | "create_client_task" | "switch_org" | "list_orgs" | "help" | "unknown",
  "workspace": string | null,
  "project": string | null,
  "client": string | null,
  "title": string | null,
  "name": string | null,
  "description": string | null,
  "due": string | null,
  "confidence": number
}

How to pick the action — read the message and decide which entity the user is *creating*:
- "workspace X" → create_workspace, name=X
- "project X in workspace Y" or "project X in Y" → create_project, name=X, workspace=Y
- "task X in Y" or "X in project Y" or short imperative like "meeting with john tomorrow 9am in <project>" → create_task, title=X, project=Y
- "client X" or "new client X" → create_client, name=X
- "client task X for Y" or "follow up with <client> on …" → create_client_task, title=X, client=Y
- "help" / "/help" → help
- "list orgs" / "/orgs" → list_orgs

CRITICAL DISAMBIGUATION:
- If the message contains the literal word "project" followed by a name, the action is create_project — NOT create_task. Examples:
  • "add project Marketing in workspace Sales" → create_project, name="Marketing", workspace="Sales"
  • "new project Q1 launch" → create_project, name="Q1 launch"
- If the message contains the literal word "workspace" followed by a name AND no "project" keyword, the action is create_workspace.
- Use create_task only when the message describes work to *do* (verbs like call, meet, send, review, fix) or uses the literal word "task".

Few-shot examples:
1. "add workspace Acme Onboarding"
   → {"action":"create_workspace","workspace":null,"project":null,"client":null,"title":null,"name":"Acme Onboarding","description":null,"due":null,"confidence":0.95}
2. "new project Q1 launch in Acme Onboarding"
   → {"action":"create_project","workspace":"Acme Onboarding","project":null,"client":null,"title":null,"name":"Q1 launch","description":null,"due":null,"confidence":0.95}
3. "Add project taskcalender marketing team in workspace taskcalendar"
   → {"action":"create_project","workspace":"taskcalendar","project":null,"client":null,"title":null,"name":"taskcalender marketing team","description":null,"due":null,"confidence":0.9}
4. "task: call John tomorrow 3pm in Q1 launch"
   → {"action":"create_task","workspace":null,"project":"Q1 launch","client":null,"title":"call John","name":null,"description":null,"due":"<resolved ISO>","confidence":0.95}
5. "we have a meeting with John tomorrow 9am in Q1 launch"
   → {"action":"create_task","workspace":null,"project":"Q1 launch","client":null,"title":"meeting with John","name":null,"description":null,"due":"<resolved ISO>","confidence":0.9}
6. "new client Acme Corp"
   → {"action":"create_client","workspace":null,"project":null,"client":null,"title":null,"name":"Acme Corp","description":null,"due":null,"confidence":0.95}
7. "client task: follow up with Acme on Friday"
   → {"action":"create_client_task","workspace":null,"project":null,"client":"Acme","title":"follow up with Acme","name":null,"description":null,"due":"<resolved ISO>","confidence":0.9}
8. "Marketing" (no context, single word)
   → {"action":"unknown","workspace":null,"project":null,"client":null,"title":null,"name":null,"description":null,"due":null,"confidence":0.2}

Rules:
- Resolve relative dates ("tomorrow 3pm", "next Friday") against the provided nowIso + timezone.
- If the user names an entity that is in the workspaces / projects / clients context list, copy the exact list value into the matching field.
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
