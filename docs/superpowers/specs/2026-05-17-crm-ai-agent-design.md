# CRM Batch 2d — AI Sales Agent (Design)

**Status:** Design accepted 2026-05-17. Implementation pending.

## A. Overview

An autonomous "AI Sales Agent" that watches the CRM for two signals and
produces drafted email outreach a human reviews before sending:

1. **Intake** — a new client/lead is created → enrich via Apollo →
   draft a personalized first-touch email.
2. **Re-engagement** — a deal has had no activity for
   `pipelines.stale_after_days` (default 14) → research what's changed →
   draft a re-engagement email tied to that signal.

Both paths converge on the same approval queue at a new top-level route
`/ai-agent`. Nothing is auto-sent: every suggestion requires human
approve / edit-and-send / reject / snooze.

### A.1 Goals
- Reduce time-to-first-touch on new leads from hours to seconds.
- Catch deals going stale before the salesperson would notice manually.
- Keep the human in the loop for tone, judgment, and brand voice.
- Stay within hard cost ceilings (Apollo credits + LLM tokens).

### A.2 Non-goals (this batch)
- Auto-sending without approval. (Could be a future opt-in setting; not now.)
- Multi-step agent loops with tool-use. (Single-shot LLM call per
  suggestion. Tool-using agents are a later batch.)
- Voice/SMS outreach. Email only.
- Agent acting on calendar / call scheduling.
- LinkedIn integration. Apollo gives us the LinkedIn URL but we don't
  scrape or post.

## B. Architecture

### B.1 Trigger paths

```
                 ┌──────────────────────┐
client_created ─▶│ events_queue (exist) │
                 └─────────┬────────────┘
                           │
                           ▼
                  ┌────────────────────┐
                  │ crm-run-automations│  (existing worker)
                  └─────────┬──────────┘
                            │ if recipe.trigger.type === "agent_intake"
                            ▼
                  ┌─────────────────────┐
                  │ ai-agent-suggest    │  (new Edge Function)
                  └─────────┬───────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ agent_suggestions  │
                  │  status='pending'  │
                  └────────────────────┘
                            ▲
                            │
                  ┌─────────┴───────────┐
                  │ ai-agent-suggest    │
                  └─────────────────────┘
                            ▲
                            │ enqueued by cron
                  ┌─────────┴───────────┐
                  │ crm-stuck-deal-scanner │ (new cron, daily 09:00 UTC)
                  └────────────────────────┘
```

The intake path piggybacks on the existing automations engine: a new
trigger type `agent_intake` fires `ai-agent-suggest` whenever
`client_created` arrives. The re-engagement path is a fresh nightly cron
worker that scans for stale deals.

We deliberately reuse the events_queue + recipe mechanism for intake
(not a new background worker) because:
- intake should fire immediately (the events queue drains every minute);
- it benefits from existing per-org RLS, retry, and run logging;
- users can disable it by toggling off the `agent_intake` recipe in
  Settings → Automations, same UI as everything else.

The re-engagement path can't piggyback because there is no inbound
event — it's a scan. So it's a separate cron.

### B.2 ai-agent-suggest function flow

```
input: { trigger_type: "intake" | "re_engagement",
         organization_id, client_id?, deal_id?, source_event_id? }

  1. Check daily caps for org (Apollo, LLM).
     If exceeded → insert agent_suggestion with status='cap_reached',
     rejected_note='apollo_cap'|'llm_cap', return.

  2. Load context:
     - if client_id: client row, recent 5 notes, recent 5 activities
     - if deal_id: deal row + its client, last 5 stage changes,
       last 5 notes, value, age in current stage

  3. Apollo enrichment:
     - lookup_key = client.email if present, else extract domain from
       email (substring after '@'), else skip enrichment entirely
       (proceed to step 4 with enrichment_snapshot=null)
     - Check apollo_lookups for fresh (≤30d) row → reuse
     - Else call Apollo /v1/people/match (email) or /v1/organizations/enrich
       (domain) → cache result → write to apollo_lookups
     - Increment ai_usage_events with kind='apollo_lookup', cost_credits=1
     - If Apollo returns 404 / no match → enrichment_snapshot = null,
       proceed to step 4 anyway

  4. LLM drafting (Sonnet 4.6, prompt caching):
     - System prompt: persona + brand voice + JSON output schema
     - User message: serialized context + enrichment_snapshot + trigger_type
     - Response_format: JSON
     - Expected output: { subject, body_text, body_html, confidence: 0..1,
       reasoning, suggested_next_stage_id?: uuid }
     - Increment ai_usage_events kind='agent_draft'

  5. Insert agent_suggestions row with all of the above + status='pending'.

  6. Insert notification (in-app + browser push if subscribed) to all
     org members with role in (owner, admin, member) — viewer excluded.
```

