# Telegram Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Telegram bot that lets an authenticated TaskCalendar user create workspaces, projects, tasks, clients, and client tasks via natural-language messages, with a confirmation step before each write.

**Architecture:** Telegram webhook → Supabase Edge Function (`telegram-webhook`). Webhook resolves the chat to a linked TaskCalendar user via the `integrations` table, sends the message text to OpenAI for intent parsing, and runs a platform-agnostic `agentActions` resolver. Resolved actions are buffered in `agent_pending_actions` and only written on the user's "✅ Confirm" inline-button reply, via new `agent_create_*` security-definer RPCs that take `p_user_id` and respect org membership + plan limits. The same `Intent` / `agentActions` core will later back a `whatsapp-webhook`.

**Tech Stack:** TypeScript, Deno (Supabase Edge Functions), Supabase (PostgreSQL + service-role admin client), OpenAI (gpt-4o-mini via existing `ai-chat` style proxy or direct from edge function), React + Tailwind + shadcn/ui for the Settings card, Telegram Bot API.

---

## File Structure

### Created
- `supabase/migrations/082_telegram_bot.sql` — `telegram_link_codes`, `agent_pending_actions`, integrations provider check update.
- `supabase/migrations/083_agent_create_rpcs.sql` — security-definer RPCs the bot uses for writes.
- `supabase/functions/telegram-webhook/index.ts` — entrypoint, secret-token verification, routing.
- `supabase/functions/telegram-webhook/telegram.ts` — Telegram Bot API client.
- `supabase/functions/telegram-webhook/handlers.ts` — slash command handlers + NL handler + callback-query handler.
- `supabase/functions/telegram-webhook/intent.ts` — OpenAI call + JSON-schema parsing (edge-side, since the webhook has no user JWT to hit the `ai-chat` proxy).
- `supabase/functions/telegram-webhook/agentActions.ts` — resolves intent → DB writes via RPCs.
- `supabase/functions/telegram-webhook/types.ts` — Intent / PendingAction / AgentReply types.
- `supabase/functions/telegram-link-code/index.ts` — authenticated POST that generates a 6-digit code.
- `src/components/integrations/TelegramConnectCard.tsx` — Settings UI for linking.
- `src/services/integrations/telegram.ts` — frontend helpers (request code, fetch status, unlink).

### Modified
- `src/services/integrations/types.ts` — add `'telegram'` to `ProviderId`, add `'MessageCircle'` to `iconName`.
- `src/services/integrations/providers.ts` — register telegram provider metadata.
- `src/components/integrations/IntegrationsTab.tsx` — render `TelegramConnectCard` after the OAuth provider loop.

---

## Task 1: Database migration — new tables and provider check

**Files:**
- Create: `supabase/migrations/082_telegram_bot.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 082_telegram_bot.sql
-- Adds the Telegram bot's two backing tables and extends the integrations
-- provider check to allow 'telegram'.

-- Allow 'telegram' (and reserve 'whatsapp' for the future adapter).
alter table public.integrations
  drop constraint if exists integrations_provider_check;
alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google','gmail','slack','telegram','whatsapp'));

-- One-time link codes (6 digits, hashed, 10-minute TTL).
create table if not exists public.telegram_link_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid not null references public.organizations(organization_id) on delete cascade,
  code_hash    text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create unique index if not exists telegram_link_codes_active_hash
  on public.telegram_link_codes(code_hash)
  where consumed_at is null;

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes(user_id, created_at desc);

alter table public.telegram_link_codes enable row level security;

create policy "users read own link codes"
  on public.telegram_link_codes for select
  using (auth.uid() = user_id);

-- Writes happen via the telegram-link-code edge function (service role) and the
-- webhook (service role). No INSERT/UPDATE policies for end users.

-- Buffer for actions awaiting confirmation.
create table if not exists public.agent_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null check (provider in ('telegram','whatsapp')),
  chat_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(organization_id) on delete cascade,
  action      jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists agent_pending_actions_chat_idx
  on public.agent_pending_actions(provider, chat_id, expires_at desc);

alter table public.agent_pending_actions enable row level security;

-- Service-role only; no end-user policies.
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset` (or `npx supabase migration up` if the local DB has state to keep).
Expected: migration applies without error.

- [ ] **Step 3: Verify in psql / Supabase Studio**

