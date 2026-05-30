# AI Sales Agent (Batch 2d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI Sales Agent that watches two CRM signals (new lead intake, stuck deals) and produces drafted outreach emails for human approval, never auto-sending.

**Architecture:** New `agent_suggestions` table feeds a dedicated `/ai-agent` queue page. Two writers populate it: the existing automations engine (intake via new trigger type) and a new nightly cron (re-engagement). Both call a shared `ai-agent-suggest` Edge Function which enriches via Apollo, drafts via Claude Sonnet 4.6, and inserts a pending suggestion. A separate `ai-agent-approve` function handles send/reject/snooze. The Gmail send path is extracted from Batch 2c's `sendEmail` action into a shared helper so it's callable outside an ActionContext.

**Tech Stack:** Supabase Postgres (migration 068, RLS, PL/pgSQL revival), Supabase Edge Functions (Deno + Anthropic SDK + Apollo REST), React 18 + Vite + TypeScript, shadcn/ui, vitest.

**User constraints in effect:**
- Do NOT run `npx supabase migration up`, `db push`, or any DB / deploy command. The user runs migrations and deploys themselves.
- Skip formal reviewer ceremony for mechanical paste-from-plan tasks (the user has calibrated this in prior batches).
- Do not modify files in the integrations lane: `src/components/integrations/**`, `src/services/integrations/**`, `src/hooks/useIntegration.ts`, `oauth-*` / `integrations-*` Edge Functions, migration `057_integrations_tables.sql` — another agent owns those.

---

## Task 1: Migration 068 — agent_suggestions, apollo_lookups, pipeline + org columns, revival RPC

**Files:**
- Create: `supabase/migrations/068_ai_agent.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/068_ai_agent.sql
-- Batch 2d: AI Sales Agent — suggestions, Apollo cache, pipeline staleness,
-- org-level enablement, snooze/expire revival RPC.

begin;

-- ============================================================
-- agent_suggestions: one row per draft awaiting human action
-- ============================================================
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
create index agent_suggestions_expire_idx
  on agent_suggestions (created_at)
  where status = 'pending';

-- ============================================================
-- apollo_lookups: 30-day enrichment cache
-- ============================================================
create table public.apollo_lookups (
  lookup_key_hash text primary key,
  lookup_key      text not null,
  data            jsonb,
  fetched_at      timestamptz not null default now()
);
create index apollo_lookups_ttl_idx on apollo_lookups (fetched_at);

-- ============================================================
-- pipelines.stale_after_days
-- ============================================================
alter table public.pipelines
  add column if not exists stale_after_days int not null default 14
  check (stale_after_days between 1 and 365);

-- ============================================================
-- organizations: agent toggle + per-day caps
-- ============================================================
alter table public.organizations
  add column if not exists ai_agent_enabled boolean not null default false,
  add column if not exists ai_agent_apollo_daily_cap int not null default 20,
  add column if not exists ai_agent_draft_daily_cap int not null default 50;

-- ============================================================
-- deals.last_activity_at: needed by stuck-deal scanner.
-- Backfill from updated_at if missing.
-- ============================================================
alter table public.deals
  add column if not exists last_activity_at timestamptz not null default now();
update public.deals
   set last_activity_at = updated_at
 where updated_at is not null
   and last_activity_at = created_at;

-- ============================================================
-- RLS
-- ============================================================
alter table public.agent_suggestions enable row level security;

create policy agent_suggestions_org_read on public.agent_suggestions
  for select using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));

create policy agent_suggestions_member_write on public.agent_suggestions
  for update using (organization_id in (
    select organization_id from organization_members
    where user_id = auth.uid() and role in ('owner','admin','member')
  ));

-- No insert policy: rows only created by service-role (Edge Function).

alter table public.apollo_lookups enable row level security;
-- No SELECT/INSERT policy => only service-role can touch this cache.

-- ============================================================
-- revive_agent_snoozes(): hourly cron flips snoozed→pending and
-- expires pending suggestions older than 14d.
-- ============================================================
create or replace function public.revive_agent_snoozes()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  revived_count int := 0;
  expired_count int := 0;
begin
  with revived as (
    update agent_suggestions
       set status = 'pending', snooze_until = null
     where status = 'snoozed' and snooze_until <= now()
    returning 1
  )
  select count(*) into revived_count from revived;

  with expired as (
    update agent_suggestions
       set status = 'expired'
     where status = 'pending'
       and created_at < now() - interval '14 days'
    returning 1
  )
  select count(*) into expired_count from expired;

  return revived_count + expired_count;
end
$$;

revoke all on function public.revive_agent_snoozes() from public;
grant execute on function public.revive_agent_snoozes() to service_role;

commit;
```

- [ ] **Step 2: Commit (DO NOT run db push — user does that themselves)**

```bash
git checkout -b feature/crm-ai-agent
git add supabase/migrations/068_ai_agent.sql
git commit -m "feat(crm): migration 068 — agent_suggestions + apollo_lookups + revival RPC"
```

---

## Task 2: Extract shared Gmail send helper

**Files:**
- Create: `supabase/functions/_shared/gmailSend.ts`
- Modify: `supabase/functions/crm-run-automations/actions/sendEmail.ts`

The Batch 2c `sendEmail` action handler does all Gmail work inline against an `ActionContext`. Task 5 (`ai-agent-approve`) needs to send a one-off email without faking a context, so we extract the Gmail-specific code into a pure helper.

- [ ] **Step 1: Read the current sendEmail.ts to understand the Gmail call shape**

Open `supabase/functions/crm-run-automations/actions/sendEmail.ts`. Identify the block that:
1. Loads the integration row by `user_id + provider='gmail' + status='active'`
2. Decrypts the access_token via `_shared/crypto.ts`
3. Builds the MIME multipart/alternative body and base64url-encodes it
4. POSTs to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`

- [ ] **Step 2: Write the shared helper**

```ts
// supabase/functions/_shared/gmailSend.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "./crypto.ts";

const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY") ?? "";

export interface GmailSendArgs {
  admin: SupabaseClient;
  organizationId: string;
  senderUserId: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  replyToToken?: string;
  inboundDomain?: string;
}

export interface GmailSendResult {
  messageId: string;
  threadId: string;
}

const base64Url = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const buildRawMessage = (a: GmailSendArgs, senderEmail: string): string => {
  const boundary = "----tc" + crypto.randomUUID().replace(/-/g, "");
  const replyTo = a.replyToToken && a.inboundDomain
    ? `reply+${a.replyToToken}@${a.inboundDomain}`
    : senderEmail;
  const lines = [
    `From: ${senderEmail}`,
    `To: ${a.to}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${a.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    a.bodyText,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    a.bodyHtml,
    ``,
    `--${boundary}--`,
    ``,
  ];
  return base64Url(lines.join("\r\n"));
};

export const sendViaGmail = async (a: GmailSendArgs): Promise<GmailSendResult> => {
  if (!TOKEN_KEY) throw new Error("INTEGRATION_TOKEN_KEY not configured");

  const { data: integ, error } = await a.admin
    .from("integrations")
    .select("encrypted_access_token, account_email")
    .eq("user_id", a.senderUserId)
    .eq("organization_id", a.organizationId)
    .eq("provider", "gmail")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`gmail integration lookup failed: ${error.message}`);
  if (!integ) throw new Error(`no active gmail integration for user ${a.senderUserId}`);

  const accessToken = await decrypt(integ.encrypted_access_token, TOKEN_KEY);
  const senderEmail = integ.account_email ?? "noreply@unknown";

  const raw = buildRawMessage(a, senderEmail);
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gmail send failed ${res.status}: ${t}`);
  }
  const json = await res.json() as { id: string; threadId: string };
  return { messageId: json.id, threadId: json.threadId };
};
```

- [ ] **Step 3: Refactor sendEmail.ts to call the helper**

Replace the Gmail block (steps 2–4 from Step 1's audit) with a single `await sendViaGmail({...})` call. Keep the integration-resolution + reply-to-token logic from Batch 2c. The action handler's signature and ActionResult return shape do NOT change — only the internal Gmail call moves.

- [ ] **Step 4: Run existing tests to confirm no behavior drift**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: 71 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/gmailSend.ts \
        supabase/functions/crm-run-automations/actions/sendEmail.ts
git commit -m "refactor(crm): extract gmail send into _shared/gmailSend.ts (preps AI agent)"
```

---

## Task 3: Apollo client + cache helper