### B.3 crm-stuck-deal-scanner (new cron)

Runs daily at 09:00 UTC (configurable). Pseudocode:

```sql
-- For each org with the agent enabled:
SELECT d.deal_id, d.organization_id, d.pipeline_id, p.stale_after_days
FROM deals d
JOIN pipelines p ON p.pipeline_id = d.pipeline_id
WHERE d.status = 'open'
  AND d.stage NOT IN (won, lost)
  AND d.last_activity_at < now() - (p.stale_after_days || ' days')::interval
  AND NOT EXISTS (
    SELECT 1 FROM agent_suggestions s
    WHERE s.deal_id = d.deal_id
      AND s.status IN ('pending', 'snoozed')
  )
  AND NOT EXISTS (  -- don't suggest if already suggested in last 30d
    SELECT 1 FROM agent_suggestions s
    WHERE s.deal_id = d.deal_id
      AND s.decided_at > now() - interval '30 days'
  )
LIMIT 100;  -- per org per scan, hard cap to control burst
```

For each row, invoke `ai-agent-suggest` with
`trigger_type='re_engagement'`, `deal_id=...`.

### B.4 Apollo integration details

**Plan:** Basic ($49/mo) — ~500 credits/mo, ~$0.10/credit. Lookups beyond
plan = $0.10 each, hard-capped.

**Endpoints used:**
- `POST https://api.apollo.io/v1/people/match` — by email
- `POST https://api.apollo.io/v1/organizations/enrich` — by domain

**Fields extracted from response (stored in `enrichment_snapshot`):**
- `name`, `title`, `linkedin_url`
- `organization.name`, `organization.estimated_num_employees`,
  `organization.industry`, `organization.short_description`,
  `organization.website_url`, `organization.last_funding_round_amount`
- `city`, `state`, `country`

**Auth:** `X-Api-Key: <apollo_api_key>` env var
`APOLLO_API_KEY` (Supabase secret).

**Failure modes & handling:**
- 401 (bad key) → mark suggestion `status='failed'`, reason='apollo_auth';
  log; do NOT retry.
- 429 (rate limit) → respect `Retry-After`; if exceeded after one retry,
  proceed with enrichment_snapshot=null.
- 404 / empty match → proceed with enrichment_snapshot=null.
- 5xx → one retry with backoff; if still fails, proceed with null.

**Caching:** `apollo_lookups` row, keyed by SHA-256(lookup_key), 30-day
TTL. Re-reads do not count against the daily cap.

### B.5 LLM prompt design

System prompt (~600 tokens, cached via prompt caching):

```
You are an AI sales development representative for {org.name}. Your job
is to write short, personalized B2B outreach emails — never generic, never
salesy. You write the way a thoughtful human SDR would after 5 minutes of
research.

Brand voice: friendly, direct, no jargon, no superlatives, no emoji.

Your output MUST be valid JSON matching this schema:
{
  "subject": "string, <60 chars, no marketing words like 'amazing'",
  "body_text": "string, plaintext, 60-120 words, ends with one specific question",
  "body_html": "string, same content, simple HTML <p> wrapped",
  "confidence": "number 0-1, how strongly this lead matches our ICP",
  "reasoning": "string, 1-2 sentences explaining your draft choices for the human reviewer",
  "suggested_next_stage_id": "uuid or null"
}

Rules:
- Reference one specific detail from enrichment if available.
- Re-engagement emails: acknowledge time elapsed + reference a recent signal.
- Never invent facts. If enrichment is empty, write a shorter generic intro.
- No 'Hope this finds you well'. No 'Just checking in'.
```