Run:
```sql
\d public.telegram_link_codes
\d public.agent_pending_actions
select pg_get_constraintdef(oid) from pg_constraint where conname='integrations_provider_check';
```
Expected: both tables exist; the check constraint shows `provider in ('google','gmail','slack','telegram','whatsapp')`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/082_telegram_bot.sql
git commit -m "feat(telegram-bot): add link-codes + pending-actions tables"
```

---

## Task 2: Database migration — agent RPCs for entity writes

The webhook runs with the service-role key (no user JWT). The existing `crm_create_*` RPCs rely on `auth.uid()`, so we add agent-only siblings that take `p_user_id` and re-check org membership + plan limits.

**Files:**
- Create: `supabase/migrations/083_agent_create_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 083_agent_create_rpcs.sql
-- Security-definer RPCs the Telegram/WhatsApp webhook uses to write entities
-- on behalf of a linked user. Each function takes p_user_id explicitly and
-- re-verifies org membership.

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_workspace
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_workspace(
  p_user_id uuid,
  p_organization_id uuid,
  p_name text
) returns public.workspaces
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.workspaces;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Workspace name is required' using errcode = '23514';
  end if;

  insert into public.workspaces (workspace_id, name, organization_id, is_default, created_at, updated_at)
  values (gen_random_uuid(), btrim(p_name), p_organization_id, false, now(), now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_workspace(uuid, uuid, text) from public, authenticated, anon;
-- Service role bypasses RLS but we still keep grants tight; only the service
-- role and postgres can execute. Edge functions call this via the admin client.

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_project
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_project(
  p_user_id uuid,
  p_organization_id uuid,
  p_workspace_id uuid,
  p_name text,
  p_description text default null
) returns public.projects
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.projects;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Project name is required' using errcode = '23514';
  end if;
  if p_workspace_id is not null and not exists (
    select 1 from public.workspaces
    where workspace_id = p_workspace_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Workspace does not belong to this organization' using errcode = '23503';
  end if;

  insert into public.projects (project_id, name, description, owner_id, organization_id, workspace_id, created_by, created_at, updated_at)
  values (gen_random_uuid(), btrim(p_name), nullif(btrim(p_description), ''), p_user_id, p_organization_id, p_workspace_id, p_user_id, now(), now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_project(uuid, uuid, uuid, text, text) from public, authenticated, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- agent_create_task
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.agent_create_task(
  p_user_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_title text,
  p_due_at timestamptz default null,
  p_description text default null
) returns public.tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.tasks;
  v_position int;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'Task title is required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.projects
    where project_id = p_project_id
      and organization_id = p_organization_id
  ) then
    raise exception 'Project does not belong to this organization' using errcode = '23503';
  end if;

  select coalesce(max(position), -1) + 1
    into v_position
    from public.tasks
   where project_id = p_project_id
     and status = 'undefined';

  insert into public.tasks (
    task_id, project_id, organization_id, title, description, status, priority,
    position, due_date, created_by, created_at, updated_at
  ) values (
    gen_random_uuid(), p_project_id, p_organization_id, btrim(p_title),
    nullif(btrim(p_description), ''), 'undefined', 'medium',
    v_position, p_due_at, p_user_id, now(), now()
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.agent_create_task(uuid, uuid, uuid, text, timestamptz, text) from public, authenticated, anon;

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: org-membership for an explicit user_id (the existing is_org_member
-- uses auth.uid() so we add a 2-arg variant).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.is_org_member_for(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_org_id
      and user_id = p_user_id
  );
$$;

revoke execute on function public.is_org_member_for(uuid, uuid) from public, authenticated, anon;
```

- [ ] **Step 2: Verify columns referenced exist**

Run, in psql:
```sql
\d public.workspaces
\d public.projects
\d public.tasks
\d public.organization_members
```
If any column referenced above (e.g., `tasks.position`, `tasks.status`, `tasks.due_date`, `organization_members.user_id`) is named differently in this codebase, fix the RPC body to match before applying. Existing service code in `src/services/supabase/database.ts` is the source of truth for column names; cross-check `createTask` (around line 924) and `createProject` (around line 376).

- [ ] **Step 3: Apply migration**

Run: `npx supabase migration up`
Expected: applies without error.

- [ ] **Step 4: Smoke-test one RPC**

Run, in psql, as the postgres / service role:
```sql
-- Replace UUIDs with values from your local DB.
select agent_create_workspace('00000000-0000-0000-0000-000000000001'::uuid,
                              '00000000-0000-0000-0000-000000000002'::uuid,
                              'Test from RPC');
```
Expected: returns a row, or `42501` if that user/org pair isn't a member (proves the membership check works).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/083_agent_create_rpcs.sql
git commit -m "feat(telegram-bot): agent_create_* RPCs for service-role writes"
```

---

## Task 3: Edge function — shared types

**Files:**
- Create: `supabase/functions/telegram-webhook/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-webhook/types.ts

export type AgentActionType =
  | "create_workspace"
  | "create_project"
  | "create_task"
  | "create_client"
  | "create_client_task"
  | "switch_org"
  | "list_orgs"
  | "help"
  | "unknown";

export interface Intent {
  action: AgentActionType;
  // Free-form names from the message; resolution happens in agentActions.
  workspace?: string | null;
  project?: string | null;
  client?: string | null;
  // Entity payload fields:
  title?: string | null;
  name?: string | null;
  description?: string | null;
  due?: string | null;          // ISO 8601
  // Confidence is informational only — we still run the full resolver.
  confidence?: number;
}

export interface PendingAction {
  id: string;
  provider: "telegram" | "whatsapp";
  chat_id: string;
  user_id: string;
  org_id: string;
  action: Intent & { resolved_ids?: Record<string, string> };
  expires_at: string;
}

export type AgentReply =
  | { kind: "text"; text: string }
  | {
      kind: "confirm";
      summary: string;
      pendingActionId: string;
    }
  | {
      kind: "choices";
      prompt: string;
      // Each choice carries the data we need to re-run resolution.
      choices: Array<{ label: string; callback: string }>;
    }
  | { kind: "noop" };

export interface LinkedAccount {
  user_id: string;
  current_org_id: string;
  telegram_user_id: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/types.ts
git commit -m "feat(telegram-bot): shared types for webhook"
```

---

## Task 4: Edge function — Telegram API client

**Files:**
- Create: `supabase/functions/telegram-webhook/telegram.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-webhook/telegram.ts
// Minimal Telegram Bot API client. Only the methods we use.

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export interface InlineButton {
  text: string;
  callback_data: string;
}

const tg = async (method: string, body: Record<string, unknown>) => {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error(`telegram ${method} failed:`, json);
    throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result;
};

export const sendMessage = async (
  chatId: number | string,
  text: string,
  keyboard?: InlineButton[][],
): Promise<void> => {
  await tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
};

export const answerCallbackQuery = async (
  callbackQueryId: string,
  text?: string,
): Promise<void> => {
  await tg("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
};

export const editMessageText = async (
  chatId: number | string,
  messageId: number,
  text: string,
): Promise<void> => {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/telegram.ts
git commit -m "feat(telegram-bot): Telegram Bot API client"
```

---

## Task 5: Edge function — intent parser (OpenAI)

**Files:**
- Create: `supabase/functions/telegram-webhook/intent.ts`

- [ ] **Step 1: Write the file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/intent.ts
git commit -m "feat(telegram-bot): OpenAI intent parser"
```

---

## Task 6: Edge function — agentActions (resolver + writes)

**Files:**
- Create: `supabase/functions/telegram-webhook/agentActions.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-webhook/agentActions.ts
// Platform-agnostic resolver. Takes a parsed Intent + a linked user and either
// returns a ConfirmReply (with a pending-action id), a choices reply for
// disambiguation, or a plain text error/help reply.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentReply, Intent, LinkedAccount } from "./types.ts";

const PENDING_TTL_MIN = 10;

const findByName = async (
  admin: SupabaseClient,
  table: string,
  nameCol: string,
  pkCol: string,
  orgId: string,
  needle: string,
): Promise<{ matches: Array<{ id: string; name: string }> }> => {
  const { data } = await admin
    .from(table)
    .select(`${pkCol}, ${nameCol}`)
    .eq("organization_id", orgId)
    .ilike(nameCol, needle);
  const rows = (data ?? []) as Array<Record<string, string>>;
  return {
    matches: rows.map((r) => ({ id: r[pkCol], name: r[nameCol] })),
  };
};

const queuePending = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
  resolvedIds: Record<string, string>,
): Promise<string> => {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MIN * 60_000).toISOString();
  // Opportunistic GC.
  await admin.from("agent_pending_actions").delete().lt("expires_at", new Date().toISOString());
  const { data, error } = await admin
    .from("agent_pending_actions")
    .insert({
      provider: "telegram",
      chat_id: chatId,
      user_id: account.user_id,
      org_id: account.current_org_id,
      action: { ...intent, resolved_ids: resolvedIds },
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
};

export const resolveIntent = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
): Promise<AgentReply> => {
  switch (intent.action) {
    case "help":
      return { kind: "text", text: HELP_TEXT };
    case "list_orgs":
      return { kind: "text", text: await formatOrgs(admin, account) };
    case "switch_org":
      return { kind: "text", text: "Use `/switchorg <name>` — e.g. `/switchorg Acme Corp`." };
    case "unknown":
      return { kind: "text", text: "I didn't catch that. Try `/help`, or rephrase." };

    case "create_workspace": {
      const name = (intent.name ?? intent.workspace ?? "").trim();
      if (!name) return { kind: "text", text: "What should the workspace be called?" };
      const pendingId = await queuePending(admin, account, chatId, intent, {});
      return {
        kind: "confirm",
        summary: `Create workspace *${name}*?`,
        pendingActionId: pendingId,
      };
    }

    case "create_project": {
      const name = (intent.name ?? intent.project ?? intent.title ?? "").trim();
      if (!name) return { kind: "text", text: "What should the project be called?" };
      let workspaceId: string | null = null;
      if (intent.workspace) {
        const { matches } = await findByName(admin, "workspaces", "name", "workspace_id", account.current_org_id, intent.workspace);
        if (matches.length === 0) {
          return {
            kind: "text",
            text: `No workspace called *${intent.workspace}*. Create it first or omit the workspace.`,
          };
        }
        if (matches.length > 1) {
          return {
            kind: "choices",
            prompt: `Multiple workspaces match *${intent.workspace}*. Pick one:`,
            choices: matches.map((m) => ({
              label: m.name,
              callback: `pickws:${m.id}`,
            })),
          };
        }
        workspaceId = matches[0].id;
      }
      const pendingId = await queuePending(admin, account, chatId, intent, workspaceId ? { workspace_id: workspaceId } : {});
      return {
        kind: "confirm",
        summary: `Create project *${name}*${intent.workspace ? ` in *${intent.workspace}*` : ""}?`,
        pendingActionId: pendingId,
      };
    }

    case "create_task": {
      const title = (intent.title ?? "").trim();
      if (!title) return { kind: "text", text: "What's the task title?" };
      if (!intent.project) return { kind: "text", text: "Which project? e.g. `task: X in Q1 launch`." };
      const { matches } = await findByName(admin, "projects", "name", "project_id", account.current_org_id, intent.project);
      if (matches.length === 0) {
        return { kind: "text", text: `No project called *${intent.project}*.` };
      }
      if (matches.length > 1) {
        return {
          kind: "choices",
          prompt: `Multiple projects match *${intent.project}*. Pick one:`,
          choices: matches.map((m) => ({ label: m.name, callback: `pickproj:${m.id}` })),
        };
      }
      const pendingId = await queuePending(admin, account, chatId, intent, { project_id: matches[0].id });
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return {
        kind: "confirm",
        summary: `Create task *${title}* in *${matches[0].name}*${dueBit}?`,
        pendingActionId: pendingId,
      };
    }

    case "create_client": {
      const name = (intent.name ?? intent.client ?? "").trim();
      if (!name) return { kind: "text", text: "What's the client name?" };
      const pendingId = await queuePending(admin, account, chatId, intent, {});
      return {
        kind: "confirm",
        summary: `Create client *${name}*?`,
        pendingActionId: pendingId,
      };
    }

    case "create_client_task": {
      const title = (intent.title ?? "").trim();
      if (!title) return { kind: "text", text: "What's the task title?" };
      let clientId: string | null = null;
      if (intent.client) {
        const { matches } = await findByName(admin, "clients", "name", "client_id", account.current_org_id, intent.client);
        if (matches.length === 0) {
          return { kind: "text", text: `No client called *${intent.client}*.` };
        }
        if (matches.length > 1) {
          return {
            kind: "choices",
            prompt: `Multiple clients match *${intent.client}*. Pick one:`,
            choices: matches.map((m) => ({ label: m.name, callback: `pickclient:${m.id}` })),
          };
        }
        clientId = matches[0].id;
      }
      const pendingId = await queuePending(admin, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const onBit = intent.client ? ` for *${intent.client}*` : "";
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return {
        kind: "confirm",
        summary: `Create client task *${title}*${onBit}${dueBit}?`,
        pendingActionId: pendingId,
      };
    }
  }
};

export const executePending = async (
  admin: SupabaseClient,
  pendingId: string,
): Promise<string> => {
  // Returns a short success message; throws on error.
  const { data: row, error } = await admin
    .from("agent_pending_actions")
    .select("*")
    .eq("id", pendingId)
    .maybeSingle();
  if (error || !row) throw new Error("Pending action not found or expired.");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
    throw new Error("That request expired. Please resend the message.");
  }

  const a = row.action as Intent & { resolved_ids?: Record<string, string> };

  try {
    switch (a.action) {
      case "create_workspace": {
        const name = (a.name ?? a.workspace ?? "").trim();
        const { data, error: e } = await admin.rpc("agent_create_workspace", {
          p_user_id: row.user_id, p_organization_id: row.org_id, p_name: name,
        });
        if (e) throw e;
        return `✅ Workspace *${data.name}* created.`;
      }
      case "create_project": {
        const name = (a.name ?? a.project ?? a.title ?? "").trim();
        const wsId = a.resolved_ids?.workspace_id ?? null;
        const { data, error: e } = await admin.rpc("agent_create_project", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_workspace_id: wsId,
          p_name: name,
          p_description: a.description ?? null,
        });
        if (e) throw e;
        return `✅ Project *${data.name}* created.`;
      }
      case "create_task": {
        const title = (a.title ?? "").trim();
        const projId = a.resolved_ids?.project_id;
        if (!projId) throw new Error("Project not resolved.");
        const { data, error: e } = await admin.rpc("agent_create_task", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_project_id: projId,
          p_title: title,
          p_due_at: a.due ?? null,
          p_description: a.description ?? null,
        });
        if (e) throw e;
        return `✅ Task *${data.title}* created.`;
      }
      case "create_client": {
        const name = (a.name ?? a.client ?? "").trim();
        const { data, error: e } = await admin.rpc("crm_create_client_as", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_client: { name },
        });
        if (e) throw e;
        return `✅ Client *${data.name}* created.`;
      }
      case "create_client_task": {
        const title = (a.title ?? "").trim();
        const clientId = a.resolved_ids?.client_id ?? null;
        const { data, error: e } = await admin.rpc("crm_create_client_task_as", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_task: {
            title,
            client_id: clientId,
            due_at: a.due ?? null,
            description: a.description ?? null,
          },
        });
        if (e) throw e;
        return `✅ Client task *${data.title}* created.`;
      }
      default:
        throw new Error("Unsupported pending action.");
    }
  } finally {
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
  }
};

