# CRM automation — build contract (stage one)

Design board (approved by the owner on 2026-11-20): https://claude.ai/artifact/4FQHyzSPF7HsyjBdi33gBB
A copy of the nine boards is in the session scratchpad under `automation-design/project/*.dc.html`.

## What it is

Agents carry a new lead all the way to a running project in one workspace. Each agent has one job
and hands its result to the next. A person steps in only where the rules say "needs approval".
Every workspace runs on its own: own agents, own chain, own rules, own spending limit.

Stage one (this contract) builds: the background runner, the six core agents (Researcher,
Qualifier, Writer, Chaser, Deal keeper, Project starter), approvals, the run record, workspace
rules, the assistant that builds an automation from plain words, and custom agents.
Later stages (not in this contract): leads arriving by themselves (web form, inbox, other apps),
meetings and calls, proposals, and the after-project agent.

## Shared code that already exists (do not redefine)

- `api/_automation/shared/types.ts` — every shape the server and the screens share. Read it first.
- `src/services/automation/client.ts` — `automationClient(workspaceId).call(path, body?, method?)`,
  `AutomationError`, `errorSentence`, `errorStatus`. Header `X-Workspace-Id`.
- `src/hooks/useAutomation.ts` — `{ client, workspaceId, workspaceName }`.
- `src/components/automation/AutomationPage.tsx` — the frame every screen renders as its root.

## Server

One Vercel function `api/automation.ts` (CommonJS, `maxDuration: 300`), reached as
`/api/automation/<path>` (rewrite to `?path=`), router and modules under `api/_automation/`.
It follows the documents server (`api/signroom.ts`, `api/_signroom/`) in every convention: own
origin only, body size limit, sign-in from the bearer token, service-role Supabase client, plain
sentences for every refusal, a 503 sentence that names what is missing (`ANTHROPIC_API_KEY`, or
"run supabase/migrations/187_automation.sql in the Supabase SQL editor"). Reuse the documents
server's host helpers by importing them (`api/_signroom/host/*`), do not copy them.

### Who may do what

The workspace comes from `X-Workspace-Id` and is checked on every request against the
organisation's members, exactly as the documents server does (`workspaceAccess`): organisation
owner or admin → "Owner"; member → "Member"; viewer, outsider, unknown workspace → 403
"Choose a workspace.".
- Owner: everything.
- Member: may read the overview, agents, automations, runs and rules; may approve or reject an
  approval only when they own the lead (or its deal); may mark their own lead as replied. Every
  other change is 403 "Only a workspace owner or admin can change the automation."

### Tables (migration `supabase/migrations/187_automation.sql`)

Prefix `auto_`. Row level security ON with NO policy; service role only. Idempotent. Suggested:
`auto_rules` (one row per workspace), `auto_agents`, `auto_automations`, `auto_runs`,
`auto_run_steps`, `auto_approvals`, `auto_events`, `auto_usage`. No foreign key to `sr_*` tables.

`auto_events` is filled by database triggers on the CRM tables, so every way a lead or deal
changes is seen (the app, an import, anything else): lead added, lead status changed, deal added,
deal stage or status changed, an activity of type call / email / meeting logged for a contact.
A trigger writes only when the row's workspace has automation enabled, and must never make the
CRM write fail (catch every error inside the trigger function). Events caused by the automation's
own writes must not start loops: the server marks its own writes (for example
`crm_activities.metadata.automation = true`, and a per-transaction setting or an `auto_` marker for
status changes) and the runner ignores them.

### Routes (JSON; shapes from `shared/types.ts`)