User message (per call, not cached):

```
TRIGGER: {intake|re_engagement}

CLIENT/LEAD: {client_name}, {client_email}
COMPANY (from CRM): {client.company}

ENRICHMENT (from Apollo, may be null):
{json of enrichment_snapshot}

RECENT CRM ACTIVITY (last 5 events):
{bullet list}

{IF DEAL:}
DEAL: "{deal.title}", £{deal.value}, in stage "{stage.name}"
  for {days_in_stage} days, last activity {last_activity_at}
{ENDIF}

PIPELINE STAGES (for suggested_next_stage_id):
{json of stages with id+name}
```

**Model:** `claude-sonnet-4-6`, max_tokens=1024, temperature=0.5.

### B.6 Approval pipeline

When a user clicks **Approve & send** in the queue:

1. Frontend POSTs to `ai-agent-approve` Edge Function with suggestion_id +
   optional edited draft + send_now=true.
2. Function verifies user is org owner/admin/member (not viewer).
3. Function calls existing `sendEmail` action handler (from Batch 2c)
   with the draft fields. Reply-To rewriting still applies — replies
   create `sequence_replies` rows, agent's own follow-up is cancelled
   if a reply comes in.
4. Sets suggestion `status='sent'`, `decided_by=user`,
   `decided_at=now()`, `sent_message_id=<gmail_id>`.
5. Updates `client.last_outreach_at` / `deal.last_activity_at` so the
   stuck-deal scanner won't re-fire immediately.

**Edit & send:** same as Approve & send but with edited fields.

**Reject:** opens a modal with multi-select reason tags
(`generic`, `wrong_tone`, `bad_enrichment`, `not_a_lead`, `bad_timing`,
`other`), required free-text if 'other'. Sets `status='rejected'`,
stores reasons. Used for offline prompt tuning later.

**Snooze:** sets `snooze_until=now()+N days`, `status='snoozed'`.
A cron `crm-agent-snooze-revival` (runs hourly) flips `snoozed` →
`pending` when `snooze_until` passes.

**Auto-expire:** suggestions with `status='pending'` for >14d get
flipped to `status='expired'` by the same revival cron.

## C. Data model

### C.1 Migration 068_ai_agent.sql

```sql
-- agent_suggestions: one row per draft awaiting human action
create table public.agent_suggestions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(organization_id) on delete cascade,
  trigger_type    text not null check (trigger_type in ('intake','re_engagement')),
  client_id       uuid references clients(client_id) on delete cascade,
  deal_id         uuid references deals(deal_id) on delete cascade,
  source_event_id uuid references events_queue(id) on delete set null,
  draft           jsonb not null default '{}'::jsonb,
  enrichment_snapshot jsonb,
  confidence      numeric(4,3),
  reasoning       text,
  suggested_next_stage_id uuid references pipeline_stages(stage_id) on delete set null,
  status          text not null default 'pending' check (status in (
                    'pending','approved','sent','rejected','snoozed','expired',
                    'failed','cap_reached')),
  snooze_until    timestamptz,
  rejected_reasons text[],
  rejected_note   text,
  sent_message_id text,
  decided_by      uuid references users(user_id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (client_id is not null or deal_id is not null)
);

create index agent_suggestions_queue_idx
  on agent_suggestions (organization_id, status, created_at desc)
  where status in ('pending','snoozed');
create index agent_suggestions_revival_idx
  on agent_suggestions (snooze_until)
  where status = 'snoozed';
create index agent_suggestions_deal_idx
  on agent_suggestions (deal_id, decided_at desc)
  where deal_id is not null;

-- apollo_lookups: 30-day enrichment cache
create table public.apollo_lookups (
  lookup_key_hash text primary key,    -- sha256 of email or domain, hex
  lookup_key      text not null,       -- plaintext for debugging
  data            jsonb,               -- null = miss (so we don't re-pay)
  fetched_at      timestamptz not null default now()
);
create index apollo_lookups_ttl_idx on apollo_lookups (fetched_at);

-- pipelines: stale_after_days
alter table public.pipelines
  add column if not exists stale_after_days int not null default 14
  check (stale_after_days between 1 and 365);

-- organizations: agent toggle + caps
-- Default Apollo cap = 20/day ≈ 600/mo, matches Basic plan's ~500 credits
-- with cache hit-rate buffer. Owner can raise this if they upgrade.
alter table public.organizations
  add column if not exists ai_agent_enabled boolean not null default false,
  add column if not exists ai_agent_apollo_daily_cap int not null default 20,
  add column if not exists ai_agent_draft_daily_cap int not null default 50;

-- deals.last_activity_at: needed by stuck-deal scanner. Backfill from
-- updated_at if missing; existing triggers should already maintain it
-- but add for safety.
alter table public.deals
  add column if not exists last_activity_at timestamptz not null default now();
update public.deals
  set last_activity_at = updated_at
  where last_activity_at = created_at and updated_at is not null;

-- RLS
alter table public.agent_suggestions enable row level security;
create policy agent_suggestions_org_read on public.agent_suggestions
  for select using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));
create policy agent_suggestions_admin_write on public.agent_suggestions
  for update using (organization_id in (
    select organization_id from organization_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));
-- inserts only via service-role (Edge Function) — no client insert policy.

alter table public.apollo_lookups enable row level security;
-- service-role only; no SELECT policy = nothing visible to clients.

-- Snooze revival + auto-expire cron, runs hourly
create or replace function public.revive_agent_snoozes()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  revived int;
  expired int;
begin
  update agent_suggestions
     set status = 'pending', snooze_until = null
   where status = 'snoozed' and snooze_until <= now()
  returning 1 into revived;

  update agent_suggestions
     set status = 'expired'
   where status = 'pending'
     and created_at < now() - interval '14 days'
  returning 1 into expired;

  return coalesce(revived,0) + coalesce(expired,0);
end $$;
revoke all on function public.revive_agent_snoozes() from public;
grant execute on function public.revive_agent_snoozes() to service_role;
```