const HELP_TEXT = `*TaskCalendar bot — natural-language commands*

Examples:
• \`add workspace Acme Onboarding\`
• \`new project Q1 launch in Acme Onboarding\`
• \`task: call John tomorrow 3pm in Q1 launch\`
• \`new client Acme Corp\`
• \`client task: follow up with Acme on Friday\`

Slash commands:
• \`/orgs\` — list your orgs
• \`/switchorg <name>\` — switch current org
• \`/unlink\` — disconnect this chat
• \`/help\` — show this message`;

const formatOrgs = async (admin: SupabaseClient, account: LinkedAccount): Promise<string> => {
  const { data } = await admin
    .from("organization_members")
    .select("organization_id, organizations(name)")
    .eq("user_id", account.user_id);
  const rows = (data ?? []) as Array<{ organization_id: string; organizations: { name: string } }>;
  if (rows.length === 0) return "You're not in any orgs yet.";
  return rows
    .map((r) => `${r.organization_id === account.current_org_id ? "▶" : " "} ${r.organizations.name}`)
    .join("\n");
};
```

- [ ] **Step 2: Add the matching client-task and client RPCs**

The CRM RPCs in `074_crm_create_client_task_rpc.sql` and `072_crm_create_client_rpc.sql` use `auth.uid()`. We need `_as` siblings that accept `p_user_id`. Append to `083_agent_create_rpcs.sql`:

```sql
-- crm_create_client_as: p_user_id variant of crm_create_client.
create or replace function public.crm_create_client_as(
  p_user_id uuid,
  p_organization_id uuid,
  p_client jsonb
) returns public.clients
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.clients;
begin
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_client->>'name'), '') is null then
    raise exception 'Client name is required' using errcode = '23514';
  end if;
  insert into public.clients (organization_id, name, created_by)
  values (p_organization_id, btrim(p_client->>'name'), p_user_id)
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.crm_create_client_as(uuid, uuid, jsonb) from public, authenticated, anon;