**Files:**
- Create: `supabase/functions/_shared/apollo.ts`
- Create: `tests/unit/apolloCache.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/apolloCache.test.ts
import { describe, it, expect } from "vitest";
import { hashLookupKey, isCacheFresh } from "@/supabase-functions/_shared/apollo";

describe("apolloCache", () => {
  it("hashLookupKey returns hex sha256 (lowercased)", async () => {
    const h = await hashLookupKey("jane@acme.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await hashLookupKey("JANE@acme.com"));
  });

  it("isCacheFresh returns true for rows fetched within 30 days", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(recent)).toBe(true);
  });

  it("isCacheFresh returns false for rows older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(old)).toBe(false);
  });

  it("isCacheFresh returns false for nullish input", () => {
    expect(isCacheFresh(null)).toBe(false);
    expect(isCacheFresh(undefined as unknown as string)).toBe(false);
  });
});
```

Add path alias to `vitest.config.ts` if not already present:

```ts
resolve: {
  alias: {
    "@/supabase-functions": path.resolve(__dirname, "./supabase/functions"),
    // ...existing aliases
  },
},
```

- [ ] **Step 2: Run tests — verify fail**

```bash
npx vitest run tests/unit/apolloCache.test.ts
```

Expected: 4 failures ("Cannot find module").

- [ ] **Step 3: Implement the helper**

```ts
// supabase/functions/_shared/apollo.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY") ?? "";
const APOLLO_BASE = "https://api.apollo.io/v1";
const CACHE_TTL_DAYS = 30;

export const hashLookupKey = async (raw: string): Promise<string> => {
  const normalized = raw.trim().toLowerCase();
  const buf = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const isCacheFresh = (fetchedAt: string | null | undefined): boolean => {
  if (!fetchedAt) return false;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
};

export interface EnrichmentSnapshot {
  name?: string;
  title?: string;
  linkedinUrl?: string;
  organization?: {
    name?: string;
    employees?: number;
    industry?: string;
    description?: string;
    websiteUrl?: string;
    lastFundingAmount?: number;
  };
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

const mapPersonResponse = (j: Record<string, unknown>): EnrichmentSnapshot => {
  const person = (j.person ?? j) as Record<string, unknown>;
  const org = (person.organization ?? {}) as Record<string, unknown>;
  return {
    name: person.name as string | undefined,
    title: person.title as string | undefined,
    linkedinUrl: person.linkedin_url as string | undefined,
    organization: {
      name: org.name as string | undefined,
      employees: org.estimated_num_employees as number | undefined,
      industry: org.industry as string | undefined,
      description: org.short_description as string | undefined,
      websiteUrl: org.website_url as string | undefined,
      lastFundingAmount: org.last_funding_round_amount as number | undefined,
    },
    location: {
      city: person.city as string | undefined,
      state: person.state as string | undefined,
      country: person.country as string | undefined,
    },
  };
};

const fetchFromApollo = async (
  email: string | null,
  domain: string | null,
): Promise<EnrichmentSnapshot | null> => {
  if (!APOLLO_API_KEY) return null;
  const endpoint = email
    ? `${APOLLO_BASE}/people/match`
    : `${APOLLO_BASE}/organizations/enrich`;
  const body = email ? { email } : { domain };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "X-Api-Key": APOLLO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 200) {
      return mapPersonResponse(await res.json());
    }
    if (res.status === 404) return null;
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "2");
      await new Promise((r) => setTimeout(r, Math.min(retry, 5) * 1000));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    return null; // 401 / 403 / 4xx
  }
  return null;
};

export interface EnrichArgs {
  admin: SupabaseClient;
  email?: string | null;
  domain?: string | null;
}

export interface EnrichResult {
  snapshot: EnrichmentSnapshot | null;
  cacheHit: boolean;
}

export const enrich = async (a: EnrichArgs): Promise<EnrichResult> => {
  const lookupKey = a.email ?? a.domain ?? null;
  if (!lookupKey) return { snapshot: null, cacheHit: false };

  const hash = await hashLookupKey(lookupKey);
  const { data: cached } = await a.admin
    .from("apollo_lookups")
    .select("data, fetched_at")
    .eq("lookup_key_hash", hash)
    .maybeSingle();

  if (cached && isCacheFresh(cached.fetched_at as string)) {
    return {
      snapshot: cached.data as EnrichmentSnapshot | null,
      cacheHit: true,
    };
  }

  const snapshot = await fetchFromApollo(a.email ?? null, a.domain ?? null);

  await a.admin.from("apollo_lookups").upsert({
    lookup_key_hash: hash,
    lookup_key: lookupKey,
    data: snapshot,
    fetched_at: new Date().toISOString(),
  });

  return { snapshot, cacheHit: false };
};
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/unit/apolloCache.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/apollo.ts \
        tests/unit/apolloCache.test.ts \
        vitest.config.ts
git commit -m "feat(crm): Apollo enrichment helper with 30-day cache + sha256 keys"
```

---

## Task 4: `ai-agent-suggest` Edge Function

**Files:**
- Create: `supabase/functions/ai-agent-suggest/index.ts`
- Create: `supabase/functions/ai-agent-suggest/draftPrompt.ts`
- Create: `tests/unit/agentDraftPrompt.test.ts`

- [ ] **Step 1: Write the failing prompt-assembly tests**

```ts
// tests/unit/agentDraftPrompt.test.ts
import { describe, it, expect } from "vitest";
import { buildUserMessage } from "@/supabase-functions/ai-agent-suggest/draftPrompt";

describe("agentDraftPrompt.buildUserMessage", () => {
  it("includes all client fields for intake trigger", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane Doe", email: "jane@acme.com", company: "Acme" },
      deal: null,
      enrichment: null,
      recentActivity: [],
      stages: [],
    });
    expect(msg).toContain("TRIGGER: intake");
    expect(msg).toContain("Jane Doe");
    expect(msg).toContain("jane@acme.com");
    expect(msg).toContain("Acme");
  });

  it("renders enrichment as JSON block when present", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: { title: "CMO", organization: { name: "Acme", employees: 200 } },
      recentActivity: [],
      stages: [],
    });
    expect(msg).toContain('"title": "CMO"');
    expect(msg).toContain('"employees": 200');
  });

  it("emits 'null' enrichment block when absent", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: null,
      recentActivity: [],
      stages: [],
    });
    expect(msg).toMatch(/ENRICHMENT[^\n]*\n\s*null/);
  });

  it("includes deal block + days_in_stage for re_engagement", () => {
    const msg = buildUserMessage({
      triggerType: "re_engagement",
      client: { name: "Jane", email: "j@a.com", company: "Acme" },
      deal: {
        title: "Acme Pro",
        value: 25000,
        stageName: "Negotiation",
        daysInStage: 21,
        lastActivityAt: "2026-04-26T00:00:00Z",
      },
      enrichment: null,
      recentActivity: [],
      stages: [{ stageId: "s-1", name: "Closed Won" }],
    });
    expect(msg).toContain("DEAL: \"Acme Pro\"");
    expect(msg).toContain("£25000");
    expect(msg).toContain("21 days");
    expect(msg).toContain('"stageId": "s-1"');
  });

  it("formats recent activity bullets", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: null,
      recentActivity: ["Stage moved to Discovery", "Note added: budget approved"],
      stages: [],
    });
    expect(msg).toContain("- Stage moved to Discovery");
    expect(msg).toContain("- Note added: budget approved");
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run tests/unit/agentDraftPrompt.test.ts
```

Expected: 5 failures.

- [ ] **Step 3: Implement `draftPrompt.ts`**