### C.2 ai_usage_events additions

Already exists from Batch 2b. New `kind` values used:
- `apollo_lookup` (cost_credits=1, cost_usd=null since it's bundled)
- `agent_draft` (cost_usd from Anthropic usage, model=claude-sonnet-4-6)

No schema change — the table already accepts arbitrary kind strings.

## D. Edge Functions

### D.1 `ai-agent-suggest` (new)
- Trigger: invoked by `crm-run-automations` (intake) or
  `crm-stuck-deal-scanner` (re-engagement) — service-role only,
  not user-facing.
- Performs the B.2 flow.
- Returns `{ suggestion_id, status }`.

### D.2 `ai-agent-approve` (new)
- Trigger: user-facing (JWT verified).
- Body: `{ suggestion_id, draft_override?: { subject, body_text, body_html }, action: "send"|"reject"|"snooze", snooze_days?: number, reject_reasons?: string[], reject_note?: string }`
- Verifies `agent_suggestions.organization_id` matches user's org;
  user has role !== 'viewer'.
- For `send`: calls a shared Gmail send helper that we extract from
  Batch 2c's `actions/sendEmail.ts` into a new
  `_shared/gmailSend.ts` (so both the recipe action handler and this
  function can call it without faking an ActionContext). The shared
  helper takes (admin, organization_id, sender_user_id, to, subject,
  body_text, body_html, reply_to_token?) → returns gmail message_id.
- For `reject` / `snooze`: updates the row.

### D.3 `crm-stuck-deal-scanner` (new cron)
- Schedule: `0 9 * * *` UTC.
- Implements B.3 query, dispatches `ai-agent-suggest`.

### D.4 `crm-agent-snooze-revival` (new cron)
- Schedule: `0 * * * *` (hourly).
- Calls `revive_agent_snoozes()` RPC.

## E. UI

### E.1 New route `/ai-agent`

Sidebar item between "Forecast" and "Settings", icon `Bot` (lucide).
Sidebar shows red dot with pending count when > 0 (polled via the same
realtime subscription as other counts; cap displayed at "99+").

### E.2 Tabs

**Queue tab (default):**
- Sort: confidence desc, then created_at asc (oldest high-confidence first).
- Filter chips: All / Intake / Re-engagement / No enrichment.
- Card layout, one per suggestion:
  ```
  ┌────────────────────────────────────────────────────────┐
  │ ●● 0.87  Acme Corp · Jane Doe                          │
  │ Intake · CMO at 230-employee SaaS · Series B Aug 2025  │
  │                                                        │
  │ Subject: Quick question about Acme's Q3 hiring         │
  │ "Saw the Series B news…" (expandable)                  │
  │                                                        │
  │ [Approve & send] [Edit] [Reject ▾] [Snooze ▾]          │
  └────────────────────────────────────────────────────────┘
  ```
- Empty state: "No suggestions right now — the agent's watching."

**Activity tab:**
- Chronological log: timestamp, suggestion preview, outcome
  (sent / rejected / expired), decided_by user avatar.
- 7-day default range, range picker for older.

**Settings tab (admin only):**
- Master "Enable AI Sales Agent" toggle.
- Per-pipeline `stale_after_days` slider (1–365, default 14).
- Daily Apollo cap (int, default 20 — matches Basic plan).
- Daily LLM draft cap (int, default 50).
- "Apollo credits used this month": pulled from `ai_usage_events`.

### E.3 Edit modal

Reuses the existing rich text editor (already in the codebase for the
add-note flow). Three fields: subject (input), body (rich text). On
save, sends.

## F. Permissions

| Role    | View queue | Approve | Reject | Edit settings |
|---------|-----------|---------|--------|---------------|
| owner   | ✓ | ✓ | ✓ | ✓ |
| admin   | ✓ | ✓ | ✓ | ✓ |
| member  | ✓ | ✓ | ✓ | — |
| viewer  | ✓ (read-only) | — | — | — |

Enforced by RLS (read) + `ai-agent-approve` checks (write).

## G. Testing

### G.1 Unit tests (vitest)
- `agentSuggest.test.ts` — drafting prompt assembly, JSON parse,
  enrichment-null fallback.
- `stuckDealScan.test.ts` — query produces expected rows given fixtures
  (uses sql.js or pg-mem).
- `apolloCache.test.ts` — cache hit/miss, TTL expiry.
- `agentApproveAuth.test.ts` — non-org user gets 403, viewer gets 403,
  member succeeds.

Target: 12 new tests, pushing total to ~83.

### G.2 Manual acceptance
1. Enable agent in Settings, set Apollo + LLM caps to 5 each (low).
2. Create a new client with `jane@acme.com` → within 90s, suggestion
   appears in queue with Apollo enrichment + confidence + draft.
3. Edit subject, click Send → email arrives at jane@acme.com via Gmail.
4. Hit Reply → within 90s, `sequence_replies` row exists and the
   suggestion's deal record gets a note "reply received".
5. Move a test deal's `last_activity_at` to 30 days ago → trigger the
   cron manually via `supabase functions invoke crm-stuck-deal-scanner`
   → suggestion appears with re_engagement trigger.
6. Exhaust the daily cap by submitting 6 leads → 6th suggestion lands
   with `status='cap_reached'`.
7. Snooze a suggestion 1d, set DB clock-forward, run revival cron →
   reappears in queue.

## H. Rollout

1. Deploy migration 068 (DB-only change, safe — additive).
2. Deploy `ai-agent-suggest` + `ai-agent-approve` Edge Functions.
3. Deploy crons (`crm-stuck-deal-scanner`, `crm-agent-snooze-revival`).
4. Frontend deploy (new route, sidebar, settings UI).
5. **Off by default** (`organizations.ai_agent_enabled=false`). Each
   org owner opts in via Settings → AI Agent.
6. Anthropic key: already set from Batch 2b. Only new secret needed:
   `APOLLO_API_KEY`.

## I. Open questions / future

- **Lead scoring integration:** existing batch-1 lead score could feed
  the prompt to bias draft tone. Not in this batch.
- **Per-user prompt overrides:** each SDR has their own voice. Not
  this batch — global org persona only.
- **A/B testing subject lines:** approve-rate by prompt variant. Not
  this batch.
- **Auto-send when confidence > 0.95:** explicit non-goal for v1.
- **Multi-step agent (research → enrich → draft → schedule → follow-up):**
  this batch is single-shot. The architecture supports adding a planner
  later — suggestion can become a "plan" with multiple drafts.