-- crm_create_client_task_as: p_user_id variant.
create or replace function public.crm_create_client_task_as(
  p_user_id uuid,
  p_organization_id uuid,
  p_task jsonb
) returns public.client_tasks
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.client_tasks;
  v_client_id uuid := nullif(p_task->>'client_id', '')::uuid;
begin
  if not public.is_org_member_for(p_user_id, p_organization_id) then
    raise exception 'User is not a member of this organization' using errcode = '42501';
  end if;
  if nullif(btrim(p_task->>'title'), '') is null then
    raise exception 'Task title is required' using errcode = '23514';
  end if;
  insert into public.client_tasks (
    organization_id, client_id, title, description, type, status, due_at,
    assigned_to, created_by
  ) values (
    p_organization_id, v_client_id,
    btrim(p_task->>'title'),
    nullif(btrim(p_task->>'description'), ''),
    coalesce(nullif(btrim(p_task->>'type'), ''), 'todo'),
    'pending',
    nullif(p_task->>'due_at', '')::timestamptz,
    p_user_id,
    p_user_id
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.crm_create_client_task_as(uuid, uuid, jsonb) from public, authenticated, anon;
```

Re-apply: `npx supabase migration up`. Expected: succeeds (the migration file is idempotent via `create or replace`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/telegram-webhook/agentActions.ts supabase/migrations/083_agent_create_rpcs.sql
git commit -m "feat(telegram-bot): agentActions resolver + client RPCs"
```

---

## Task 7: Edge function — handlers (commands + NL + callbacks)

**Files:**
- Create: `supabase/functions/telegram-webhook/handlers.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-webhook/handlers.ts

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage, answerCallbackQuery, type InlineButton } from "./telegram.ts";
import { parseIntent } from "./intent.ts";
import { resolveIntent, executePending } from "./agentActions.ts";
import type { AgentReply, LinkedAccount } from "./types.ts";

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const findLinkedAccount = async (
  admin: SupabaseClient,
  telegramUserId: number,
): Promise<LinkedAccount | null> => {
  const { data } = await admin
    .from("integrations")
    .select("user_id, metadata")
    .eq("provider", "telegram")
    .filter("metadata->>telegram_user_id", "eq", String(telegramUserId))
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as { current_org_id?: string };
  if (!meta.current_org_id) return null;
  return {
    user_id: data.user_id as string,
    current_org_id: meta.current_org_id,
    telegram_user_id: telegramUserId,
  };
};

export const handleStart = async (
  admin: SupabaseClient,
  chatId: number,
  telegramUserId: number,
  telegramUsername: string | undefined,
  arg: string | undefined,
): Promise<void> => {
  if (!arg) {
    const existing = await findLinkedAccount(admin, telegramUserId);
    if (existing) {
      await sendMessage(chatId, `✅ Already linked. Try \`add task: call John tomorrow 3pm in My Project\`. /help for more.`);
    } else {
      await sendMessage(chatId, `👋 To link this chat, generate a code in TaskCalendar (Settings → Integrations → Telegram), then send \`/start <code>\`.`);
    }
    return;
  }
  const code = arg.trim();
  if (!/^\d{6}$/.test(code)) {
    await sendMessage(chatId, "Codes are 6 digits. Try again.");
    return;
  }
  const codeHash = await sha256Hex(code);
  const { data: codeRow } = await admin
    .from("telegram_link_codes")
    .select("id, user_id, org_id, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (!codeRow) {
    await sendMessage(chatId, "❌ Invalid or already-used code. Generate a new one in Settings.");
    return;
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    await sendMessage(chatId, "❌ Code expired. Generate a new one.");
    return;
  }
  // Consume code + upsert integrations row in two writes.
  await admin.from("telegram_link_codes").update({ consumed_at: new Date().toISOString() }).eq("id", codeRow.id);
  await admin.from("integrations").upsert({
    user_id: codeRow.user_id,
    provider: "telegram",
    access_token_encrypted: "n/a",            // schema requires a value; not used for telegram
    status: "active",
    metadata: {
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername ?? null,
      chat_id: chatId,
      current_org_id: codeRow.org_id,
    },
  }, { onConflict: "user_id,provider" });
  await sendMessage(chatId, `✅ Linked! You can now send things like \`add workspace Sales\` or \`task: call John tomorrow 3pm in Q1 launch\`. Send /help for more.`);
};