| Method and path | Body | Reply |
|---|---|---|
| `GET overview` | | `Overview` |
| `POST setup` | `{}` | `Overview`. Owner. Creates the rules row (enabled, `ask_external`), the six agents and one automation "New lead to project" in status `draft`. Safe to repeat. |
| `POST nudge` | `{}` | `{ ok: true }`. Processes this workspace's waiting events and due runs now (kept alive after the reply). At most once a minute per workspace. |
| `GET rules` | | `WorkspaceRules` |
| `POST rules` | `WorkspaceRulesInput` | `WorkspaceRules`. Owner. 409 on a stale `revision`. |
| `GET workspaces` | | `WorkspaceRow[]` for the organisation's workspaces the caller is owner or admin of. |
| `GET people` | | `Array<{ userId, name }>`: the workspace's members (for "project lead"). |
| `GET agents` | | `Agent[]` (not archived), in the order of the main automation's chain, others after. |
| `POST agents` | `AgentInput` | `Agent`. Owner. |
| `PATCH agents/:id` | `AgentInput & { revision }` | `Agent`. Owner. 409 on a stale revision. |
| `POST agents/:id/pause` / `resume` | `{}` | `Agent`. Owner. A paused agent's step waits. |
| `DELETE agents/:id` | | `{ ok: true }`. Owner. Archives it; refused (409, with the automation's name) while a chain uses it. |
| `POST agents/:id/test` | `{ contactId? }` | `TestResult` with one step. Owner. Nothing is changed or sent. |
| `GET automations` | | `Automation[]` |
| `GET automations/:id` | | `Automation` |
| `POST automations` | `AutomationDraft` | `Automation` (status `draft`). Owner. Creates the draft's new agents. |
| `PATCH automations/:id` | `AutomationInput & { revision }` or `AutomationDraft & { revision }` | `Automation`. Owner. |
| `POST automations/:id/turn-on` / `pause` | `{}` | `Automation`. Owner. Turning on needs at least one step and no archived agent. |
| `POST automations/:id/test` | `{ contactId? }` | `TestResult`. Owner. Runs the steps that would start straight away on that lead (or the newest lead), changing and sending nothing. |
| `POST automations/test-draft` | `{ draft: AutomationDraft, contactId? }` | `TestResult`. Owner. The same for a draft that is not saved yet. |
| `POST assistant` | `{ messages: AssistantMessage[], draft: AutomationDraft \| null }` | `AssistantReply`. Owner. Saves nothing. |
| `GET runs?status=&contactId=&dealId=&limit=` | | `RunSummary[]`, newest first, at most 100. |
| `GET runs/:id` | | `Run` |
| `POST runs/:id/stop` | `{}` | `Run`. Owner, or the lead's owner. |
| `POST runs/:id/replied` | `{ positive: boolean, note?: string }` | `Run`. Logs the reply on the lead and wakes the run. |
| `GET approvals` | | `Approval[]` pending, oldest first. |
| `POST approvals/:id/approve` | `{ subject?, body? }` (an edited email) | `Approval`. Carries the action out, then lets the run go on. |
| `POST approvals/:id/reject` | `{ reason? }` | `Approval`. The run stops with "Stopped at step N: not approved". |
| `GET\|POST ops/run` | | Vercel cron every 5 minutes, checked by `Authorization: Bearer <CRON_SECRET>` like the documents cron. |

### The runner

- A new `lead_created` event starts one run per automation that is `on` in that workspace (never
  two runs of the same automation for the same lead). `skipImports` skips leads whose source says
  they came from an import.
- A run walks the chain. A step starts per its `StepStart`. `no_reply_days` waits that long after
  the previous step and is SKIPPED when a reply arrived meanwhile; `on_reply` and `on_deal_won`
  wait for that event. "A reply" = a person logged a call, email or meeting on the lead, a person
  moved the lead's status forward, or `runs/:id/replied` was called.
- One agent step = one AI call that returns `{ decided, outcome: continue | stop, handoff,
  actions[] }` (structured output). The agent's input is: its job, the lead, its company, its
  deal, the recent notes and activities, and what the previous step handed on. Text that came from
  outside (lead fields, notes, email bodies, web pages) is data, never instructions, and is passed
  as such.
- The server then decides each proposed action: dropped (and said so in the step's record) when
  the agent lacks the right or the action makes no sense (no deal to move, no email address);
  carried out now; or turned into an approval. Under `ask_external` only `send_email` and
  `mark_deal` wait; under `suggest` everything waits; under `full` nothing does; `askFirst` on
  the agent makes all of its actions wait. A step with pending approvals shows as
  `waiting_approval` and the run as `needs_approval`.
- Limits: the workspace's monthly AI budget (at the limit runs wait and the owners are told once),
  `emailsPerLead`, the send window (an approved email outside it is sent when the window opens),
  the lead's own email address as the only recipient, and never an email to a lead marked
  unqualified or whose run was stopped.
- Emails go out through the documents server's `sendMail` (the workspace's own mailbox when one is
  connected, else the app's sender), with the same limits and delivery log.
- `create_project` builds the project from the workspace's `ProjectTemplate` the same way the
  app's own hand-off does (`src/services/supabase/crmHub/flow.ts`, `handoffDealToNewProject`):
  project, board columns, kick-off tasks for the project lead, the deal linked, the lead made a
  customer. The plan's project limit is respected.
- Everything an agent did is written to the CRM as usual (notes, follow-ups, activities) with the
  agent's name, so the lead's timeline shows it.
- Each run is claimed before it is worked on, so two cron calls never work the same run. A step
  that fails is retried on the next cron call, three times, then the run is `failed` with a plain
  reason and the owners are told.
- People are told through the app's own notifications: an approval is waiting, a run finished with
  a project, a run failed, the budget was reached.

### AI calls (Anthropic SDK, already a dependency)

- `@anthropic-ai/sdk` 1.11 and `zod` 3.25 are installed. Key: `ANTHROPIC_API_KEY` (the same one
  Draft with AI uses). See `api/_signroom/aiDraft.ts` for the house style of a call.
- Model `claude-opus-5-5` for every call. No `temperature`, no forced `tool_choice`, no prefill,
  no `budget_tokens`. `thinking: { type: "adaptive" }`. Set `output_config.effort` explicitly:
  `"low"` for agent steps, `"medium"` for the assistant.
- Structured replies: `client.beta.messages.parse({ …, betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default", output_config: { effort, format: zodOutputFormat(Schema) } })`
  with `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` (check the helper's exact export in
  `node_modules/@anthropic-ai/sdk/helpers/` and whether `beta.messages.parse` takes it; if the
  beta namespace has its own helper, use that one). `parsed_output` can be null: guard it. Check
  `stop_reason` (`refusal`, `max_tokens`) before reading anything.
- Web look-ups are a SEPARATE call before the agent's structured call (citations cannot be
  combined with a structured format): tool `{ type: "web_search_20260209", name: "web_search",
  max_uses: 3 }`, plain text answer, resend on `stop_reason: "pause_turn"` (at most 3 times). Only
  when the workspace allows it and the agent has `look_up_web`. Its findings are handed to the
  agent as data.
- One attempt per call (`maxRetries: 0`), a deadline, typed errors (`Anthropic.APIError`), and log
  only a status or an error name, never text. Record tokens and cost per call in `auto_usage`
  from `message.usage` and `message.model`.

## Screens

Routes (added to `src/App.tsx` by the coordinator): `/crm/automation` (overview),
`/crm/automation/assistant`, `/crm/automation/agents`, `/crm/automation/runs`,
`/crm/automation/runs/:id`, `/crm/automation/rules`. A new CRM tab "Automation".

Each screen follows its board (1 overview, 2 assistant, 3 agents, 4 one run, 5 workspace rules)
for content and wording, in TaskCalendar's own look (not the board's exact pixels).