```ts
// supabase/functions/ai-agent-suggest/draftPrompt.ts
export const SYSTEM_PROMPT = `You are an AI sales development representative.
Your job is to write short, personalized B2B outreach emails — never
generic, never salesy. You write the way a thoughtful human SDR would
after 5 minutes of research.

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
- No 'Hope this finds you well'. No 'Just checking in'.`;

export interface ClientFacts {
  name: string;
  email: string;
  company: string | null;
}

export interface DealFacts {
  title: string;
  value: number;
  stageName: string;
  daysInStage: number;
  lastActivityAt: string;
}

export interface StageRef {
  stageId: string;
  name: string;
}

export interface BuildUserMessageArgs {
  triggerType: "intake" | "re_engagement";
  client: ClientFacts;
  deal: DealFacts | null;
  enrichment: Record<string, unknown> | null;
  recentActivity: string[];
  stages: StageRef[];
}

export const buildUserMessage = (a: BuildUserMessageArgs): string => {
  const parts: string[] = [];
  parts.push(`TRIGGER: ${a.triggerType}`);
  parts.push("");
  parts.push(`CLIENT/LEAD: ${a.client.name}, ${a.client.email}`);
  parts.push(`COMPANY (from CRM): ${a.client.company ?? "(unknown)"}`);
  parts.push("");
  parts.push("ENRICHMENT (from Apollo, may be null):");
  parts.push(a.enrichment ? JSON.stringify(a.enrichment, null, 2) : "null");
  parts.push("");
  parts.push("RECENT CRM ACTIVITY (last 5 events):");
  if (a.recentActivity.length === 0) parts.push("(none)");
  else for (const e of a.recentActivity) parts.push(`- ${e}`);
  parts.push("");
  if (a.deal) {
    parts.push(
      `DEAL: "${a.deal.title}", £${a.deal.value}, in stage "${a.deal.stageName}" ` +
      `for ${a.deal.daysInStage} days, last activity ${a.deal.lastActivityAt}`,
    );
    parts.push("");
  }
  parts.push("PIPELINE STAGES (for suggested_next_stage_id):");
  parts.push(JSON.stringify(a.stages, null, 2));
  return parts.join("\n");
};
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/unit/agentDraftPrompt.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Implement the function entrypoint**

```ts
// supabase/functions/ai-agent-suggest/index.ts
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.1";
import { enrich, EnrichmentSnapshot } from "../_shared/apollo.ts";
import { SYSTEM_PROMPT, buildUserMessage, ClientFacts, DealFacts, StageRef } from "./draftPrompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

interface SuggestRequest {
  trigger_type: "intake" | "re_engagement";
  organization_id: string;
  client_id?: string;
  deal_id?: string;
  source_event_id?: string;
}

const checkDailyCap = async (
  admin: SupabaseClient,
  orgId: string,
  kind: "apollo_lookup" | "agent_draft",
  cap: number,
): Promise<boolean> => {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("kind", kind)
    .gte("created_at", todayStart.toISOString());
  return (count ?? 0) < cap;
};