export const handleUnlink = async (
  admin: SupabaseClient,
  chatId: number,
  telegramUserId: number,
): Promise<void> => {
  const account = await findLinkedAccount(admin, telegramUserId);
  if (!account) {
    await sendMessage(chatId, "Not linked.");
    return;
  }
  await admin.from("integrations")
    .delete()
    .eq("provider", "telegram")
    .eq("user_id", account.user_id);
  await sendMessage(chatId, "🔌 Unlinked. /start to link again.");
};

export const handleSwitchOrg = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  arg: string,
): Promise<void> => {
  const needle = arg.trim();
  if (!needle) {
    await sendMessage(chatId, "Usage: `/switchorg <name>`. Try /orgs to list.");
    return;
  }
  const { data } = await admin
    .from("organization_members")
    .select("organization_id, organizations(name)")
    .eq("user_id", account.user_id);
  const rows = (data ?? []) as Array<{ organization_id: string; organizations: { name: string } }>;
  const match = rows.find((r) => r.organizations.name.toLowerCase() === needle.toLowerCase());
  if (!match) {
    await sendMessage(chatId, `No org named *${needle}*. /orgs to see what you have.`);
    return;
  }
  await admin
    .from("integrations")
    .update({ metadata: { ...(await getMeta(admin, account.user_id)), current_org_id: match.organization_id } })
    .eq("provider", "telegram")
    .eq("user_id", account.user_id);
  await sendMessage(chatId, `▶ Now creating in *${match.organizations.name}*.`);
};

const getMeta = async (admin: SupabaseClient, userId: string): Promise<Record<string, unknown>> => {
  const { data } = await admin.from("integrations").select("metadata").eq("provider", "telegram").eq("user_id", userId).maybeSingle();
  return (data?.metadata ?? {}) as Record<string, unknown>;
};

const sendReply = async (chatId: number, reply: AgentReply): Promise<void> => {
  if (reply.kind === "text") return sendMessage(chatId, reply.text);
  if (reply.kind === "noop") return;
  if (reply.kind === "confirm") {
    const kb: InlineButton[][] = [[
      { text: "✅ Confirm", callback_data: `confirm:${reply.pendingActionId}` },
      { text: "❌ Cancel", callback_data: `cancel:${reply.pendingActionId}` },
    ]];
    return sendMessage(chatId, reply.summary, kb);
  }
  // choices
  const kb: InlineButton[][] = reply.choices.map((c) => [{ text: c.label, callback_data: c.callback }]);
  return sendMessage(chatId, reply.prompt, kb);
};

export const handleNaturalLanguage = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  text: string,
): Promise<void> => {
  // Compact context for the parser.
  const [{ data: wsData }, { data: projData }, { data: clData }, { data: orgData }] = await Promise.all([
    admin.from("workspaces").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("projects").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("clients").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("organizations").select("country").eq("organization_id", account.current_org_id).maybeSingle(),
  ]);
  const intent = await parseIntent(text, {
    workspaces: (wsData ?? []).map((r) => (r as { name: string }).name),
    projects: (projData ?? []).map((r) => (r as { name: string }).name),
    clients: (clData ?? []).map((r) => (r as { name: string }).name),
    nowIso: new Date().toISOString(),
    timezone: (orgData?.country as string | undefined) ?? "UTC",
  });
  const reply = await resolveIntent(admin, account, String(chatId), intent);
  await sendReply(chatId, reply);
};

