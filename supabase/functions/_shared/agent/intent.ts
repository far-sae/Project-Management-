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
  "action": "create_workspace" | "create_project" | "create_task" | "create_client" | "create_client_task" | "create_lead" | "create_contact" | "create_deal" | "create_meeting" | "create_call" | "log_note" | "query" | "list_workspaces" | "list_projects" | "update" | "switch_org" | "list_orgs" | "help" | "unknown",
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
  "entity": "task" | "client_task" | "deal" | "lead" | "client" | "meeting" | "call" | null,
  "scope": "mine" | "all" | null,
  "timeframe": "today" | "this_week" | "this_month" | "overdue" | "upcoming" | null,
  "target": string | null,
  "priority": string | null,
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

Read / list queries → action "query":
- "show my open tasks" / "what's due today" / "my tasks this week" → query, entity=task, scope=mine, (timeframe/status as stated)
- "tasks in <project>" → query, entity=task, project=<project>
- "deals closing this month" / "open deals" / "my deals" → query, entity=deal, (timeframe=this_month / scope=mine), stage if named
- "recent leads" / "new leads this week" → query, entity=lead, timeframe=this_week
- "list clients" / "show accounts" → query, entity=client
- "my meetings today" / "upcoming meetings" → query, entity=meeting, (timeframe), scope=mine
- "recent calls" → query, entity=call
Map "open" tasks to no specific status (the resolver excludes done); "done"/"completed" → status="done".

List workspaces / projects (their own actions, NOT "query"):
- "list workspaces" / "show my workspaces" / "what workspaces do I have" → list_workspaces
- "list projects" / "show projects" / "my projects" → list_projects (scope="mine" only if the user says "my")
- "projects in <workspace>" / "show projects under <workspace>" → list_projects, workspace=<workspace>

Edit / update an existing record → action "update":
- "mark <task> done" / "complete <task>" → update, entity=task, target=<task>, status="done"
- "reschedule <task> to <when>" / "move <task> to Friday" → update, entity=task, target=<task>, due=<ISO>
- "rename <task> to <new>" → update, entity=task, target=<task>, title=<new>
- "set <task> priority to high" → update, entity=task, target=<task>, priority="high"
- "move <deal> to Won" / "mark <deal> lost" → update, entity=deal, target=<deal>, stage="won"|"lost"
- "set <deal> value to 20000" → update, entity=deal, target=<deal>, value=20000
- "mark follow-up <x> done" → update, entity=client_task, target=<x>, status="done"
- "set lead <name> to contacted" → update, entity=lead, target=<name>, status="contacted"
- "cancel meeting <title>" → update, entity=meeting, target=<title>, status="cancelled"
- "reschedule meeting <title> to <when>" → update, entity=meeting, target=<title>, due=<ISO>
target = the existing record's name/title to look up; never invent it.

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
12. "show my open tasks"
    → {"action":"query","entity":"task","scope":"mine","confidence":0.9}
13. "deals closing this month"
    → {"action":"query","entity":"deal","timeframe":"this_month","confidence":0.9}
14. "upcoming meetings"
    → {"action":"query","entity":"meeting","timeframe":"upcoming","confidence":0.9}
15. "recent leads"
    → {"action":"query","entity":"lead","timeframe":"this_week","confidence":0.85}
16. "mark Deploy v2 done"
    → {"action":"update","entity":"task","target":"Deploy v2","status":"done","confidence":0.9}
17. "move the Acme Website deal to Won"
    → {"action":"update","entity":"deal","target":"Acme Website","stage":"won","confidence":0.9}
18. "reschedule Discovery call to tomorrow 4pm"
    → {"action":"update","entity":"meeting","target":"Discovery call","due":"<ISO>","confidence":0.85}
19. "list workspaces"
    → {"action":"list_workspaces","confidence":0.95}
20. "show my projects"
    → {"action":"list_projects","scope":"mine","confidence":0.9}
21. "projects in Sales"
    → {"action":"list_projects","workspace":"Sales","confidence":0.9}

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
