// supabase/functions/_shared/agent/intent.ts
// Parses a free-text message into a structured Intent via OpenAI.
// Provider-agnostic — used by both telegram-webhook and whatsapp-webhook.

import type { Intent } from "./types.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_BOT_MODEL") ?? "gpt-4o-mini";

interface ParserContext {
  workspaces: string[];
  projects: string[];
  clients: string[];
  nowIso: string;
  timezone: string;
}

const SYSTEM_PROMPT = `You are an intent parser for a project-management + CRM bot. \
Return STRICT JSON (no prose, no markdown) matching this schema:

{
  "action": "create_workspace" | "create_project" | "create_task" | "create_client" | "create_client_task" | "create_lead" | "create_contact" | "create_deal" | "create_meeting" | "create_call" | "log_note" | "switch_org" | "list_orgs" | "help" | "unknown",
  "workspace": string | null,
  "project": string | null,
  "client": string | null,
  "title": string | null,
  "name": string | null,
  "description": string | null,
  "due": string | null,
  "email": string | null,
  "phone": string | null,
  "company": string | null,
  "stage": string | null,
  "value": number | null,
  "currency": string | null,
  "deal": string | null,
  "outcome": string | null,
  "body": string | null,
  "confidence": number
}

How to pick the action — read the message and decide which entity the user is *creating*:
PM-side:
- "workspace X" → create_workspace, name=X
- "project X in workspace Y" or "project X in Y" → create_project, name=X, workspace=Y
- "task X in Y" or "X in project Y" → create_task, title=X, project=Y
- "client X" or "new client X" / "new account X" → create_client, name=X
- "client task X for Y" or "follow up with <client> on …" → create_client_task, title=X, client=Y

CRM-side:
- "new lead <person> from <company>" / "lead: <person> at <company>" → create_lead, name=<person>, company=<company>, optionally email/phone
- "add contact <person> at <client>" / "contact <person> under <client>" → create_contact, name=<person>, client=<client>, optionally email/phone
- "new deal <title> for <client> worth <value> <currency>" / "deal: <title>" → create_deal, title=<title>, client=<client>, value=<n>, currency=<code>; optionally stage (Lead / Qualified / Proposal / Negotiation)
- "schedule meeting with <client> tomorrow 3pm" / "meeting: <title> with <client> on <when>" → create_meeting, title=<title>, client=<client>, due=<ISO>
- "log call: <subject> with <client>" / "called <client> about <subject>" → create_call, title=<subject>, client=<client>, optionally outcome=<what was discussed>, due=<ISO if scheduled>
- "note on <client>: <text>" / "<text> (on <client>)" → log_note, body=<text>, client=<client>

Utility:
- "help" / "/help" → help
- "list orgs" / "/orgs" → list_orgs

CRITICAL DISAMBIGUATION:
- "project" followed by a name → create_project, NOT create_task.
- "workspace" followed by a name + no "project" keyword → create_workspace.
- "lead" / "prospect" / "from <company>" → create_lead, NOT create_client (a lead becomes a client on conversion).
- "deal" / "opportunity" + a monetary value → create_deal.
- Email regex (anything matching x@y.z) → put it in "email" field.
- Phone regex (E.164 or local) → put it in "phone" field.
- ISO currency code (USD, GBP, EUR, INR) → put it in "currency" field.

Few-shot examples:
1. "add workspace Acme Onboarding"
   → {"action":"create_workspace","name":"Acme Onboarding","confidence":0.95}
2. "new project Q1 launch in Acme Onboarding"
   → {"action":"create_project","workspace":"Acme Onboarding","name":"Q1 launch","confidence":0.95}
3. "task: call John tomorrow 3pm in Q1 launch"
   → {"action":"create_task","project":"Q1 launch","title":"call John","due":"<ISO>","confidence":0.95}
4. "new client Acme Corp"
   → {"action":"create_client","name":"Acme Corp","confidence":0.95}
5. "client task: follow up with Acme on Friday"
   → {"action":"create_client_task","client":"Acme","title":"follow up with Acme","due":"<ISO>","confidence":0.9}
6. "new lead Jane Smith from Acme jane@acme.com"
   → {"action":"create_lead","name":"Smith","company":"Acme","email":"jane@acme.com","confidence":0.9}
7. "add contact Bob Jones under Acme Corp"
   → {"action":"create_contact","name":"Jones","client":"Acme Corp","confidence":0.9}
8. "new deal Website redesign for Acme worth 10000 USD"
   → {"action":"create_deal","title":"Website redesign","client":"Acme","value":10000,"currency":"USD","confidence":0.9}
9. "schedule meeting Discovery call with Acme tomorrow 3pm"
   → {"action":"create_meeting","title":"Discovery call","client":"Acme","due":"<ISO>","confidence":0.9}
10. "log call: pricing chat with Acme — they want to renew"
    → {"action":"create_call","title":"pricing chat","client":"Acme","outcome":"they want to renew","confidence":0.9}
11. "note on Acme: spoke to legal, contract going through"
    → {"action":"log_note","client":"Acme","body":"spoke to legal, contract going through","confidence":0.9}

Rules:
- Resolve relative dates ("tomorrow 3pm", "next Friday") against the provided nowIso + timezone.
- If the user names an entity in the workspaces / projects / clients context list, copy the exact list value into the matching field.
- Do NOT invent entities not in the message.
- For lead names, use the LAST name in the "name" field (it's stored as the lead's last_name).
- Return JSON only — no surrounding text. All fields not in the message stay null.`;

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