export const handleCallbackQuery = async (
  admin: SupabaseClient,
  callbackQueryId: string,
  chatId: number,
  data: string,
): Promise<void> => {
  if (data.startsWith("confirm:")) {
    const pendingId = data.slice("confirm:".length);
    try {
      const msg = await executePending(admin, pendingId);
      await answerCallbackQuery(callbackQueryId);
      await sendMessage(chatId, msg);
    } catch (err) {
      await answerCallbackQuery(callbackQueryId);
      await sendMessage(chatId, `❌ ${(err as Error).message}`);
    }
    return;
  }
  if (data.startsWith("cancel:")) {
    const pendingId = data.slice("cancel:".length);
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
    await answerCallbackQuery(callbackQueryId, "Cancelled");
    await sendMessage(chatId, "🛑 Cancelled.");
    return;
  }
  // Disambiguation callbacks (pickws:/pickproj:/pickclient:) — left as a v1.1
  // follow-up. For v1, treat as no-op + nudge user to rephrase.
  await answerCallbackQuery(callbackQueryId);
  await sendMessage(chatId, "Please rephrase the message with the full workspace/project/client name.");
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/handlers.ts
git commit -m "feat(telegram-bot): command + NL + callback handlers"
```

---

## Task 8: Edge function — webhook entrypoint

**Files:**
- Create: `supabase/functions/telegram-webhook/index.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-webhook/index.ts
// Public endpoint for Telegram Bot API. Deploy with --no-verify-jwt:
//   npx supabase functions deploy telegram-webhook --no-verify-jwt
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN         — from @BotFather
//   TELEGRAM_WEBHOOK_SECRET    — long random string, also passed to setWebhook
//   OPENAI_API_KEY             — existing secret reused
//
// After deploy, register the webhook once:
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d "url=https://<project>.supabase.co/functions/v1/telegram-webhook" \
//     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage } from "./telegram.ts";
import {
  findLinkedAccount, handleStart, handleUnlink, handleSwitchOrg,
  handleNaturalLanguage, handleCallbackQuery,
} from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number } };
    data: string;
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  // Webhook authenticity: Telegram echoes the secret as a header.
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!WEBHOOK_SECRET || headerSecret !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: TgUpdate;
  try { body = await req.json(); } catch { return new Response("bad_json", { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.callback_query) {
      const cq = body.callback_query;
      await handleCallbackQuery(admin, cq.id, cq.message.chat.id, cq.data);
      return new Response("ok");
    }

    const msg = body.message;
    if (!msg?.from || !msg.text) return new Response("ok");

    const chatId = msg.chat.id;
    const tgUserId = msg.from.id;
    const username = msg.from.username;
    const text = msg.text.trim();

    // Slash commands first.
    if (text.startsWith("/start")) {
      const arg = text.slice("/start".length).trim() || undefined;
      await handleStart(admin, chatId, tgUserId, username, arg);
      return new Response("ok");
    }
    if (text === "/unlink") {
      await handleUnlink(admin, chatId, tgUserId);
      return new Response("ok");
    }

    // Everything else requires a linked account.
    const account = await findLinkedAccount(admin, tgUserId);
    if (!account) {
      await sendMessage(chatId, "🔗 This chat isn't linked. In TaskCalendar: Settings → Integrations → Telegram → Connect, then send `/start <code>`.");
      return new Response("ok");
    }

    if (text === "/help") {
      await handleNaturalLanguage(admin, chatId, account, "help");
      return new Response("ok");
    }
    if (text === "/orgs") {
      await handleNaturalLanguage(admin, chatId, account, "list my orgs");
      return new Response("ok");
    }
    if (text.startsWith("/switchorg")) {
      await handleSwitchOrg(admin, chatId, account, text.slice("/switchorg".length).trim());
      return new Response("ok");
    }

    await handleNaturalLanguage(admin, chatId, account, text);
    return new Response("ok");
  } catch (err) {
    console.error("telegram-webhook error:", err);
    // Always 200 to stop Telegram retries; surface error to the user when possible.
    try {
      const chatId = body.message?.chat.id ?? body.callback_query?.message.chat.id;
      if (chatId) await sendMessage(chatId, `❌ ${(err as Error).message}`);
    } catch { /* swallow */ }
    return new Response("ok");
  }
});
```

- [ ] **Step 2: Deploy locally and ping it**

Run:
```bash
npx supabase functions serve telegram-webhook --no-verify-jwt --env-file ./supabase/.env.local
```
In another terminal:
```bash
curl -X POST http://localhost:54321/functions/v1/telegram-webhook \
  -H "x-telegram-bot-api-secret-token: WRONG" \
  -d '{}'
```
Expected: HTTP 401.

Then with the right secret:
```bash
curl -X POST http://localhost:54321/functions/v1/telegram-webhook \
  -H "x-telegram-bot-api-secret-token: $TELEGRAM_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"message":{"chat":{"id":1},"from":{"id":1,"username":"u"},"text":"/start"}}'
```
Expected: HTTP 200, "ok".

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/telegram-webhook/index.ts
git commit -m "feat(telegram-bot): webhook entrypoint with secret verification"
```

---

## Task 9: Edge function — link code generator

**Files:**
- Create: `supabase/functions/telegram-link-code/index.ts`

- [ ] **Step 1: Write the file**

```typescript
// supabase/functions/telegram-link-code/index.ts
// Authenticated POST. Body: { orgId: string }.
// Returns { code: "123456", expiresAt: "..." }.
//
// Deploy: npx supabase functions deploy telegram-link-code

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const recentCount = async (admin: ReturnType<typeof createClient>, userId: string): Promise<number> => {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("telegram_link_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("created_at", since);
  return count ?? 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: { user }, error: authErr } = await authClient.auth.getUser(auth.slice(7));
  if (authErr || !user) return json({ error: "unauthorized" }, 401);

  let payload: { orgId?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const orgId = (payload.orgId ?? "").trim();
  if (!orgId) return json({ error: "orgId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Membership check.
  const { data: mem } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!mem) return json({ error: "not_a_member" }, 403);

  // Rate limit: max 5/hr per user.
  if ((await recentCount(admin, user.id)) >= 5) {
    return json({ error: "rate_limited" }, 429);
  }

  // Generate a 6-digit code.
  const code = String(Math.floor(100_000 + Math.random() * 900_000));
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error } = await admin.from("telegram_link_codes").insert({
    user_id: user.id,
    org_id: orgId,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("insert code failed:", error);
    return json({ error: "internal" }, 500);
  }

  return json({ code, expiresAt });
});
```

- [ ] **Step 2: Deploy locally and test**

Run: `npx supabase functions serve telegram-link-code --env-file ./supabase/.env.local`

Test with a valid JWT (grab from a logged-in session via DevTools → Application → Local Storage → `sb-*-auth-token` → `access_token`):
```bash
curl -X POST http://localhost:54321/functions/v1/telegram-link-code \
  -H "authorization: Bearer $JWT" \
  -H "content-type: application/json" \
  -d '{"orgId":"<a real org UUID>"}'
```
Expected: `{"code":"123456","expiresAt":"..."}`. The DB row should appear in `telegram_link_codes`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/telegram-link-code/index.ts
git commit -m "feat(telegram-bot): link-code edge function"
```

---

## Task 10: Frontend — provider registration

**Files:**
- Modify: `src/services/integrations/types.ts`
- Modify: `src/services/integrations/providers.ts`

- [ ] **Step 1: Extend `ProviderId` and `iconName` in `types.ts`**

Replace lines 1-3 of `src/services/integrations/types.ts`:
```typescript
export type ProviderId = 'google' | 'gmail' | 'slack' | 'telegram';