const insertCapReached = async (
  admin: SupabaseClient,
  body: SuggestRequest,
  note: string,
): Promise<string> => {
  const { data, error } = await admin.from("agent_suggestions").insert({
    organization_id: body.organization_id,
    trigger_type: body.trigger_type,
    client_id: body.client_id ?? null,
    deal_id: body.deal_id ?? null,
    source_event_id: body.source_event_id ?? null,
    status: "cap_reached",
    rejected_note: note,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
};

const loadContext = async (admin: SupabaseClient, body: SuggestRequest) => {
  let client: ClientFacts = { name: "", email: "", company: null };
  let deal: DealFacts | null = null;
  const recentActivity: string[] = [];

  if (body.deal_id) {
    const { data: d } = await admin.from("deals")
      .select("title, value, current_stage_id, last_activity_at, client_id")
      .eq("deal_id", body.deal_id).maybeSingle();
    if (d) {
      const { data: s } = await admin.from("pipeline_stages")
        .select("name").eq("stage_id", d.current_stage_id).maybeSingle();
      const days = Math.floor(
        (Date.now() - new Date(d.last_activity_at as string).getTime()) / (24 * 3600 * 1000),
      );
      deal = {
        title: d.title as string,
        value: Number(d.value ?? 0),
        stageName: (s?.name as string) ?? "(unknown)",
        daysInStage: days,
        lastActivityAt: d.last_activity_at as string,
      };
      if (!body.client_id && d.client_id) body.client_id = d.client_id as string;
    }
  }

  if (body.client_id) {
    const { data: c } = await admin.from("clients")
      .select("name, email, company").eq("client_id", body.client_id).maybeSingle();
    if (c) {
      client = {
        name: (c.name as string) ?? "",
        email: (c.email as string) ?? "",
        company: (c.company as string) ?? null,
      };
    }

    const { data: notes } = await admin.from("client_notes")
      .select("body").eq("client_id", body.client_id)
      .order("created_at", { ascending: false }).limit(5);
    for (const n of notes ?? []) {
      recentActivity.push(`Note: ${String(n.body).slice(0, 120)}`);
    }
  }

  return { client, deal, recentActivity };
};

const loadStages = async (admin: SupabaseClient, orgId: string): Promise<StageRef[]> => {
  const { data } = await admin.from("pipeline_stages")
    .select("stage_id, name, pipeline_id, pipelines!inner(organization_id)")
    .eq("pipelines.organization_id", orgId);
  return (data ?? []).map((r) => ({ stageId: r.stage_id as string, name: r.name as string }));
};

const callLlm = async (system: string, user: string): Promise<Record<string, unknown>> => {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.5,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM did not return JSON");
  return JSON.parse(jsonMatch[0]);
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await req.json() as SuggestRequest;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: org } = await admin.from("organizations")
    .select("ai_agent_enabled, ai_agent_apollo_daily_cap, ai_agent_draft_daily_cap")
    .eq("organization_id", body.organization_id).maybeSingle();
  if (!org || !org.ai_agent_enabled) {
    return new Response(JSON.stringify({ skipped: "agent disabled" }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (!await checkDailyCap(admin, body.organization_id, "apollo_lookup", org.ai_agent_apollo_daily_cap as number)) {
    const id = await insertCapReached(admin, body, "apollo_cap");
    return new Response(JSON.stringify({ suggestion_id: id, status: "cap_reached" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const { client, deal, recentActivity } = await loadContext(admin, body);
  const email = client.email;
  const domain = email.includes("@") ? email.split("@")[1] : null;

  let enrichment: EnrichmentSnapshot | null = null;
  let cacheHit = false;
  try {
    const r = await enrich({ admin, email: email || null, domain });
    enrichment = r.snapshot;
    cacheHit = r.cacheHit;
  } catch (e) {
    console.error("apollo enrich failed:", e);
  }
  if (!cacheHit) {
    await admin.from("ai_usage_events").insert({
      organization_id: body.organization_id,
      kind: "apollo_lookup",
      cost_credits: 1,
    });
  }

  if (!await checkDailyCap(admin, body.organization_id, "agent_draft", org.ai_agent_draft_daily_cap as number)) {
    const id = await insertCapReached(admin, body, "llm_cap");
    return new Response(JSON.stringify({ suggestion_id: id, status: "cap_reached" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const stages = await loadStages(admin, body.organization_id);
  const userMsg = buildUserMessage({
    triggerType: body.trigger_type,
    client, deal,
    enrichment: enrichment as Record<string, unknown> | null,
    recentActivity, stages,
  });

  let draft: Record<string, unknown>;
  try {
    draft = await callLlm(SYSTEM_PROMPT, userMsg);
  } catch (e) {
    const { data } = await admin.from("agent_suggestions").insert({
      organization_id: body.organization_id,
      trigger_type: body.trigger_type,
      client_id: body.client_id ?? null,
      deal_id: body.deal_id ?? null,
      status: "failed",
      rejected_note: `llm_error: ${(e as Error).message}`,
    }).select("id").single();
    return new Response(JSON.stringify({ suggestion_id: data?.id, status: "failed" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  await admin.from("ai_usage_events").insert({
    organization_id: body.organization_id,
    kind: "agent_draft",
    model: MODEL,
  });

  const { data: row, error } = await admin.from("agent_suggestions").insert({
    organization_id: body.organization_id,
    trigger_type: body.trigger_type,
    client_id: body.client_id ?? null,
    deal_id: body.deal_id ?? null,
    source_event_id: body.source_event_id ?? null,
    draft,
    enrichment_snapshot: enrichment,
    confidence: typeof draft.confidence === "number" ? draft.confidence : null,
    reasoning: (draft.reasoning as string) ?? null,
    suggested_next_stage_id: (draft.suggested_next_stage_id as string) ?? null,
    status: "pending",
  }).select("id").single();
  if (error) throw error;

  return new Response(JSON.stringify({ suggestion_id: row.id, status: "pending" }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 6: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ai-agent-suggest/ \
        tests/unit/agentDraftPrompt.test.ts
git commit -m "feat(crm): ai-agent-suggest Edge Function — enrich + LLM draft + cap/cache"
```

---

## Task 5: `ai-agent-approve` Edge Function

**Files:**
- Create: `supabase/functions/ai-agent-approve/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/ai-agent-approve/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaGmail } from "../_shared/gmailSend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INBOUND_DOMAIN = Deno.env.get("SEQUENCE_INBOUND_DOMAIN") ?? "";

interface ApproveRequest {
  suggestion_id: string;
  action: "send" | "reject" | "snooze";
  draft_override?: { subject?: string; body_text?: string; body_html?: string };
  snooze_days?: number;
  reject_reasons?: string[];
  reject_note?: string;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const user = createClient(SUPABASE_URL, authHeader.slice(7), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userInfo, error: userErr } = await user.auth.getUser();
  if (userErr || !userInfo.user) return json({ error: "unauthorized" }, 401);
  const userId = userInfo.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json() as ApproveRequest;
  const { data: sug, error: sugErr } = await admin.from("agent_suggestions")
    .select("*").eq("id", body.suggestion_id).maybeSingle();
  if (sugErr || !sug) return json({ error: "not_found" }, 404);

  const { data: member } = await admin.from("organization_members")
    .select("role").eq("user_id", userId)
    .eq("organization_id", sug.organization_id).maybeSingle();
  if (!member || member.role === "viewer") return json({ error: "forbidden" }, 403);

  if (body.action === "snooze") {
    const days = Math.max(1, Math.min(30, body.snooze_days ?? 1));
    const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    await admin.from("agent_suggestions").update({
      status: "snoozed", snooze_until: until,
      decided_by: userId, decided_at: new Date().toISOString(),
    }).eq("id", sug.id);
    return json({ ok: true, status: "snoozed", until });
  }

  if (body.action === "reject") {
    await admin.from("agent_suggestions").update({
      status: "rejected",
      rejected_reasons: body.reject_reasons ?? null,
      rejected_note: body.reject_note ?? null,
      decided_by: userId, decided_at: new Date().toISOString(),
    }).eq("id", sug.id);
    return json({ ok: true, status: "rejected" });
  }

  // action === "send"
  const draft = { ...(sug.draft ?? {}), ...(body.draft_override ?? {}) } as Record<string, string>;
  if (!draft.subject || !draft.body_text || !draft.body_html) {
    return json({ error: "draft_incomplete" }, 400);
  }

  const { data: client } = await admin.from("clients")
    .select("email").eq("client_id", sug.client_id).maybeSingle();
  if (!client?.email) return json({ error: "no_recipient" }, 400);

  let messageId = "";
  try {
    const r = await sendViaGmail({
      admin,
      organizationId: sug.organization_id,
      senderUserId: userId,
      to: client.email as string,
      subject: draft.subject,
      bodyText: draft.body_text,
      bodyHtml: draft.body_html,
      replyToToken: sug.id,
      inboundDomain: INBOUND_DOMAIN,
    });
    messageId = r.messageId;
  } catch (e) {
    return json({ error: "send_failed", message: (e as Error).message }, 502);
  }

  await admin.from("agent_suggestions").update({
    status: "sent",
    draft,
    sent_message_id: messageId,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  }).eq("id", sug.id);

  if (sug.client_id) {
    await admin.from("clients")
      .update({ last_outreach_at: new Date().toISOString() })
      .eq("client_id", sug.client_id);
  }
  if (sug.deal_id) {
    await admin.from("deals")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("deal_id", sug.deal_id);
  }

  return json({ ok: true, status: "sent", message_id: messageId });
});
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-agent-approve/
git commit -m "feat(crm): ai-agent-approve Edge Function — send/reject/snooze with role gate"
```

---

## Task 6: `crm-stuck-deal-scanner` cron Edge Function

**Files:**
- Create: `supabase/functions/crm-stuck-deal-scanner/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/crm-stuck-deal-scanner/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PER_ORG_LIMIT = 100;

interface StaleDealRow {
  deal_id: string;
  organization_id: string;
}

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orgs } = await admin.from("organizations")
    .select("organization_id").eq("ai_agent_enabled", true);

  const summary: Record<string, number> = {};

  for (const org of orgs ?? []) {
    const orgId = org.organization_id as string;
    const { data: stale } = await admin.rpc("find_stale_deals", {
      p_organization_id: orgId, p_limit: PER_ORG_LIMIT,
    });

    summary[orgId] = (stale ?? []).length;

    for (const row of (stale ?? []) as StaleDealRow[]) {
      await fetch(`${SUPABASE_URL}/functions/v1/ai-agent-suggest`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trigger_type: "re_engagement",
          organization_id: row.organization_id,
          deal_id: row.deal_id,
        }),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, dispatched: summary }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Add `find_stale_deals` RPC to migration 068**

Append to `supabase/migrations/068_ai_agent.sql` before the final `commit;`:

```sql
create or replace function public.find_stale_deals(
  p_organization_id uuid,
  p_limit int default 100
) returns table (deal_id uuid, organization_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select d.deal_id, d.organization_id
    from deals d
    join pipelines p on p.pipeline_id = d.pipeline_id
   where d.organization_id = p_organization_id
     and d.status = 'open'
     and d.last_activity_at < now() - (p.stale_after_days || ' days')::interval
     and not exists (
       select 1 from agent_suggestions s
        where s.deal_id = d.deal_id
          and s.status in ('pending','snoozed')
     )
     and not exists (
       select 1 from agent_suggestions s
        where s.deal_id = d.deal_id
          and s.decided_at > now() - interval '30 days'
     )
   limit p_limit
$$;

revoke all on function public.find_stale_deals(uuid, int) from public;
grant execute on function public.find_stale_deals(uuid, int) to service_role;
```

(Use Edit, not Write — Task 1 already has the prefix.)

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/crm-stuck-deal-scanner/ \
        supabase/migrations/068_ai_agent.sql
git commit -m "feat(crm): nightly stuck-deal scanner cron + find_stale_deals RPC"
```

---

## Task 7: `crm-agent-snooze-revival` cron Edge Function

**Files:**
- Create: `supabase/functions/crm-agent-snooze-revival/index.ts`

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/crm-agent-snooze-revival/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("revive_agent_snoozes");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, touched: data }), {
    headers: { "content-type": "application/json" },
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crm-agent-snooze-revival/
git commit -m "feat(crm): hourly snooze-revival + expire cron"
```

---

## Task 8: Wire `agent_intake` trigger into crm-run-automations

**Files:**
- Modify: `supabase/functions/crm-run-automations/shared/types.ts`
- Modify: `supabase/functions/crm-run-automations/index.ts`

When a `client_created` event is processed, if there's an enabled recipe whose `trigger.type === "agent_intake"`, fire `ai-agent-suggest` instead of running normal actions.

- [ ] **Step 1: Extend TriggerType in types.ts**

Find the TriggerType union. Add `"agent_intake"`:

```ts
export type TriggerType =
  | "deal_stage_entered"
  | "deal_score_band_changed"
  | "deal_field_changed"
  | "form_submitted"
  | "client_created"
  | "client_tagged"
  | "task_overdue"
  | "scheduled"
  | "agent_intake";  // <-- new
```

- [ ] **Step 2: Add `agent_intake` to ACTION/TRIGGER constants in `src/services/supabase/automations.ts`**

```ts
export const TRIGGER_TYPES = [
  "deal_stage_entered",
  "deal_score_band_changed",
  "deal_field_changed",
  "form_submitted",
  "client_created",
  "client_tagged",
  "task_overdue",
  "scheduled",
  "agent_intake",
] as const;
```

Also extend the `TRIGGER_LABEL` map in `RecipeBuilder.tsx` with:
```
agent_intake: "AI agent: draft for new lead",
```

- [ ] **Step 3: In `crm-run-automations/index.ts`, branch on `agent_intake`**

Inside the recipe-matching loop (the part that resolves which recipes match an event), add a special case BEFORE the normal action loop:

```ts
if (recipe.triggerType === "agent_intake" && event.event_type === "client_created") {
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent-suggest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger_type: "intake",
      organization_id: event.organization_id,
      client_id: event.payload?.client_id,
      source_event_id: event.id,
    }),
  });
  continue;  // skip the normal action loop for this recipe
}
```

(Place this inside the existing per-recipe loop, BEFORE the `executeActions(...)` call.)

- [ ] **Step 4: tsc + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crm-run-automations/ \
        src/services/supabase/automations.ts \
        src/components/settings/RecipeBuilder.tsx
git commit -m "feat(crm): agent_intake trigger fires ai-agent-suggest from recipe engine"
```

---

## Task 9: agentSuggestions service + tests

**Files:**
- Create: `src/services/supabase/agentSuggestions.ts`
- Create: `tests/unit/agentSuggestions.test.ts`

- [ ] **Step 1: Write the failing tests (interface coverage only — no DB)**

```ts
// tests/unit/agentSuggestions.test.ts
import { describe, it, expect } from "vitest";
import { mapSuggestion, mapDraft } from "@/services/supabase/agentSuggestions";

describe("agentSuggestions.mapSuggestion", () => {
  it("maps row with full draft + enrichment", () => {
    const row = {
      id: "s-1",
      organization_id: "o-1",
      trigger_type: "intake",
      client_id: "c-1",
      deal_id: null,
      draft: {
        subject: "Hi",
        body_text: "body",
        body_html: "<p>body</p>",
        confidence: 0.8,
        reasoning: "fits ICP",
      },
      enrichment_snapshot: { title: "CMO" },
      confidence: 0.8,
      reasoning: "fits ICP",
      status: "pending",
      created_at: "2026-05-17T00:00:00Z",
    };
    const s = mapSuggestion(row);
    expect(s.suggestionId).toBe("s-1");
    expect(s.triggerType).toBe("intake");
    expect(s.draft.subject).toBe("Hi");
    expect(s.confidence).toBe(0.8);
    expect(s.enrichment?.title).toBe("CMO");
  });

  it("mapDraft tolerates missing fields", () => {
    const d = mapDraft({});
    expect(d.subject).toBe("");
    expect(d.bodyText).toBe("");
    expect(d.bodyHtml).toBe("");
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run tests/unit/agentSuggestions.test.ts
```

Expected: 2 failures.

- [ ] **Step 3: Implement the service**

```ts
// src/services/supabase/agentSuggestions.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type SuggestionStatus =
  | "pending" | "approved" | "sent" | "rejected"
  | "snoozed" | "expired" | "failed" | "cap_reached";

export interface AgentDraft {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  confidence: number;
  reasoning: string;
  suggestedNextStageId: string | null;
}

export interface AgentSuggestion {
  suggestionId: string;
  organizationId: string;
  triggerType: "intake" | "re_engagement";
  clientId: string | null;
  dealId: string | null;
  draft: AgentDraft;
  enrichment: Record<string, unknown> | null;
  confidence: number | null;
  reasoning: string | null;
  status: SuggestionStatus;
  snoozeUntil: Date | null;
  rejectedReasons: string[] | null;
  rejectedNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export const mapDraft = (raw: Record<string, unknown> | null | undefined): AgentDraft => ({
  subject: (raw?.subject as string) ?? "",
  bodyText: (raw?.body_text as string) ?? "",
  bodyHtml: (raw?.body_html as string) ?? "",
  confidence: typeof raw?.confidence === "number" ? raw.confidence : 0,
  reasoning: (raw?.reasoning as string) ?? "",
  suggestedNextStageId: (raw?.suggested_next_stage_id as string) ?? null,
});

export const mapSuggestion = (r: Record<string, unknown>): AgentSuggestion => ({
  suggestionId: r.id as string,
  organizationId: r.organization_id as string,
  triggerType: r.trigger_type as "intake" | "re_engagement",
  clientId: (r.client_id as string) ?? null,
  dealId: (r.deal_id as string) ?? null,
  draft: mapDraft(r.draft as Record<string, unknown> | null),
  enrichment: (r.enrichment_snapshot as Record<string, unknown> | null) ?? null,
  confidence: r.confidence != null ? Number(r.confidence) : null,
  reasoning: (r.reasoning as string) ?? null,
  status: r.status as SuggestionStatus,
  snoozeUntil: r.snooze_until ? new Date(r.snooze_until as string) : null,
  rejectedReasons: (r.rejected_reasons as string[]) ?? null,
  rejectedNote: (r.rejected_note as string) ?? null,
  decidedBy: (r.decided_by as string) ?? null,
  decidedAt: r.decided_at ? new Date(r.decided_at as string) : null,
  createdAt: new Date(r.created_at as string),
});

export const listPendingSuggestions = async (
  organizationId: string,
): Promise<AgentSuggestion[]> => {
  const { data, error } = await supabase
    .from("agent_suggestions")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["pending"])
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    logger.error("Failed to load suggestions:", error);
    return [];
  }
  return (data ?? []).map(mapSuggestion);
};

export const listSuggestionActivity = async (
  organizationId: string,
  sinceDays = 7,
): Promise<AgentSuggestion[]> => {
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("agent_suggestions")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["sent", "rejected", "expired", "failed", "cap_reached"])
    .gte("decided_at", since)
    .order("decided_at", { ascending: false })
    .limit(200);
  if (error) {
    logger.error("Failed to load suggestion activity:", error);
    return [];
  }
  return (data ?? []).map(mapSuggestion);
};

export interface ApproveArgs {
  suggestionId: string;
  action: "send" | "reject" | "snooze";
  draftOverride?: Partial<AgentDraft>;
  snoozeDays?: number;
  rejectReasons?: string[];
  rejectNote?: string;
}

export const decideSuggestion = async (a: ApproveArgs): Promise<void> => {
  const body: Record<string, unknown> = {
    suggestion_id: a.suggestionId,
    action: a.action,
  };
  if (a.draftOverride) {
    body.draft_override = {
      subject: a.draftOverride.subject,
      body_text: a.draftOverride.bodyText,
      body_html: a.draftOverride.bodyHtml,
    };
  }
  if (a.snoozeDays) body.snooze_days = a.snoozeDays;
  if (a.rejectReasons) body.reject_reasons = a.rejectReasons;
  if (a.rejectNote) body.reject_note = a.rejectNote;

  const { error } = await supabase.functions.invoke("ai-agent-approve", { body });
  if (error) throw error;
};
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/unit/agentSuggestions.test.ts
```

Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase/agentSuggestions.ts \
        tests/unit/agentSuggestions.test.ts
git commit -m "feat(crm): agentSuggestions service (list, decide) + tests"
```

---

## Task 10: useAgentSuggestions + useAgentSettings hooks

**Files:**
- Create: `src/hooks/useAgentSuggestions.ts`
- Create: `src/hooks/useAgentSettings.ts`

- [ ] **Step 1: Write `useAgentSuggestions`**

```ts
// src/hooks/useAgentSuggestions.ts
import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { supabase } from "@/services/supabase/config";
import {
  AgentSuggestion, listPendingSuggestions, listSuggestionActivity,
} from "@/services/supabase/agentSuggestions";

export const useAgentSuggestions = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [pending, setPending] = useState<AgentSuggestion[]>([]);
  const [activity, setActivity] = useState<AgentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  const refresh = async () => {
    const id = orgIdRef.current;
    if (!id) { setPending([]); setActivity([]); setLoading(false); return; }
    const [p, a] = await Promise.all([
      listPendingSuggestions(id),
      listSuggestionActivity(id, 7),
    ]);
    setPending(p);
    setActivity(a);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (!orgId) return;
    const ch = supabase
      .channel(`agent-suggestions-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "agent_suggestions",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .subscribe();
    return () => { ch.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return {
    organizationId: orgId,
    pending, activity, loading,
    canManage: isOwner || isAdmin,
    refresh,
  };
};
```

- [ ] **Step 2: Write `useAgentSettings`**

```ts
// src/hooks/useAgentSettings.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { supabase } from "@/services/supabase/config";

export interface AgentSettings {
  enabled: boolean;
  apolloDailyCap: number;
  draftDailyCap: number;
}

const DEFAULTS: AgentSettings = { enabled: false, apolloDailyCap: 20, draftDailyCap: 50 };

export const useAgentSettings = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [settings, setSettings] = useState<AgentSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!orgId) { setLoading(false); return; }
    const { data } = await supabase.from("organizations")
      .select("ai_agent_enabled, ai_agent_apollo_daily_cap, ai_agent_draft_daily_cap")
      .eq("organization_id", orgId).maybeSingle();
    if (data) {
      setSettings({
        enabled: !!data.ai_agent_enabled,
        apolloDailyCap: Number(data.ai_agent_apollo_daily_cap ?? 20),
        draftDailyCap: Number(data.ai_agent_draft_daily_cap ?? 50),
      });
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orgId]);

  const save = async (patch: Partial<AgentSettings>) => {
    if (!orgId) return;
    setSaving(true);
    const next = { ...settings, ...patch };
    const { error } = await supabase.from("organizations").update({
      ai_agent_enabled: next.enabled,
      ai_agent_apollo_daily_cap: next.apolloDailyCap,
      ai_agent_draft_daily_cap: next.draftDailyCap,
    }).eq("organization_id", orgId);
    setSaving(false);
    if (!error) setSettings(next);
    else throw error;
  };

  return {
    organizationId: orgId,
    settings, loading, saving, save,
    canManage: isOwner || isAdmin,
  };
};
```

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAgentSuggestions.ts src/hooks/useAgentSettings.ts
git commit -m "feat(crm): useAgentSuggestions + useAgentSettings hooks (realtime + RW)"
```

---

## Task 11: AgentQueueTab + SuggestionCard + modals

**Files:**
- Create: `src/components/aiAgent/AgentQueueTab.tsx`
- Create: `src/components/aiAgent/SuggestionCard.tsx`
- Create: `src/components/aiAgent/EditDraftModal.tsx`
- Create: `src/components/aiAgent/RejectModal.tsx`

- [ ] **Step 1: Write SuggestionCard**

```tsx
// src/components/aiAgent/SuggestionCard.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentSuggestion } from "@/services/supabase/agentSuggestions";
import { Mail, MailX, Clock, Edit3, Send } from "lucide-react";

interface Props {
  suggestion: AgentSuggestion;
  onSend: () => void;
  onEdit: () => void;
  onReject: () => void;
  onSnooze: (days: number) => void;
}

export const SuggestionCard: React.FC<Props> = ({
  suggestion, onSend, onEdit, onReject, onSnooze,
}) => {
  const conf = suggestion.confidence ?? 0;
  const confBar = Math.max(0, Math.min(1, conf));
  const enrichmentLine = suggestion.enrichment
    ? [
        (suggestion.enrichment as { title?: string }).title,
        (suggestion.enrichment as { organization?: { name?: string } }).organization?.name,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-muted rounded overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${confBar * 100}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{conf.toFixed(2)}</span>
          <Badge variant="outline" className="capitalize">
            {suggestion.triggerType.replace("_", " ")}
          </Badge>
          {!suggestion.enrichment && (
            <Badge variant="outline" className="text-amber-600">no enrichment</Badge>
          )}
        </div>

        {enrichmentLine && (
          <p className="text-xs text-muted-foreground">{enrichmentLine}</p>
        )}

        <div>
          <p className="font-medium text-sm">{suggestion.draft.subject || "(no subject)"}</p>
          <p className="text-xs text-muted-foreground line-clamp-3 mt-1 whitespace-pre-wrap">
            {suggestion.draft.bodyText}
          </p>
        </div>

        {suggestion.reasoning && (
          <p className="text-[11px] text-muted-foreground italic border-l-2 border-muted pl-2">
            {suggestion.reasoning}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onSend}>
            <Send className="w-3.5 h-3.5 mr-1" /> Approve &amp; send
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}>
            <MailX className="w-3.5 h-3.5 mr-1" /> Reject
          </Button>
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <Button size="sm" variant="ghost" onClick={() => onSnooze(1)}>1d</Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze(3)}>3d</Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze(7)}>7d</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 2: Write EditDraftModal**

```tsx
// src/components/aiAgent/EditDraftModal.tsx
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentDraft } from "@/services/supabase/agentSuggestions";

interface Props {
  open: boolean;
  initial: AgentDraft;
  onCancel: () => void;
  onSend: (draft: { subject: string; bodyText: string; bodyHtml: string }) => void | Promise<void>;
}

export const EditDraftModal: React.FC<Props> = ({ open, initial, onCancel, onSend }) => {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.bodyText);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const html = body.split("\n").filter(Boolean).map((p) => `<p>${p}</p>`).join("");
      await onSend({ subject, bodyText: body, bodyHtml: html });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit draft</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          </div>
          <div>
            <Label>Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={sending}>Cancel</Button>
          <Button onClick={send} disabled={sending || !subject || !body}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 3: Write RejectModal**

```tsx
// src/components/aiAgent/RejectModal.tsx
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REASONS = [
  { id: "generic", label: "Too generic" },
  { id: "wrong_tone", label: "Wrong tone" },
  { id: "bad_enrichment", label: "Bad enrichment data" },
  { id: "not_a_lead", label: "Not a real lead" },
  { id: "bad_timing", label: "Wrong timing" },
  { id: "other", label: "Other" },
] as const;

interface Props {
  open: boolean;
  onCancel: () => void;
  onReject: (reasons: string[], note: string) => void | Promise<void>;
}

export const RejectModal: React.FC<Props> = ({ open, onCancel, onReject }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try { await onReject(Array.from(selected), note); }
    finally { setSubmitting(false); }
  };

  const needsNote = selected.has("other");
  const canSubmit = selected.size > 0 && (!needsNote || note.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why reject this draft?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                {r.label}
              </label>
            ))}
          </div>
          {needsNote && (
            <div>
              <Label>Tell us more</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit || submitting}>
            {submitting ? "Saving…" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 4: Write AgentQueueTab**

```tsx
// src/components/aiAgent/AgentQueueTab.tsx
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Bot } from "lucide-react";
import { useAgentSuggestions } from "@/hooks/useAgentSuggestions";
import {
  AgentSuggestion, decideSuggestion,
} from "@/services/supabase/agentSuggestions";
import { SuggestionCard } from "./SuggestionCard";
import { EditDraftModal } from "./EditDraftModal";
import { RejectModal } from "./RejectModal";
import { toast } from "sonner";

type Filter = "all" | "intake" | "re_engagement" | "no_enrichment";

export const AgentQueueTab: React.FC = () => {
  const { pending, loading, refresh } = useAgentSuggestions();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<AgentSuggestion | null>(null);
  const [rejecting, setRejecting] = useState<AgentSuggestion | null>(null);

  const filtered = pending.filter((s) => {
    if (filter === "intake") return s.triggerType === "intake";
    if (filter === "re_engagement") return s.triggerType === "re_engagement";
    if (filter === "no_enrichment") return !s.enrichment;
    return true;
  });

  const act = async (s: AgentSuggestion, action: "send", payload?: { subject: string; bodyText: string; bodyHtml: string }) => {
    try {
      await decideSuggestion({
        suggestionId: s.suggestionId,
        action,
        draftOverride: payload
          ? { subject: payload.subject, bodyText: payload.bodyText, bodyHtml: payload.bodyHtml }
          : undefined,
      });
      toast.success("Sent");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    }
  };

  const snooze = async (s: AgentSuggestion, days: number) => {
    try {
      await decideSuggestion({ suggestionId: s.suggestionId, action: "snooze", snoozeDays: days });
      toast.success(`Snoozed ${days}d`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snooze failed");
    }
  };

  const reject = async (s: AgentSuggestion, reasons: string[], note: string) => {
    try {
      await decideSuggestion({
        suggestionId: s.suggestionId,
        action: "reject",
        rejectReasons: reasons,
        rejectNote: note || undefined,
      });
      toast.success("Rejected");
      setRejecting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  };

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
    </p>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs">
        {(["all", "intake", "re_engagement", "no_enrichment"] as const).map((f) => (
          <button
            key={f}
            className={`px-2 py-1 rounded border ${
              filter === f ? "bg-foreground text-background" : "bg-background"
            }`}
            onClick={() => setFilter(f)}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Bot className="w-6 h-6 text-indigo-500" />
            No suggestions right now — the agent is watching.
          </CardContent>
        </Card>
      ) : (
        filtered.map((s) => (
          <SuggestionCard
            key={s.suggestionId}
            suggestion={s}
            onSend={() => act(s, "send")}
            onEdit={() => setEditing(s)}
            onReject={() => setRejecting(s)}
            onSnooze={(d) => snooze(s, d)}
          />
        ))
      )}

      {editing && (
        <EditDraftModal
          open
          initial={editing.draft}
          onCancel={() => setEditing(null)}
          onSend={(payload) => act(editing, "send", payload)}
        />
      )}

      {rejecting && (
        <RejectModal
          open
          onCancel={() => setRejecting(null)}
          onReject={(reasons, note) => reject(rejecting, reasons, note)}
        />
      )}
    </div>
  );
};
```

- [ ] **Step 5: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add src/components/aiAgent/
git commit -m "feat(crm): AI agent queue tab + suggestion card + edit/reject modals"
```

---

## Task 12: AgentActivityTab + AgentSettingsTab

**Files:**
- Create: `src/components/aiAgent/AgentActivityTab.tsx`
- Create: `src/components/aiAgent/AgentSettingsTab.tsx`

- [ ] **Step 1: Write AgentActivityTab**

```tsx
// src/components/aiAgent/AgentActivityTab.tsx
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useAgentSuggestions } from "@/hooks/useAgentSuggestions";

const STATUS_VARIANT: Record<string, "default" | "outline" | "destructive"> = {
  sent: "default",
  rejected: "outline",
  expired: "outline",
  failed: "destructive",
  cap_reached: "outline",
};

export const AgentActivityTab: React.FC = () => {
  const { activity, loading } = useAgentSuggestions();

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
    </p>
  );
  if (activity.length === 0) return (
    <p className="text-sm text-muted-foreground">No activity in the last 7 days.</p>
  );

  return (
    <div className="space-y-2">
      {activity.map((s) => (
        <Card key={s.suggestionId}>
          <CardContent className="py-3 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[s.status] ?? "outline"} className="capitalize">
                {s.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="capitalize">{s.triggerType.replace("_", " ")}</Badge>
              <span className="text-muted-foreground tabular-nums">
                {s.decidedAt?.toLocaleString() ?? s.createdAt.toLocaleString()}
              </span>
            </div>
            <p className="font-medium truncate">{s.draft.subject || "(no subject)"}</p>
            {s.rejectedReasons && s.rejectedReasons.length > 0 && (
              <p className="text-muted-foreground">
                Reasons: {s.rejectedReasons.join(", ")}{s.rejectedNote ? ` — ${s.rejectedNote}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Write AgentSettingsTab**

```tsx
// src/components/aiAgent/AgentSettingsTab.tsx
import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useAgentSettings } from "@/hooks/useAgentSettings";
import { toast } from "sonner";

export const AgentSettingsTab: React.FC = () => {
  const { settings, loading, saving, save, canManage } = useAgentSettings();
  const [draft, setDraft] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  React.useEffect(() => { setDraft(settings); }, [settings]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Admins only.</p>;
  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
    </p>
  );

  const submit = async () => {
    try {
      await save(draft);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
        />
        <Label>Enable AI Sales Agent</Label>
      </div>

      <div>
        <Label>Daily Apollo enrichment cap</Label>
        <Input
          type="number" min={0} max={500}
          value={draft.apolloDailyCap}
          onChange={(e) => setDraft({ ...draft, apolloDailyCap: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Apollo Basic plan = ~500 credits/mo. Default 20/day ≈ 600/mo (within plan with caching).
        </p>
      </div>

      <div>
        <Label>Daily LLM draft cap</Label>
        <Input
          type="number" min={0} max={500}
          value={draft.draftDailyCap}
          onChange={(e) => setDraft({ ...draft, draftDailyCap: Number(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Each draft costs about $0.05 in Anthropic tokens.
        </p>
      </div>

      <Button onClick={submit} disabled={!dirty || saving}>
        {saving ? "Saving…" : "Save"}
      </Button>

      <p className="text-xs text-muted-foreground border-t pt-3">
        Per-pipeline staleness threshold is configured in Settings → Pipelines
        (each pipeline gets its own "stale after N days" value, default 14).
      </p>
    </div>
  );
};
```

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add src/components/aiAgent/AgentActivityTab.tsx src/components/aiAgent/AgentSettingsTab.tsx
git commit -m "feat(crm): AI agent activity + settings tabs"
```

---

## Task 13: AIAgent page + route + sidebar entry

**Files:**
- Create: `src/pages/AIAgent.tsx`
- Modify: `src/App.tsx` (or wherever routes live)
- Modify: sidebar component (likely `src/components/layout/Sidebar.tsx` — find via grep before editing)

- [ ] **Step 1: Write the page**

```tsx
// src/pages/AIAgent.tsx
import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Activity, Settings as SettingsIcon } from "lucide-react";
import { AgentQueueTab } from "@/components/aiAgent/AgentQueueTab";
import { AgentActivityTab } from "@/components/aiAgent/AgentActivityTab";
import { AgentSettingsTab } from "@/components/aiAgent/AgentSettingsTab";

export const AIAgent: React.FC = () => {
  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="w-6 h-6 text-indigo-500" />
        <h1 className="text-2xl font-bold">AI Sales Agent</h1>
      </div>
      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue" className="gap-2">
            <Bot className="w-4 h-4" /> Queue
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Activity className="w-4 h-4" /> Activity
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <SettingsIcon className="w-4 h-4" /> Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue"><AgentQueueTab /></TabsContent>
        <TabsContent value="activity"><AgentActivityTab /></TabsContent>
        <TabsContent value="settings"><AgentSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
};
```

- [ ] **Step 2: Find the router + sidebar via grep**

```bash
grep -rn "createBrowserRouter\|<Routes>\|Forecast" src/App.tsx src/main.tsx src/components/layout/ 2>/dev/null
```

Use what you find — every codebase differs. If routes live in `src/App.tsx`, add:
```tsx
import { AIAgent } from "@/pages/AIAgent";
// inside <Routes>:
<Route path="/ai-agent" element={<AIAgent />} />
```

If sidebar is in `src/components/layout/Sidebar.tsx`, add an entry between Forecast and Settings:
```tsx
{ label: "AI Agent", icon: Bot, to: "/ai-agent",
  badge: pendingSuggestionsCount > 0 ? Math.min(99, pendingSuggestionsCount) : undefined },
```

For the badge count, import `useAgentSuggestions` and read `pending.length`. If the sidebar doesn't already do per-item realtime, a simple approach is to wrap with the hook in the sidebar component itself (or pass via context — match what existing items do).

- [ ] **Step 3: tsc + build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AIAgent.tsx src/App.tsx src/components/layout/
git commit -m "feat(crm): /ai-agent page + sidebar entry with pending-count badge"
```

---

## Task 14: Per-pipeline staleness UI in PipelinesSettingsTab

**Files:**
- Modify: `src/components/settings/PipelinesSettingsTab.tsx`
- Modify: `src/services/supabase/pipelines.ts`

- [ ] **Step 1: Add `staleAfterDays` to Pipeline interface + mapPipeline + updatePipeline RPC call**

Read `src/services/supabase/pipelines.ts`. Add `staleAfterDays: number` to the `Pipeline` interface, populate it in the mapping function (`row.stale_after_days as number`), and include it in any update payloads. If pipelines are updated via an RPC, extend the RPC argument too; if updated via direct table update, add the column to the `.update({...})` call.

- [ ] **Step 2: Add a number input to each pipeline row in the settings UI**

In `PipelinesSettingsTab.tsx`, beside the pipeline name/edit controls, add:

```tsx
<div className="flex items-center gap-1 text-xs">
  <Label className="text-xs">Stale after</Label>
  <Input
    type="number" min={1} max={365}
    className="w-20"
    value={pipeline.staleAfterDays}
    onChange={(e) => updatePipeline(pipeline.pipelineId, { staleAfterDays: Number(e.target.value) })}
  />
  <span>days</span>
</div>
```

(Adapt to whatever update function the existing tab uses.)

- [ ] **Step 3: tsc + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/PipelinesSettingsTab.tsx \
        src/services/supabase/pipelines.ts
git commit -m "feat(crm): per-pipeline 'stale after N days' setting feeds AI agent re-engagement"
```

---

## Task 15: Deployment doc for Apollo + cron setup

**Files:**
- Create: `docs/superpowers/deployment/ai-agent-setup.md`

- [ ] **Step 1: Write the doc**

```markdown
# AI Sales Agent — deployment & external setup

## Prereqs
- Batch 2c (sequences) shipped — provides `actions/sendEmail.ts` and
  the Gmail integration plumbing this agent reuses.
- Anthropic API key already set as `ANTHROPIC_API_KEY` Supabase secret
  (from Batch 2b).

## 1. Sign up for Apollo

1. Go to https://www.apollo.io and create an account (or use existing).
2. Plan: **Basic — $49/mo** (~500 credits/month, sufficient for default
   20/day cap with the 30-day cache).
3. Get an API key:
   Apollo dashboard → **Settings → Integrations → API**
   → **Create new API key**. Copy the key.

## 2. Set Supabase secrets

\`\`\`bash
npx supabase secrets set APOLLO_API_KEY=<paste-key-here>
\`\`\`

(Existing secrets `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_TOKEN_KEY`, and
`SEQUENCE_INBOUND_DOMAIN` should already be set from previous batches.)

## 3. Apply the migration

\`\`\`bash
npx supabase db push
\`\`\`

This creates `agent_suggestions`, `apollo_lookups`, adds
`pipelines.stale_after_days`, `organizations.ai_agent_*` columns,
and `deals.last_activity_at`.

## 4. Deploy Edge Functions

\`\`\`bash
npx supabase functions deploy ai-agent-suggest
npx supabase functions deploy ai-agent-approve
npx supabase functions deploy crm-stuck-deal-scanner
npx supabase functions deploy crm-agent-snooze-revival
npx supabase functions deploy crm-run-automations  # picks up agent_intake trigger
\`\`\`

## 5. Schedule the cron jobs

In Supabase Dashboard → **Database → Cron jobs** (extension
`pg_cron` must be enabled — already on for Batch 2a):

\`\`\`sql
-- Stuck-deal scanner: daily at 09:00 UTC
select cron.schedule(
  'ai-agent-stuck-scan',
  '0 9 * * *',
  $$select net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/crm-stuck-deal-scanner',
    headers:='{"Authorization":"Bearer <service-role-key>"}'::jsonb
  )$$
);

-- Snooze revival + expire: hourly
select cron.schedule(
  'ai-agent-snooze-revival',
  '0 * * * *',
  $$select net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/crm-agent-snooze-revival',
    headers:='{"Authorization":"Bearer <service-role-key>"}'::jsonb
  )$$
);
\`\`\`

## 6. Frontend redeploy

Rebuild + redeploy Vite (Vercel/Netlify autodeploys on push to main).

## 7. Enable the agent per org

Each org owner: **Settings → AI Agent (Settings tab) → Enable**.

Off by default — no surprises, no Apollo credits burned until opted in.

## 8. Verify

1. Enable the agent for your test org.
2. Settings → AI Agent → Settings: cap Apollo + LLM both at 5
   (so a test run can't exhaust your monthly Apollo).
3. Create an `agent_intake` recipe in Settings → Automations
   (trigger: "AI agent: draft for new lead", no actions needed
   — the recipe just marks intake as enabled for this org).
4. Add a test client with an email at a real company domain.
5. Within ~60s, a suggestion appears in the queue (or
   `status='cap_reached'` if you've already hit your test cap).
6. Click Edit → modify subject → Send. Email arrives via your Gmail.
7. Manually set a test deal's `last_activity_at` to 30 days ago
   and invoke `crm-stuck-deal-scanner`:
   \`\`\`bash
   curl -X POST https://<project-ref>.supabase.co/functions/v1/crm-stuck-deal-scanner \
     -H "Authorization: Bearer <service-role-key>"
   \`\`\`
   → re-engagement suggestion appears.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/deployment/ai-agent-setup.md
git commit -m "docs: AI Sales Agent deployment guide (Apollo + cron + opt-in)"
```

---

## Task 16: Merge to main + push

**Files:** none (git operations)

- [ ] **Step 1: Final verification**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```

Expected: tsc clean, all tests pass (Batch 2c's 71 + 4 apolloCache + 5 agentDraftPrompt + 2 agentSuggestions = 82 tests).

- [ ] **Step 2: Merge no-ff**

```bash
git checkout main
git pull origin main
git merge --no-ff feature/crm-ai-agent -m "Merge branch 'feature/crm-ai-agent'

CRM Batch 2d — AI Sales Agent (16 tasks):
- Migration 068 (agent_suggestions, apollo_lookups, pipelines.stale_after_days,
  org-level enablement + caps, deals.last_activity_at,
  revive_agent_snoozes + find_stale_deals RPCs)
- Shared Gmail send helper extracted from sequences
- Apollo enrichment client with 30-day sha256-keyed cache
- ai-agent-suggest Edge Function (cap → enrich → LLM draft → insert)
- ai-agent-approve Edge Function (send via shared gmail / reject / snooze)
- Two new crons: stuck-deal scanner (daily 09:00 UTC) + snooze-revival (hourly)
- agent_intake trigger wired into existing recipe engine
- New /ai-agent route with Queue / Activity / Settings tabs
- Per-pipeline 'stale after N days' setting

82 tests pass, tsc clean."
git push origin main
```

- [ ] **Step 3: User-facing deploy instructions**

After merge, user runs (in their own terminal):

```bash
# 1. Apollo signup (one-time): https://www.apollo.io → Basic $49/mo
#    → API key → npx supabase secrets set APOLLO_API_KEY=<key>

# 2. Migration:
npx supabase db push

# 3. Edge Functions:
npx supabase functions deploy ai-agent-suggest
npx supabase functions deploy ai-agent-approve
npx supabase functions deploy crm-stuck-deal-scanner
npx supabase functions deploy crm-agent-snooze-revival
npx supabase functions deploy crm-run-automations

# 4. Schedule crons (in Supabase Dashboard → Database → Cron, SQL from
#    docs/superpowers/deployment/ai-agent-setup.md step 5)

# 5. Frontend redeploys via your usual flow (Vercel/Netlify push).

# 6. Each org owner opts in: Settings → AI Agent (Settings tab) → Enable.
```

---

## Self-Review

| Spec requirement | Task covering it |
|---|---|
| **A.1 Goals** — reduce time-to-first-touch; catch stale deals; human in loop; cost cap | Tasks 4, 6 (triggers), 5 (approve), 4 (caps) |
| **A.2 Non-goals** | Enforced by absence — no auto-send code in Task 5 |
| **B.1 Two trigger paths** | Task 8 (intake via recipe engine) + Task 6 (re-engagement cron) |
| **B.2 ai-agent-suggest flow** (caps → context → Apollo → LLM → insert) | Task 4 |
| **B.3 crm-stuck-deal-scanner query** | Task 6 (RPC + cron) |
| **B.4 Apollo plan + endpoints + failure modes + cache** | Task 3 |
| **B.5 LLM prompt design + JSON schema** | Task 4 (SYSTEM_PROMPT + buildUserMessage) |
| **B.6 Approval pipeline** (send/edit/reject/snooze + auto-expire) | Task 5 + Task 7 (revival cron) |
| **C.1 Migration 068** — all tables, RLS, RPCs | Task 1 + Task 6 step 2 (find_stale_deals appended) |
| **C.2 ai_usage_events kinds** (apollo_lookup, agent_draft) | Task 4 (insert calls) |
| **D.1–D.4 Edge Functions** | Tasks 4, 5, 6, 7 |
| **E.1 New route /ai-agent + sidebar badge** | Task 13 |
| **E.2 Three tabs** (Queue, Activity, Settings) | Tasks 11, 12 |
| **E.3 Edit modal** | Task 11 |
| **F. Permissions** | RLS in Task 1 + role check in Task 5 |
| **G.1 Unit tests** | apolloCache (Task 3), agentDraftPrompt (Task 4), agentSuggestions (Task 9) |
| **H. Rollout** | Task 15 (doc) + Task 16 (deploy steps) |

**Placeholder scan:** No TODO / TBD strings. All steps contain runnable code or exact commands.

**Type consistency:**
- `agent_suggestions` column names match across Task 1 (migration), Task 4 (insert), Task 9 (mapSuggestion). All references use `confidence`, `reasoning`, `enrichment_snapshot`, `rejected_reasons`, `rejected_note` consistently.
- `AgentDraft` shape in Task 9 service matches the JSON keys the LLM emits in Task 4 prompt (`subject`, `body_text`, `body_html`, `confidence`, `reasoning`, `suggested_next_stage_id`) — service uses camelCase wrappers (`bodyText`, `bodyHtml`, `suggestedNextStageId`).
- `sendViaGmail` signature in Task 2 matches the call in Task 5.
- `find_stale_deals` returns `(deal_id, organization_id)` (Task 6 step 2); Task 6 step 1 destructures both.

**Test count math:** Batch 2c ended at 71. New tests: 4 (apolloCache) + 5 (agentDraftPrompt) + 2 (agentSuggestions) = 11. Final total: 82.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-17-crm-ai-agent.md`.

Per the established pattern across Batches 2a/2b/2c, this will execute via subagent-driven-development with the calibrated ceremony level (full ceremony for judgment tasks: 4, 5, 8, 11, 13, 14; mechanical paste for the rest).