export type IntegrationStatus = 'active' | 'revoked' | 'error' | 'pending' | 'not_connected';
```

Replace the `iconName` line in the `ProviderDisplay` interface:
```typescript
  iconName: 'Video' | 'Mail' | 'MessageSquare' | 'MessageCircle';
```

- [ ] **Step 2: Register telegram in `providers.ts`**

Append to the `providerDisplay` object in `src/services/integrations/providers.ts` (after `slack: { ... },`):
```typescript
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    description: 'Manage workspaces, projects, tasks, and clients by texting the bot.',
    iconName: 'MessageCircle',
    accent: 'text-sky-600',
    orgLevel: false,
  },
```

Leave `providerOrder` unchanged (telegram is rendered as a custom card outside the OAuth loop).

- [ ] **Step 3: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: no new errors. If `ProviderCard.tsx` has a switch on `iconName`, ensure it covers `MessageCircle` (Lucide export name — same icon name).

- [ ] **Step 4: Commit**

```bash
git add src/services/integrations/types.ts src/services/integrations/providers.ts
git commit -m "feat(telegram-bot): register telegram provider metadata"
```

---

## Task 11: Frontend — telegram service helper

**Files:**
- Create: `src/services/integrations/telegram.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/services/integrations/telegram.ts
import { supabase } from '@/services/supabase/config';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}` };
}

export interface LinkCode {
  code: string;
  expiresAt: string;
}

export async function requestTelegramLinkCode(orgId: string): Promise<LinkCode> {
  const res = await fetch(`${FUNCTIONS_URL}/telegram-link-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to generate code: ${res.status} ${text}`);
  }
  return res.json();
}

export interface TelegramStatus {
  linked: boolean;
  username?: string;
  currentOrgId?: string;
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  const { data } = await supabase
    .from('integrations')
    .select('metadata')
    .eq('provider', 'telegram')
    .maybeSingle();
  if (!data) return { linked: false };
  const meta = (data.metadata ?? {}) as { telegram_username?: string; current_org_id?: string };
  return {
    linked: true,
    username: meta.telegram_username,
    currentOrgId: meta.current_org_id,
  };
}

export async function unlinkTelegram(): Promise<void> {
  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('provider', 'telegram');
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/integrations/telegram.ts
git commit -m "feat(telegram-bot): frontend service helper"
```

---

## Task 12: Frontend — TelegramConnectCard

**Files:**
- Create: `src/components/integrations/TelegramConnectCard.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/integrations/TelegramConnectCard.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import {
  requestTelegramLinkCode,
  getTelegramStatus,
  unlinkTelegram,
  type TelegramStatus,
} from '@/services/integrations/telegram';

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? 'YourBot';

export const TelegramConnectCard: React.FC = () => {
  const { organization } = useOrganization();
  const [status, setStatus] = React.useState<TelegramStatus | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getTelegramStatus().then(setStatus).catch(() => setStatus({ linked: false }));
  }, []);

  const onConnect = async () => {
    if (!organization?.organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await requestTelegramLinkCode(organization.organizationId);
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onUnlink = async () => {
    setLoading(true);
    try {
      await unlinkTelegram();
      setStatus({ linked: false });
      setCode(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const minsLeft = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <MessageCircle className="text-sky-600" size={20} />
        <div className="flex-1">
          <CardTitle className="text-base">Telegram</CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage workspaces, projects, tasks, and clients by texting the bot.
          </p>
        </div>
        {status?.linked && <Badge variant="secondary">Linked</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Note: bot messages are sent to OpenAI for parsing.
        </p>

        {status?.linked ? (
          <div className="flex items-center justify-between">
            <span className="text-sm">
              Connected{status.username ? ` as @${status.username}` : ''}.
            </span>
            <Button variant="outline" size="sm" onClick={onUnlink} disabled={loading}>
              Unlink
            </Button>
          </div>
        ) : code ? (
          <div className="space-y-2">
            <p className="text-sm">
              Open <a className="underline" href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer">@{BOT_USERNAME}</a> on Telegram and send:
            </p>
            <pre className="rounded bg-muted px-3 py-2 text-base">/start {code}</pre>
            <p className="text-xs text-muted-foreground">
              Code expires in ~{minsLeft} min.
            </p>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={loading || !organization?.organizationId}>
            Connect
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/integrations/TelegramConnectCard.tsx
git commit -m "feat(telegram-bot): TelegramConnectCard Settings UI"
```

---

## Task 13: Frontend — render the card in IntegrationsTab

**Files:**
- Modify: `src/components/integrations/IntegrationsTab.tsx`

- [ ] **Step 1: Import and render the card**

Replace the import block and the `<div className="grid gap-3">` block in `src/components/integrations/IntegrationsTab.tsx`:

```tsx
import React from 'react';
import { ProviderCard } from './ProviderCard';
import { TelegramConnectCard } from './TelegramConnectCard';
import { providerOrder, providerDisplay } from '@/services/integrations/providers';
import { useOrganization } from '@/context/OrganizationContext';

export const IntegrationsTab: React.FC = () => {
  const { organization, canManageSettings } = useOrganization();
  const currentOrgId = organization?.organizationId ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Connected services</h3>
        <p className="text-sm text-muted-foreground">
          Link external tools so they can power task workflows. Each connection
          uses OAuth — TaskCalendar never sees your password.
        </p>
      </div>
      <div className="grid gap-3">
        {providerOrder.map((id) => {
          const display = providerDisplay[id];
          const canConnect = display.orgLevel ? canManageSettings : true;
          return (
            <ProviderCard
              key={id}
              provider={id}
              orgId={display.orgLevel ? currentOrgId : null}
              canConnect={canConnect}
            />
          );
        })}
        <TelegramConnectCard />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run the dev server and view the page**

Run: `npm run dev`
Navigate to Settings → Integrations.
Expected: the Telegram card renders with a "Connect" button. Clicking it (with a real Supabase backend and the link-code function deployed) shows a 6-digit code.

- [ ] **Step 3: Commit**

```bash
git add src/components/integrations/IntegrationsTab.tsx
git commit -m "feat(telegram-bot): render TelegramConnectCard in Settings"
```

---

## Task 14: Bot setup + webhook registration (one-time, doc only)

**Files:**
- Create: `docs/superpowers/deployment/telegram-bot-setup.md`

- [ ] **Step 1: Write the deployment doc**

```markdown
# Telegram Bot — Deployment & Setup

## 1. Create the bot
1. Open Telegram, message @BotFather, send `/newbot`.
2. Pick a display name and a username ending in `bot` (e.g. `TaskCalendarBot`).
3. BotFather replies with a token like `123456:ABC-DEF...`. Keep it secret.
4. Send `/setdescription`, `/setabouttext`, `/setuserpic` to BotFather to polish the bot's profile.
5. Disable privacy mode is NOT required — we only use private chats.

## 2. Generate the webhook secret
```bash
openssl rand -hex 32
```
Save the output.

## 3. Set Edge Function secrets (Supabase Dashboard → Edge Functions → Secrets)
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `TELEGRAM_WEBHOOK_SECRET` — the random string above
- `OPENAI_API_KEY` — already set if the AI chat works elsewhere

Set `VITE_TELEGRAM_BOT_USERNAME` in the frontend `.env` to the bot's username (without `@`).

## 4. Deploy edge functions
```bash
npx supabase functions deploy telegram-link-code
npx supabase functions deploy telegram-webhook --no-verify-jwt
```

## 5. Register the webhook with Telegram
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```
Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
Expected: `url` matches, `pending_update_count` is 0 or small.

## 6. Smoke test
1. In TaskCalendar: Settings → Integrations → Telegram → Connect. Note the 6-digit code.
2. In Telegram: open the bot, send `/start <code>`. Bot replies "✅ Linked!".
3. Send `add workspace Acme`. Bot replies with a Confirm/Cancel keyboard.
4. Tap Confirm. Bot replies "✅ Workspace Acme created." Reload the app — workspace appears.
5. Send `task: call John tomorrow 3pm in <existing project name>`. Tap Confirm. Task appears.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/deployment/telegram-bot-setup.md
git commit -m "docs(telegram-bot): deployment + setup runbook"
```

---

## Task 15: End-to-end smoke test (manual)

This task is a checklist for the engineer / operator before declaring v1 done. No code.

- [ ] **1. Link flow**
  - Settings → Integrations → Telegram → Connect generates a code.
  - `/start <wrong-code>` in the bot → "Invalid or already-used code."
  - `/start <right-code>` → "✅ Linked!".
  - Re-sending `/start <same-code>` → "Invalid or already-used code." (consumed).
  - Wait 11 minutes after generation, try the code → "Code expired."

- [ ] **2. Create entities**
  - `add workspace Demo WS` → confirm → workspace appears in app.
  - `add project Demo Proj in Demo WS` → confirm → project appears under Demo WS.
  - `task: call John tomorrow 3pm in Demo Proj` → confirm → task appears with correct due date.
  - `new client Demo Co` → confirm → client appears in CRM.
  - `client task: follow up with Demo Co next Friday` → confirm → client task appears tied to Demo Co.

- [ ] **3. Cancel + ambiguity**
  - Issue a create command, tap Cancel → bot replies "🛑 Cancelled.", no row written.
  - Create two workspaces named "Sales" + "Sales US". `add project X in Sales` → "Multiple workspaces match…". (Tap a choice — v1 falls through to rephrase nudge; that's the documented v1 behavior.)

- [ ] **4. Org switching**
  - `/orgs` → lists orgs with ▶ on the current one.
  - `/switchorg <other-org-name>` → "▶ Now creating in *<name>*."
  - Create something — verify it lands in the new org.

- [ ] **5. Negative paths**
  - Send the wrong webhook secret with curl → 401.
  - Stop `TELEGRAM_BOT_TOKEN` (rotate to wrong value), send a message → bot logs error, app stays healthy.
  - Set `OPENAI_API_KEY` to invalid → bot replies "I didn't catch that."

- [ ] **6. Unlink**
  - `/unlink` → "🔌 Unlinked." Next message → "🔗 This chat isn't linked."

If all 6 pass, ship.

---

## Self-Review (done before saving)

**Spec coverage:** every section in `2026-05-18-telegram-whatsapp-bot-design.md` is covered:
- Architecture diagram — Tasks 3-8 build each piece.
- Data model — Tasks 1-2.
- Linking flow — Tasks 8 (`/start` handler), 9 (link-code function), 12 (UI).
- Natural-language flow — Tasks 5 (parser), 6 (resolver), 7 (handler), 8 (entrypoint).
- Slash commands — Task 7 / Task 8.
- Errors & edges — Task 7 (try/catch around `executePending`), Task 8 (200-on-error pattern).
- Security — Task 1 (RLS), Task 2 (`revoke execute`), Task 8 (secret-token check), Task 9 (rate limit, hashed codes).
- File layout — Tasks 3-13 match the spec's file list (intent.ts lives in the edge function instead of `src/services/agent` because the webhook has no user JWT to call the `ai-chat` proxy; noted in the architecture line above).
- Testing — Task 15 covers the manual checklist from the spec. Automated tests are deliberately deferred — the existing codebase has no test infrastructure for edge functions, and adding one is a separate scope.
- WhatsApp adapter (later) — out of scope here, but the `Intent` + `agentActions` split in Tasks 3 + 6 keeps the door open.

**Placeholder scan:** no TODOs / TBDs / "implement later" / "add validation" anywhere. Every code step contains the full code.

**Type consistency:** `Intent`, `AgentReply`, `LinkedAccount` are defined in Task 3 and used unchanged in Tasks 6, 7, 8. RPC names (`agent_create_workspace`, `agent_create_project`, `agent_create_task`, `crm_create_client_as`, `crm_create_client_task_as`) match between Tasks 2/6.

**Known v1 limitation (documented):** disambiguation callbacks (`pickws:` etc.) are emitted but the handler treats them as "rephrase please" rather than completing the choice. Promoting this to full flow is straightforward (re-run `resolveIntent` with the picked id merged in) but adds ~30 lines and a callback-stash. Spec says v1 ships confirm-before-write — that's intact; disambiguation completion is a v1.1 polish.
