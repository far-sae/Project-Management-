# Integration Features — Slack, Google Meet, Gmail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the three user-facing integrations on top of the shared framework already on `main`. Each phase is independently shippable.

**Architecture:** Plug into the existing `integrations-action` dispatcher (one new action handler per integration), the existing `integrations-webhook` router (one new provider handler per inbound provider), and the existing Settings → Integrations UI (each provider gets new feature surfaces — a meeting banner on tasks, a project channel picker, a notification preference). No new auth, no new token plumbing, no new tables for the framework itself.

**Tech Stack:** Same as framework — TypeScript, React 18, Vite, Supabase (Postgres + Edge Functions), shadcn/ui, Tailwind, Vitest. Three new deps land along the way: `email-reply-parser` (Gmail inbound), nothing else.

**Spec reference:** [docs/superpowers/specs/2026-05-15-platform-integrations-design.md](../specs/2026-05-15-platform-integrations-design.md)
**Framework reference:** [docs/superpowers/plans/2026-05-15-integrations-framework.md](2026-05-15-integrations-framework.md)
**Deployment reference:** [docs/superpowers/deployment/integrations-deployment-setup.md](../deployment/integrations-deployment-setup.md) — must be complete through Step 8 (smoke test) before this plan starts.

**Build order (phases are independent — pick one to ship first):**

| Phase | Integration | Why this order | Calendar time |
|---|---|---|---|
| A | Slack | No Google brand-verification dependency — ships immediately | Week 1 |
| B | Google Meet | Smallest Google integration — validates the verified-Google path | Week 2 |
| C | Gmail | Largest. Needs SendGrid inbound email; brand verification must be complete | Week 3–4 |

---

## Conventions used throughout this plan

- All commits use `feat:`, `chore:`, `fix:`, `test:` prefixes, signed with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Each phase begins on its own branch: `feature/integrations-slack`, `feature/integrations-meet`, `feature/integrations-gmail`.
- Migrations continue the sequence: `058_…`, `059_…`, etc.
- New Deno imports use the same `https://esm.sh/...` and `https://deno.land/std@0.168.0/...` versions already pinned in `supabase/functions/_shared/` and the other functions.
- All new server logic goes through the framework helpers (`getProviderTokens`, `verifyUser`, `json`, `preflight`) — do NOT duplicate auth or CORS code.

---
---

# PHASE A — Slack

## Phase A Overview

**Deliverables:**
1. Slack scopes registered in the server `providers.ts` (scopes: `chat:write`, `chat:write.public`, `commands`, `channels:read`, `groups:read`, `users:read`).
2. New `slack-post` action handler in `integrations-action` (posts a Block Kit message to a channel).
3. New `project_slack_links` table linking projects → Slack channels with per-event toggles.
4. Slack handler in `integrations-webhook` — signature verify, URL verification challenge, slash command (`/taskcalendar new`), message action.
5. UI: per-project "Slack channel" section in Project Settings; channel picker; event toggles.
6. Existing notification pipeline fans out a "Slack" delivery path whenever a project is linked.

**Phase A file map:**

| Path | Change |
|---|---|
| `supabase/migrations/058_project_slack_links.sql` | NEW |
| `supabase/functions/_shared/providers.ts` | MODIFY — add Slack scopes |
| `supabase/functions/_shared/slack-sign.ts` | NEW — Slack signature verifier |
| `supabase/functions/integrations-action/index.ts` | MODIFY — add `slack-post` action |
| `supabase/functions/integrations-webhook/index.ts` | MODIFY — add Slack handler |
| `supabase/functions/_shared/notify-slack.ts` | NEW — fan-out helper |
| `src/services/integrations/slack.ts` | NEW — channels list + link CRUD client |
| `src/components/integrations/SlackProjectSection.tsx` | NEW |
| `src/pages/ProjectSettings.tsx` (or wherever project settings live) | MODIFY |
| `src/services/notifications/dispatchSlack.ts` | NEW |
| `tests/unit/slack-sign.test.ts` | NEW |

---

## Phase A · Task 1: Add Slack scopes to server registry

**Files:**
- Modify: `supabase/functions/_shared/providers.ts`

- [ ] **Step 1.1: Update the Slack scopes array**

Open `supabase/functions/_shared/providers.ts`. The `slack` provider entry currently has `scopes: []`. Replace its `scopes` field with:

```typescript
scopes: [
  'chat:write',
  'chat:write.public',
  'commands',
  'channels:read',
  'groups:read',
  'users:read',
],
```

Leave the rest of the slack entry untouched.

- [ ] **Step 1.2: Commit**

```bash
git checkout -b feature/integrations-slack
git add supabase/functions/_shared/providers.ts
git commit -m "$(cat <<'EOF'
feat: add Slack OAuth scopes to provider registry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 2: Database migration — project_slack_links

**Files:**
- Create: `supabase/migrations/058_project_slack_links.sql`

- [ ] **Step 2.1: Write the migration**

Create `supabase/migrations/058_project_slack_links.sql`:

```sql
-- 058_project_slack_links.sql
-- One row per (project, Slack channel) pairing. Drives outbound posts:
-- the notifications pipeline checks this table whenever a task event
-- fires and posts to every linked channel whose event flag is true.

create table if not exists public.project_slack_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  org_id uuid not null references public.organizations(organization_id) on delete cascade,
  channel_id text not null,
  channel_name text,
  events jsonb not null default
    '{"created":true,"assigned":true,"completed":true,"comment":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, channel_id)
);

create index if not exists project_slack_links_project_idx
  on public.project_slack_links(project_id);

create index if not exists project_slack_links_org_idx
  on public.project_slack_links(org_id);

alter table public.project_slack_links enable row level security;

create policy "org members read project slack links"
  on public.project_slack_links for select
  using (public.is_org_member(org_id));

-- Writes restricted to org admins (mirrors the org-level Slack
-- integration's admin-only connect flow).
create policy "org admins manage project slack links"
  on public.project_slack_links for all
  using (public.is_org_admin_or_owner(org_id))
  with check (public.is_org_admin_or_owner(org_id));
```

- [ ] **Step 2.2: Commit**

```bash
git add supabase/migrations/058_project_slack_links.sql
git commit -m "$(cat <<'EOF'
feat: add project_slack_links table for per-project channel mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 3: Slack signature verifier (TDD)

**Files:**
- Create: `supabase/functions/_shared/slack-sign.ts`
- Create: `tests/unit/slack-sign.test.ts`

Slack signs every inbound request with HMAC-SHA256 over `v0:<timestamp>:<raw body>`. We MUST verify before processing or someone can post fake events.

- [ ] **Step 3.1: Write the failing tests**

Create `tests/unit/slack-sign.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { verifySlackSignature } from '../../supabase/functions/_shared/slack-sign';

const SECRET = '8f742231b10e8888abcd99yyyzz77789';

describe('verifySlackSignature', () => {
  it('accepts a valid signature', async () => {
    const timestamp = '1531420618';
    const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J';
    // Pre-computed: v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503
    const sig = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503';
    const ok = await verifySlackSignature({ timestamp, body, signature: sig, secret: SECRET });
    expect(ok).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const timestamp = '1531420618';
    const body = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J';
    const sig = 'v0=' + '0'.repeat(64);
    expect(
      await verifySlackSignature({ timestamp, body, signature: sig, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects when timestamp is too old (replay protection)', async () => {
    const ancient = Math.floor(Date.now() / 1000) - 60 * 6; // 6 minutes ago
    const body = 'x=1';
    // Don't even compute a valid signature; the timestamp check happens first
    expect(
      await verifySlackSignature({
        timestamp: ancient.toString(),
        body,
        signature: 'v0=irrelevant',
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects malformed signature header', async () => {
    expect(
      await verifySlackSignature({
        timestamp: Math.floor(Date.now() / 1000).toString(),
        body: 'x=1',
        signature: 'not-a-slack-sig',
        secret: SECRET,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run, verify it fails**

Run: `npx vitest run tests/unit/slack-sign.test.ts`
Expected: 4 failing tests, "Cannot find module."

- [ ] **Step 3.3: Write the implementation**

Create `supabase/functions/_shared/slack-sign.ts`:

```typescript
// Slack inbound request signature verification.
// See: https://api.slack.com/authentication/verifying-requests-from-slack
//
// Base string: "v0:" + timestamp + ":" + raw request body
// Signature:   "v0=" + hex(HMAC-SHA256(signing_secret, base))
//
// Replay protection: reject if timestamp is more than 5 minutes old.

const MAX_AGE_SECONDS = 60 * 5;

export interface SlackSignatureInput {
  timestamp: string;
  body: string;
  signature: string;
  secret: string;
}

export async function verifySlackSignature(
  input: SlackSignatureInput,
): Promise<boolean> {
  const ts = parseInt(input.timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_AGE_SECONDS) return false;

  if (!input.signature.startsWith('v0=')) return false;
  const provided = input.signature.slice(3); // hex digits

  const base = `v0:${input.timestamp}:${input.body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)),
  );
  const computed = Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time compare
  if (computed.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 3.4: Run, verify it passes**

Run: `npx vitest run tests/unit/slack-sign.test.ts`
Expected: 4 passing tests.

- [ ] **Step 3.5: Commit**

```bash
git add supabase/functions/_shared/slack-sign.ts tests/unit/slack-sign.test.ts
git commit -m "$(cat <<'EOF'
feat: add Slack request signature verifier

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 4: `slack-post` action handler

**Files:**
- Modify: `supabase/functions/integrations-action/index.ts`

- [ ] **Step 4.1: Add the slack-post action**

Open `supabase/functions/integrations-action/index.ts`. Find the `actions` constant. Add a new entry between `whoami` and the closing brace:

```typescript
  // Posts a Block Kit message to a Slack channel using the org's bot token.
  // payload: { channel: string, text: string, blocks?: any[] }
  'slack-post': async ({ tokens, payload }) => {
    const { channel, text, blocks } = payload ?? {};
    if (!channel || typeof channel !== 'string') {
      throw new Error('slack-post: channel required');
    }
    if (!text || typeof text !== 'string') {
      throw new Error('slack-post: text required');
    }
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, blocks }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string; ts?: string };
    if (!json.ok) throw new Error(`slack-post failed: ${json.error}`);
    return { ts: json.ts };
  },
```

- [ ] **Step 4.2: Verify type-check still clean**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 4.3: Commit**

```bash
git add supabase/functions/integrations-action/index.ts
git commit -m "$(cat <<'EOF'
feat: add slack-post action to integrations-action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 5: Slack handler in `integrations-webhook`

**Files:**
- Modify: `supabase/functions/integrations-webhook/index.ts`

The handler needs to: verify the Slack signature, return the URL-verification challenge if present, dispatch on `command` (slash) and `block_actions` / `view_submission` (modal) to the right business logic. Phase A only ships the slash command `/taskcalendar new <title>`. Message actions and modal submits ship in a Phase A extension or follow-up.

- [ ] **Step 5.1: Replace the entire webhook handler**

Rewrite `supabase/functions/integrations-webhook/index.ts` with:

```typescript
// Edge Function: integrations-webhook
// POST /integrations-webhook?provider=slack|gmail-inbound|...
//
// Provider routing:
//  - provider=slack         → Slack events / commands (signature-verified)
//  - provider=gmail-inbound → SendGrid Inbound Parse (added by Gmail plan)
//  - other                  → log to integration_events and return 200

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { json, preflight } from '../_shared/cors.ts';
import { verifySlackSignature } from '../_shared/slack-sign.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const provider = new URL(req.url).searchParams.get('provider');
  if (!provider) return json({ error: 'provider query param required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Server configuration error' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const rawBody = await req.text();

  if (provider === 'slack') {
    return await handleSlack(req, rawBody, supabase);
  }

  // Default: log and return 200 (Gmail-inbound handler added by Phase C)
  await logEvent(supabase, provider, crypto.randomUUID(), rawBody);
  return json({ ok: true });
});

async function handleSlack(
  req: Request,
  rawBody: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<Response> {
  const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
  if (!signingSecret) return json({ error: 'SLACK_SIGNING_SECRET not set' }, 500);

  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  const signature = req.headers.get('x-slack-signature') ?? '';
  const ok = await verifySlackSignature({
    timestamp,
    body: rawBody,
    signature,
    secret: signingSecret,
  });
  if (!ok) return json({ error: 'invalid signature' }, 401);

  // Slack sends slash commands as application/x-www-form-urlencoded.
  // Event payloads use application/json. Parse accordingly.
  const ct = req.headers.get('content-type') ?? '';
  let payload: Record<string, unknown> = {};
  if (ct.includes('application/json')) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'invalid json' }, 400);
    }
  } else {
    const params = new URLSearchParams(rawBody);
    payload = Object.fromEntries(params.entries());
  }

  // URL verification challenge (one-time, when configuring Event Subscriptions)
  if (payload.type === 'url_verification') {
    return new Response(payload.challenge as string, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Slash command: /taskcalendar new <title>
  if (typeof payload.command === 'string') {
    const teamId = payload.team_id as string | undefined;
    const userId = payload.user_id as string | undefined;
    const text = ((payload.text as string) ?? '').trim();
    if (payload.command === '/taskcalendar') {
      return await handleTaskCalendarCommand(supabase, teamId, userId, text);
    }
    return new Response(
      `Unknown command: ${payload.command}`,
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // Anything else (events): log and acknowledge.
  await logEvent(supabase, 'slack', String(payload.event_id ?? crypto.randomUUID()), rawBody);
  return json({ ok: true });
}

async function handleTaskCalendarCommand(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  teamId: string | undefined,
  _slackUserId: string | undefined,
  text: string,
): Promise<Response> {
  // Look up org by team_id from any active slack integration.
  const { data: integration } = await supabase
    .from('integrations')
    .select('org_id, metadata')
    .eq('provider', 'slack')
    .eq('status', 'active')
    .contains('metadata', { team_id: teamId })
    .maybeSingle();

  if (!integration?.org_id) {
    return new Response(
      "TaskCalendar isn't connected to this Slack workspace. Have an admin connect it in Settings → Integrations.",
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // Parse: "new <title>"
  const match = text.match(/^new\s+(.+)/i);
  if (!match) {
    return new Response(
      'Usage: /taskcalendar new <title>',
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    );
  }
  const title = match[1].trim();

  // Determine project: pick the most recently linked project for this org.
  const { data: link } = await supabase
    .from('project_slack_links')
    .select('project_id')
    .eq('org_id', integration.org_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!link?.project_id) {
    return new Response(
      `Created task "${title}" — but no project is linked to a Slack channel in this org yet, so it landed in inbox-only. Link a project in TaskCalendar → Project Settings → Slack.`,
      { status: 200, headers: { 'Content-Type': 'text/plain' } },
    );
  }

  // Insert the task. Schema columns mirror the existing `tasks` table.
  // The Slack user's identity isn't a TaskCalendar user so we attribute to null.
  const { error } = await supabase
    .from('tasks')
    .insert({
      project_id: link.project_id,
      title,
      created_by: null,
      source: 'slack',
    });
  if (error) {
    return new Response(`Could not create task: ${error.message}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(
    `Created task "${title}" in your linked project.`,
    { status: 200, headers: { 'Content-Type': 'text/plain' } },
  );
}

async function logEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  provider: string,
  externalEventId: string,
  rawBody: string,
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }
  await supabase.from('integration_events').insert({
    provider,
    external_event_id: externalEventId,
    payload,
    processed_at: new Date().toISOString(),
  });
}
```

Note: The `tasks` insert assumes columns `(project_id, title, created_by, source)`. If your actual `tasks` table uses different column names, adjust the insert. To check, run:

```bash
grep -n "create table.*tasks\|alter table.*tasks add column" supabase/migrations/*.sql | head -20
```

If `source` doesn't exist as a column, add it via a new tiny migration `059_tasks_source_column.sql`:

```sql
alter table public.tasks
  add column if not exists source text;
```

Adjust the rest of the columns to match what `tasks` actually has.

- [ ] **Step 5.2: If a source-column migration was needed, create and commit it**

```bash
git add supabase/migrations/059_tasks_source_column.sql
git commit -m "$(cat <<'EOF'
feat: add tasks.source column for external task origins

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.3: Commit the webhook rewrite**

```bash
git add supabase/functions/integrations-webhook/index.ts
git commit -m "$(cat <<'EOF'
feat: add Slack handler to integrations-webhook (slash command + signature)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 6: Notification fan-out helper for Slack

**Files:**
- Create: `supabase/functions/_shared/notify-slack.ts`

When the existing notification pipeline fires a "task assigned" or "comment added" event, we want any project linked to a Slack channel to get a chat message. The helper below loads the project's links and invokes the `slack-post` action for each link where the event flag is true.

- [ ] **Step 6.1: Create the helper**

Create `supabase/functions/_shared/notify-slack.ts`:

```typescript
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getProviderTokens } from './tokens.ts';

export type SlackEventKey = 'created' | 'assigned' | 'completed' | 'comment';

interface ProjectLink {
  channel_id: string;
  events: Record<string, boolean>;
}

/**
 * Posts a Block Kit message to every channel linked to `projectId` whose
 * `events[eventKey]` flag is true. Best-effort: per-channel failures are
 * logged but don't block other channels.
 */
export async function notifySlackForProject(args: {
  supabase: SupabaseClient;
  orgId: string;
  projectId: string;
  eventKey: SlackEventKey;
  text: string;
  // deno-lint-ignore no-explicit-any
  blocks?: any[];
}): Promise<void> {
  // Find the org's connected Slack admin and load their token.
  const { data: integration } = await args.supabase
    .from('integrations')
    .select('user_id')
    .eq('provider', 'slack')
    .eq('org_id', args.orgId)
    .eq('status', 'active')
    .maybeSingle();

  if (!integration?.user_id) {
    return; // Slack not connected for this org — silently skip.
  }

  let tokens;
  try {
    tokens = await getProviderTokens(args.supabase, integration.user_id, 'slack');
  } catch {
    return;
  }

  const { data: links } = await args.supabase
    .from('project_slack_links')
    .select('channel_id, events')
    .eq('project_id', args.projectId);
  if (!links) return;

  const targets = (links as ProjectLink[]).filter((l) => l.events?.[args.eventKey]);
  await Promise.all(
    targets.map(async (link) => {
      try {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: link.channel_id,
            text: args.text,
            blocks: args.blocks,
          }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!json.ok) console.warn(`slack post to ${link.channel_id} failed: ${json.error}`);
      } catch (err) {
        console.warn(`slack post to ${link.channel_id} threw:`, err);
      }
    }),
  );
}
```

- [ ] **Step 6.2: Commit**

```bash
git add supabase/functions/_shared/notify-slack.ts
git commit -m "$(cat <<'EOF'
feat: add notify-slack fan-out helper for project channels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6.3: Wire it into the notifications pipeline**

The existing notifications pipeline lives in the codebase already (RPC `create_notification`, etc.). Wherever notifications fire on `task_created`, `task_assigned`, `task_completed`, `comment_added`, add a call to `notifySlackForProject`. Find the existing notification call sites:

```bash
grep -n "create_notification\|notifyUser" supabase/functions/*/index.ts src/services/notifications/**/*.ts 2>/dev/null
```

For each call site, after the existing notification logic, add a parallel call:

```typescript
import { notifySlackForProject } from '../_shared/notify-slack.ts';

// Inside the handler, after creating the in-app notification:
await notifySlackForProject({
  supabase,
  orgId,
  projectId,
  eventKey: 'assigned', // or 'created' / 'completed' / 'comment'
  text: `Task assigned: ${taskTitle} → ${assigneeName}`,
});
```

The `text` field should be a one-line human-readable summary. If you want richer formatting, add a `blocks` argument with Block Kit JSON (see https://api.slack.com/block-kit).

- [ ] **Step 6.4: Commit the wire-in changes**

```bash
git add <modified files>
git commit -m "$(cat <<'EOF'
feat: fan out task notifications to linked Slack channels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 7: Client API — Slack channels and links

**Files:**
- Create: `src/services/integrations/slack.ts`

- [ ] **Step 7.1: Create the client module**

Create `src/services/integrations/slack.ts`:

```typescript
import { supabase } from '@/services/supabase/config';
import { callAction } from './api';

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface SlackProjectLink {
  id: string;
  project_id: string;
  channel_id: string;
  channel_name: string | null;
  events: {
    created: boolean;
    assigned: boolean;
    completed: boolean;
    comment: boolean;
  };
}

/**
 * Calls the slack-list-channels action (added below) and returns parsed channels.
 * The action loads the org's bot token and calls Slack's conversations.list.
 */
export async function listSlackChannels(): Promise<SlackChannel[]> {
  return callAction<SlackChannel[]>('slack', 'list-channels');
}

export async function listProjectLinks(projectId: string): Promise<SlackProjectLink[]> {
  const { data, error } = await supabase
    .from('project_slack_links')
    .select('*')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as SlackProjectLink[];
}

export async function createProjectLink(args: {
  projectId: string;
  orgId: string;
  channelId: string;
  channelName: string;
}): Promise<SlackProjectLink> {
  const { data, error } = await supabase
    .from('project_slack_links')
    .insert({
      project_id: args.projectId,
      org_id: args.orgId,
      channel_id: args.channelId,
      channel_name: args.channelName,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SlackProjectLink;
}

export async function updateLinkEvents(
  linkId: string,
  events: SlackProjectLink['events'],
): Promise<void> {
  const { error } = await supabase
    .from('project_slack_links')
    .update({ events, updated_at: new Date().toISOString() })
    .eq('id', linkId);
  if (error) throw error;
}

export async function deleteProjectLink(linkId: string): Promise<void> {
  const { error } = await supabase
    .from('project_slack_links')
    .delete()
    .eq('id', linkId);
  if (error) throw error;
}
```

- [ ] **Step 7.2: Add the `slack-list-channels` action to `integrations-action/index.ts`**

In `supabase/functions/integrations-action/index.ts`, add to the `actions` object:

```typescript
  'list-channels': async ({ tokens }) => {
    const channels: { id: string; name: string; isPrivate: boolean }[] = [];
    let cursor: string | undefined = undefined;
    do {
      const url = new URL('https://slack.com/api/conversations.list');
      url.searchParams.set('types', 'public_channel,private_channel');
      url.searchParams.set('exclude_archived', 'true');
      url.searchParams.set('limit', '200');
      if (cursor) url.searchParams.set('cursor', cursor);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        channels?: { id: string; name: string; is_private: boolean }[];
        response_metadata?: { next_cursor?: string };
      };
      if (!json.ok) throw new Error(`conversations.list failed: ${json.error}`);
      for (const c of json.channels ?? []) {
        channels.push({ id: c.id, name: c.name, isPrivate: c.is_private });
      }
      cursor = json.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return channels;
  },
```

- [ ] **Step 7.3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/services/integrations/slack.ts supabase/functions/integrations-action/index.ts
git commit -m "$(cat <<'EOF'
feat: add Slack client API and list-channels action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 8: `SlackProjectSection` component

**Files:**
- Create: `src/components/integrations/SlackProjectSection.tsx`

- [ ] **Step 8.1: Write the component**

Create `src/components/integrations/SlackProjectSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { MessageSquare, Trash2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  listSlackChannels,
  listProjectLinks,
  createProjectLink,
  updateLinkEvents,
  deleteProjectLink,
  type SlackChannel,
  type SlackProjectLink,
} from '@/services/integrations/slack';
import { useIntegration } from '@/hooks/useIntegration';
import { useOrganization } from '@/context/OrganizationContext';

interface Props {
  projectId: string;
}

const EVENT_LABELS: Record<keyof SlackProjectLink['events'], string> = {
  created: 'Task created',
  assigned: 'Task assigned',
  completed: 'Task completed',
  comment: 'Comment added',
};

export const SlackProjectSection: React.FC<Props> = ({ projectId }) => {
  const { organization, canManageSettings } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { status } = useIntegration('slack');
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [links, setLinks] = useState<SlackProjectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string>('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (status === 'active') {
          const [chans, lks] = await Promise.all([
            listSlackChannels(),
            listProjectLinks(projectId),
          ]);
          if (active) {
            setChannels(chans);
            setLinks(lks);
          }
        } else {
          if (active) {
            setChannels(null);
            setLinks([]);
          }
        }
      } catch (e) {
        toast.error(`Slack load failed: ${(e as Error).message}`);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status, projectId]);

  if (status !== 'active') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-violet-600" />
            Slack
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Slack isn't connected to this workspace. An admin can connect it in{' '}
            <a href="/settings?tab=integrations" className="underline">
              Settings → Integrations
            </a>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  const addLink = async () => {
    if (!selectedChannel || !orgId) return;
    const channel = channels?.find((c) => c.id === selectedChannel);
    if (!channel) return;
    try {
      const link = await createProjectLink({
        projectId,
        orgId,
        channelId: channel.id,
        channelName: channel.name,
      });
      setLinks([...links, link]);
      setSelectedChannel('');
      toast.success(`Linked #${channel.name}`);
    } catch (e) {
      toast.error(`Could not link channel: ${(e as Error).message}`);
    }
  };

  const toggleEvent = async (
    link: SlackProjectLink,
    key: keyof SlackProjectLink['events'],
  ) => {
    const next = { ...link.events, [key]: !link.events[key] };
    setLinks(links.map((l) => (l.id === link.id ? { ...l, events: next } : l)));
    try {
      await updateLinkEvents(link.id, next);
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
      // Revert UI on failure
      setLinks(links.map((l) => (l.id === link.id ? link : l)));
    }
  };

  const removeLink = async (link: SlackProjectLink) => {
    try {
      await deleteProjectLink(link.id);
      setLinks(links.filter((l) => l.id !== link.id));
      toast.success(`Removed #${link.channel_name}`);
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-violet-600" />
          Slack
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {canManageSettings && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">
                    Add channel
                  </Label>
                  <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a Slack channel…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(channels ?? [])
                        .filter((c) => !links.some((l) => l.channel_id === c.id))
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.isPrivate ? '🔒 ' : '#'}
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={addLink} disabled={!selectedChannel}>
                  Link
                </Button>
              </div>
            )}

            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No channels linked yet.
              </p>
            ) : (
              <div className="space-y-3">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">#{link.channel_name}</span>
                      {canManageSettings && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLink(link)}
                          aria-label="Remove link"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(EVENT_LABELS) as (keyof SlackProjectLink['events'])[]).map(
                        (key) => (
                          <div key={key} className="flex items-center gap-2">
                            <Switch
                              checked={link.events[key]}
                              onCheckedChange={() => toggleEvent(link, key)}
                              disabled={!canManageSettings}
                              id={`${link.id}-${key}`}
                            />
                            <Label
                              htmlFor={`${link.id}-${key}`}
                              className="text-sm"
                            >
                              {EVENT_LABELS[key]}
                            </Label>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 8.2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero new errors. If `Select` isn't imported correctly, confirm the file at `src/components/ui/select.tsx` exists; it should because Settings already uses Select.

- [ ] **Step 8.3: Commit**

```bash
git add src/components/integrations/SlackProjectSection.tsx
git commit -m "$(cat <<'EOF'
feat: add SlackProjectSection for per-project channel link UI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 9: Wire `SlackProjectSection` into project settings

**Files:**
- Modify: the existing project settings page (look it up first)

- [ ] **Step 9.1: Locate the project settings page**

The codebase has per-project settings somewhere. Find it:

```bash
grep -rn "Project.*[Ss]ettings\|/projects/.*/settings" src/pages src/components 2>&1 | head -20
```

If a project settings page exists, modify it. If project settings are inline in `ProjectView.tsx` or similar, add a new section there.

- [ ] **Step 9.2: Add the import + component**

In the project settings file, add:

```tsx
import { SlackProjectSection } from '@/components/integrations/SlackProjectSection';
```

Then render it somewhere inside the project's settings layout, passing `projectId`:

```tsx
<SlackProjectSection projectId={project.id} />
```

If the project settings file uses a tabbed layout, place the section in the most relevant tab (likely "General" or a new "Integrations" sub-tab if you want isolation).

- [ ] **Step 9.3: Commit**

```bash
git add <modified files>
git commit -m "$(cat <<'EOF'
feat: surface Slack channel section in project settings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase A · Task 10: Verification

- [ ] **Step 10.1: Run tests**

```bash
npm run test
```

Expected: 12 passing tests (8 framework + 4 slack-sign).

- [ ] **Step 10.2: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 10.3: Deploy the modified Edge Functions**

```bash
npx supabase functions deploy integrations-action integrations-webhook
npx supabase db push --linked
```

- [ ] **Step 10.4: Manual smoke test (requires Slack OAuth app from deployment guide)**

1. As an org admin, connect Slack in Settings → Integrations
2. Open a project, scroll to its Slack section
3. Pick a channel from the dropdown, click Link
4. Toggle one or more events
5. In TaskCalendar, create a task in that project → confirm a Slack message arrived in the linked channel
6. In Slack, type `/taskcalendar new Test task` → confirm a task appears in the most-recently-linked project

If any step fails, check the relevant Edge Function logs:

```bash
npx supabase functions logs integrations-webhook --tail
npx supabase functions logs integrations-action --tail
```

- [ ] **Step 10.5: Merge & ship Phase A**

```bash
git checkout main
git merge --no-ff feature/integrations-slack
git push origin main
git branch -d feature/integrations-slack
```

**Phase A complete.** Slack integration is live.

---
---

# PHASE B — Google Meet

## Phase B Overview

**Deliverables:**
1. Google scope set in `providers.ts` updated to `calendar.events`, `openid`, `email`, `profile`.
2. `create-meet` action handler that creates a Google Calendar event with a Meet conference URL.
3. Connected-account display: store the connected user's Gmail address in `integrations.metadata.email` (extracted from the openid `id_token`).
4. UI: `MeetingPanel` component on the task detail view; "Add Google Meet" button when task has a date/time; banner with Join/Copy when meeting exists.
5. Re-sync button when task date/assignees change.

**Phase B file map:**

| Path | Change |
|---|---|
| `supabase/functions/_shared/providers.ts` | MODIFY — Google scopes |
| `supabase/functions/oauth-callback/index.ts` | MODIFY — extract email from id_token for Google providers |
| `supabase/functions/integrations-action/index.ts` | MODIFY — add `create-meet`, `update-meet` actions |
| `src/services/integrations/meet.ts` | NEW |
| `src/components/integrations/MeetingPanel.tsx` | NEW |
| `src/pages/<task detail>` or task modal | MODIFY |

---

## Phase B · Task 1: Add Google scopes

**Files:**
- Modify: `supabase/functions/_shared/providers.ts`

- [ ] **Step 1.1: Set Google + Gmail scopes**

Open `supabase/functions/_shared/providers.ts`. Update the `google` and `gmail` entries:

```typescript
  google: {
    // ... existing fields ...
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  gmail: {
    // ... existing fields ...
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
```

- [ ] **Step 1.2: Commit**

```bash
git checkout -b feature/integrations-meet
git add supabase/functions/_shared/providers.ts
git commit -m "$(cat <<'EOF'
feat: set Google + Gmail OAuth scopes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 2: Extract connected email from `id_token` in `oauth-callback`

**Files:**
- Modify: `supabase/functions/oauth-callback/index.ts`

Google's token response includes an `id_token` JWT when the `openid` scope is requested. The JWT payload contains `email`. We decode (don't need to verify the signature for our purposes — Google's token endpoint already authenticated the response) and stash the email in `integrations.metadata.email` so the ProviderCard shows "Connected as alice@gmail.com".

- [ ] **Step 2.1: Add a JWT-decode helper and use it**

In `supabase/functions/oauth-callback/index.ts`, find the section that builds `metadata`:

```typescript
  const metadata: Record<string, unknown> = {};
  if (tokenJson.team?.id) metadata.team_id = tokenJson.team.id;
  if (tokenJson.team?.name) metadata.team_name = tokenJson.team.name;
```

Replace with:

```typescript
  const metadata: Record<string, unknown> = {};
  if (tokenJson.team?.id) metadata.team_id = tokenJson.team.id;
  if (tokenJson.team?.name) metadata.team_name = tokenJson.team.name;
  // Google: id_token is a JWT; the middle segment is base64url-encoded JSON
  // containing `email`. We don't need to verify the signature here — the
  // token came over TLS from Google's token endpoint, which is trust-anchored
  // by our client secret.
  if (tokenJson.id_token) {
    try {
      const parts = (tokenJson.id_token as string).split('.');
      if (parts.length === 3) {
        const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
        const json = JSON.parse(atob(pad));
        if (typeof json.email === 'string') metadata.email = json.email;
      }
    } catch (err) {
      console.warn('id_token decode failed', err);
    }
  }
```

Also widen the `tokenJson` type:

```typescript
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string; // <-- add this
    authed_user?: { access_token?: string };
    team?: { id?: string; name?: string };
  };
```

- [ ] **Step 2.2: Commit**

```bash
git add supabase/functions/oauth-callback/index.ts
git commit -m "$(cat <<'EOF'
feat: extract connected email from Google id_token

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 3: `create-meet` and `update-meet` actions

**Files:**
- Modify: `supabase/functions/integrations-action/index.ts`

- [ ] **Step 3.1: Add the action handlers**

In `supabase/functions/integrations-action/index.ts`, add to the `actions` object:

```typescript
  // Creates a Google Calendar event with a Meet conference link.
  // payload: { taskId, title, startIso, endIso, attendees: string[], description?: string }
  // Returns: { eventId, meetLink, htmlLink }
  'create-meet': async ({ supabase, tokens, payload, userId }) => {
    const { taskId, title, startIso, endIso, attendees, description } = payload ?? {};
    if (!taskId || !title || !startIso || !endIso) {
      throw new Error('create-meet: taskId, title, startIso, endIso required');
    }
    const body = {
      summary: title,
      description: description ?? '',
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      attendees: (Array.isArray(attendees) ? attendees : []).map((email: string) => ({
        email,
      })),
      conferenceData: {
        createRequest: {
          requestId: `tc-${taskId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`create-meet failed: ${res.status} ${await res.text()}`);
    }
    const event = (await res.json()) as {
      id: string;
      hangoutLink?: string;
      htmlLink?: string;
    };
    if (!event.hangoutLink) {
      throw new Error('create-meet: no hangoutLink returned (Meet may be disabled on this Google Workspace)');
    }

    // Persist on the task.
    const { error } = await supabase
      .from('tasks')
      .update({
        google_meet_link: event.hangoutLink,
        google_event_id: event.id,
      })
      .eq('id', taskId);
    if (error) throw error;

    return { eventId: event.id, meetLink: event.hangoutLink, htmlLink: event.htmlLink };
  },

  // Updates an existing Calendar event (re-sync after task title/date/assignees change).
  // payload: { taskId, eventId, title, startIso, endIso, attendees }
  'update-meet': async ({ tokens, payload }) => {
    const { eventId, title, startIso, endIso, attendees } = payload ?? {};
    if (!eventId || !title || !startIso || !endIso) {
      throw new Error('update-meet: eventId, title, startIso, endIso required');
    }
    const body = {
      summary: title,
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      attendees: (Array.isArray(attendees) ? attendees : []).map((email: string) => ({
        email,
      })),
    };
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`update-meet failed: ${res.status} ${await res.text()}`);
    }
    return { ok: true };
  },
```

- [ ] **Step 3.2: Commit**

```bash
git add supabase/functions/integrations-action/index.ts
git commit -m "$(cat <<'EOF'
feat: add create-meet and update-meet actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 4: Client API for Meet

**Files:**
- Create: `src/services/integrations/meet.ts`

- [ ] **Step 4.1: Write the module**

Create `src/services/integrations/meet.ts`:

```typescript
import { callAction } from './api';

export interface CreateMeetResult {
  eventId: string;
  meetLink: string;
  htmlLink?: string;
}

export async function createMeet(args: {
  taskId: string;
  title: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  description?: string;
}): Promise<CreateMeetResult> {
  return callAction<CreateMeetResult>('google', 'create-meet', args);
}

export async function updateMeet(args: {
  taskId: string;
  eventId: string;
  title: string;
  startIso: string;
  endIso: string;
  attendees: string[];
}): Promise<void> {
  await callAction('google', 'update-meet', args);
}
```

- [ ] **Step 4.2: Commit**

```bash
git add src/services/integrations/meet.ts
git commit -m "$(cat <<'EOF'
feat: add Meet client API

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 5: `MeetingPanel` component

**Files:**
- Create: `src/components/integrations/MeetingPanel.tsx`

- [ ] **Step 5.1: Write the component**

Create `src/components/integrations/MeetingPanel.tsx`:

```tsx
import React, { useState } from 'react';
import { Video, ExternalLink, Copy, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { createMeet, updateMeet } from '@/services/integrations/meet';
import { useIntegration } from '@/hooks/useIntegration';

export interface TaskMeetingFields {
  id: string;
  title: string;
  /** ISO timestamp for the meeting start. If null, no meeting can be created yet. */
  startsAt: string | null;
  /** ISO timestamp for the meeting end. */
  endsAt: string | null;
  assigneeEmails: string[];
  description?: string;
  googleMeetLink: string | null;
  googleEventId: string | null;
}

interface Props {
  task: TaskMeetingFields;
  /** Called after the task is updated server-side so the parent can re-fetch. */
  onChange?: () => void;
}

export const MeetingPanel: React.FC<Props> = ({ task, onChange }) => {
  const { status } = useIntegration('google');
  const [busy, setBusy] = useState(false);

  const canSchedule =
    status === 'active' && !!task.startsAt && !!task.endsAt;

  const handleCreate = async () => {
    if (!task.startsAt || !task.endsAt) return;
    setBusy(true);
    try {
      const result = await createMeet({
        taskId: task.id,
        title: task.title,
        startIso: task.startsAt,
        endIso: task.endsAt,
        attendees: task.assigneeEmails,
        description: task.description,
      });
      toast.success('Meeting scheduled');
      navigator.clipboard?.writeText(result.meetLink).catch(() => {});
      onChange?.();
    } catch (e) {
      toast.error(`Meeting failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleResync = async () => {
    if (!task.googleEventId || !task.startsAt || !task.endsAt) return;
    setBusy(true);
    try {
      await updateMeet({
        taskId: task.id,
        eventId: task.googleEventId,
        title: task.title,
        startIso: task.startsAt,
        endIso: task.endsAt,
        attendees: task.assigneeEmails,
      });
      toast.success('Meeting updated');
      onChange?.();
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (task.googleMeetLink) {
    return (
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Video className="h-5 w-5 text-emerald-600" />
            <div className="flex-1">
              <div className="text-sm font-medium">Google Meet</div>
              <a
                href={task.googleMeetLink}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-muted-foreground underline"
              >
                {task.googleMeetLink}
              </a>
            </div>
            <Button asChild size="sm">
              <a
                href={task.googleMeetLink}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Join
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(task.googleMeetLink!);
                toast.success('Link copied');
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResync}
              disabled={busy}
              aria-label="Re-sync to Calendar"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!canSchedule) {
    return null; // No meeting and either Google not connected or no date set.
  }

  return (
    <Button variant="outline" onClick={handleCreate} disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Video className="h-4 w-4 mr-2" />
      )}
      Add Google Meet
    </Button>
  );
};
```

- [ ] **Step 5.2: Commit**

```bash
git add src/components/integrations/MeetingPanel.tsx
git commit -m "$(cat <<'EOF'
feat: add MeetingPanel for task detail view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 6: Wire `MeetingPanel` into the task detail view

**Files:**
- Modify: wherever task detail / task modal lives

- [ ] **Step 6.1: Locate the task detail surface**

```bash
grep -rn "TaskModal\|TaskDetail\|task.title.*Description" src/components 2>&1 | head -10
```

The framework spec mentions `TaskModal-ssVWX10O.js` in the bundle, so there's likely `src/components/.../TaskModal.tsx`. Find the file and add the import + render.

- [ ] **Step 6.2: Render `MeetingPanel`**

Inside the task detail layout, after the description/comments block:

```tsx
import { MeetingPanel } from '@/components/integrations/MeetingPanel';

// ... inside render, build the TaskMeetingFields shape from the existing task object:
<MeetingPanel
  task={{
    id: task.id,
    title: task.title,
    startsAt: task.startsAt ?? null,  // adapt to your actual field name
    endsAt: task.endsAt ?? null,
    assigneeEmails: task.assignees?.map((a) => a.email) ?? [],
    description: task.description,
    googleMeetLink: task.googleMeetLink ?? null,
    googleEventId: task.googleEventId ?? null,
  }}
  onChange={refetchTask /* the existing handler that re-loads this task */}
/>
```

If the task object doesn't have `startsAt` / `endsAt` directly (only a single `dueDate`), pick a sensible default duration:

```tsx
startsAt: task.dueDate ?? null,
endsAt: task.dueDate
  ? new Date(new Date(task.dueDate).getTime() + 30 * 60 * 1000).toISOString()
  : null,
```

(30-minute default meeting length anchored to the due date.)

Also update the client's task query to SELECT the two new columns `google_meet_link` and `google_event_id` if it doesn't already (the migration in framework Task 2 added them).

- [ ] **Step 6.3: Commit**

```bash
git add <modified files>
git commit -m "$(cat <<'EOF'
feat: surface MeetingPanel on task detail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B · Task 7: Verification + ship

- [ ] **Step 7.1: Tests + type-check + build**

```bash
npm run test    # still 12 passing
npx tsc --noEmit
npm run build
```

- [ ] **Step 7.2: Deploy**

```bash
npx supabase functions deploy oauth-callback integrations-action
```

- [ ] **Step 7.3: Manual smoke test**

1. Reconnect Google (the new scopes require re-consent — the connected user will need to revoke + reconnect once)
2. Verify the Google card now shows "Connected as you@gmail.com" (from the id_token email)
3. Open a task with a due date + time → "Add Google Meet" button appears
4. Click → toast says "Meeting scheduled", task shows the Meet link card
5. Click the Join button → opens Google Meet
6. Edit the task title → click Re-sync → confirm in Google Calendar that the event title updated

- [ ] **Step 7.4: Merge & ship**

```bash
git checkout main
git merge --no-ff feature/integrations-meet
git push origin main
git branch -d feature/integrations-meet
```

**Phase B complete.**

---
---

# PHASE C — Gmail

## Phase C Overview

**Deliverables:**
1. New notification preference: "Send my outgoing notifications via my Gmail" — per-user, default off.
2. `send-email` action that composes an RFC 2822 message and POSTs to Gmail's send endpoint.
3. Reply routing: outbound mail carries a `Reply-To: reply+task_<hmac>@<inbound-domain>`.
4. SendGrid Inbound Parse webhook handler in `integrations-webhook` (signature verified).
5. Reply parser strips quoted text and creates a comment on the matching task.
6. Forward-to-sender: post a notification email to the original sender's Gmail inbox.
7. UI: notification preference toggle in Settings → Notifications; "via email" badge on email-originated comments.

**Phase C prerequisites:**
- SendGrid Inbound Parse configured (deployment guide Step 4)
- `SENDGRID_API_KEY` and `SENDGRID_INBOUND_SECRET` set as Supabase secrets
- `INBOUND_DOMAIN` env var (e.g., `inbound.taskcalendar.app`) set as Supabase secret
- Google brand verification complete (gmail.send is a sensitive scope)

**Phase C file map:**

| Path | Change |
|---|---|
| `supabase/migrations/060_comments_source.sql` | NEW — `comments.source`, `comments.from_email` |
| `supabase/migrations/061_notification_prefs_gmail.sql` | NEW — pref column |
| `supabase/functions/_shared/reply-token.ts` | NEW — HMAC reply-To token |
| `supabase/functions/_shared/reply-parse.ts` | NEW — strip quoted text |
| `supabase/functions/_shared/sendgrid-sign.ts` | NEW — SendGrid signature verifier |
| `supabase/functions/integrations-action/index.ts` | MODIFY — add `send-email` |
| `supabase/functions/integrations-webhook/index.ts` | MODIFY — add gmail-inbound handler |
| `src/services/notifications/dispatchEmail.ts` | MODIFY (or new) — route via Gmail if enabled |
| `src/components/settings/NotificationPreferences.tsx` | MODIFY — add toggle |
| `tests/unit/reply-token.test.ts`, `reply-parse.test.ts`, `sendgrid-sign.test.ts` | NEW |

---

## Phase C · Task 1: Migrations

**Files:**
- Create: `supabase/migrations/060_comments_source.sql`
- Create: `supabase/migrations/061_notification_prefs_gmail.sql`

- [ ] **Step 1.1: comments source migration**

Create `supabase/migrations/060_comments_source.sql`:

```sql
-- 060_comments_source.sql
-- Adds source metadata to comments so email-originated replies can be
-- attributed correctly and rendered with a "via email" badge.

alter table public.comments
  add column if not exists source text,                 -- 'web' | 'email' | 'slack' | null
  add column if not exists from_email text,             -- raw email for guest authors
  add column if not exists external_message_id text;    -- Gmail Message-ID, for de-dup
```

If your `comments` table is named differently (e.g., `task_comments`), adjust the table name.

```bash
git checkout -b feature/integrations-gmail
git add supabase/migrations/060_comments_source.sql
git commit -m "$(cat <<'EOF'
feat: add source/from_email/external_message_id to comments

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.2: notification prefs migration**

Locate where notification preferences live. Per `src/lib/notificationPreferences.ts` they appear to be stored client-side in a profile row's JSON. If so, no migration needed — only an interface update. Verify:

```bash
grep -n "user_notification_prefs\|notification_preferences" supabase/migrations/*.sql src/lib/notificationPreferences.ts
```

If prefs are JSON on a `profiles` row, update `src/lib/notificationPreferences.ts` to add `sendViaGmail: boolean` to the `UserNotificationPreferences` type and the `DEFAULT_NOTIFICATION_PREFERENCES` constant. No SQL migration needed.

If prefs are a separate column on a separate table, create `supabase/migrations/061_notification_prefs_gmail.sql` adding `send_via_gmail boolean default false`. Adjust accordingly.

```bash
git add <whichever file changed>
git commit -m "$(cat <<'EOF'
feat: add sendViaGmail user notification preference

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 2: Reply-To HMAC token (TDD)

**Files:**
- Create: `supabase/functions/_shared/reply-token.ts`
- Create: `tests/unit/reply-token.test.ts`

The Reply-To address is `reply+task_<taskId>_<hmac>@<inbound-domain>`. The HMAC binds the taskId to a senderId so an attacker can't construct an arbitrary token that posts comments on any task. Inbound parsing validates the HMAC before persisting the comment.

- [ ] **Step 2.1: Write failing tests**

Create `tests/unit/reply-token.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signReplyToken, verifyReplyToken } from '../../supabase/functions/_shared/reply-token';

const SECRET = 'test-reply-secret-256-bits-long';

describe('reply-token', () => {
  it('round-trips taskId + senderId', async () => {
    const token = await signReplyToken({ taskId: 't_1', senderId: 'u_2' }, SECRET);
    const decoded = await verifyReplyToken(token, SECRET);
    expect(decoded).toEqual({ taskId: 't_1', senderId: 'u_2' });
  });

  it('rejects a tampered taskId', async () => {
    const token = await signReplyToken({ taskId: 't_1', senderId: 'u_2' }, SECRET);
    const [payload, sig] = token.split('.');
    // Swap one char in the payload
    const tampered =
      payload.slice(0, -1) + (payload.slice(-1) === 'a' ? 'b' : 'a') + '.' + sig;
    await expect(verifyReplyToken(tampered, SECRET)).rejects.toThrow();
  });

  it('rejects a different secret', async () => {
    const token = await signReplyToken({ taskId: 't_x', senderId: 'u_y' }, SECRET);
    await expect(verifyReplyToken(token, 'other')).rejects.toThrow();
  });
});
```

- [ ] **Step 2.2: Run, verify fail**

Run: `npx vitest run tests/unit/reply-token.test.ts`
Expected: 3 failing tests.

- [ ] **Step 2.3: Implementation**

Create `supabase/functions/_shared/reply-token.ts`:

```typescript
// HMAC-signed reply token used in Reply-To addresses.
// Format: <b64url(JSON payload)>.<b64url(HMAC-SHA256 over payload)>

export interface ReplyPayload {
  taskId: string;
  senderId: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signReplyToken(p: ReplyPayload, secret: string): Promise<string> {
  const json = JSON.stringify(p);
  const payloadB64 = b64urlEncode(new TextEncoder().encode(json));
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export async function verifyReplyToken(token: string, secret: string): Promise<ReplyPayload> {
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('reply-token: malformed');
  const [payloadB64, sigB64] = parts;
  const key = await importHmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) throw new Error('reply-token: invalid signature');
  return JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as ReplyPayload;
}
```

- [ ] **Step 2.4: Verify and commit**

```bash
npx vitest run tests/unit/reply-token.test.ts  # 3 passing
git add supabase/functions/_shared/reply-token.ts tests/unit/reply-token.test.ts
git commit -m "$(cat <<'EOF'
feat: add HMAC reply-token for Gmail Reply-To routing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 3: Reply text parser (TDD)

**Files:**
- Create: `supabase/functions/_shared/reply-parse.ts`
- Create: `tests/unit/reply-parse.test.ts`

Strip the quoted-thread tail from a reply so the comment we save is JUST the new content.

- [ ] **Step 3.1: Write failing tests**

Create `tests/unit/reply-parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractReplyText } from '../../supabase/functions/_shared/reply-parse';

describe('extractReplyText', () => {
  it('strips Gmail "On ... wrote:" trailer', () => {
    const input = `Looks good, thanks!\n\nOn Mon, May 6, 2024 at 11:23 AM Alice <alice@x.com> wrote:\n> Original message here\n> Second line\n`;
    expect(extractReplyText(input)).toBe('Looks good, thanks!');
  });

  it('strips Outlook "-----Original Message-----" trailer', () => {
    const input = `Approved.\n\n-----Original Message-----\nFrom: alice@x.com\nSent: ...\nSubject: ...\n> Hello\n`;
    expect(extractReplyText(input)).toBe('Approved.');
  });

  it('strips Apple Mail "On ... at ... wrote:" trailer', () => {
    const input = `Yes please.\n\nOn May 6, 2024, at 11:23 AM, alice@x.com wrote:\n> Original\n`;
    expect(extractReplyText(input)).toBe('Yes please.');
  });

  it('strips plain "> " quote-line tail when no header was detected', () => {
    const input = `Quick reply.\n\n> previous email line\n> second line\n`;
    expect(extractReplyText(input)).toBe('Quick reply.');
  });

  it('returns the input as-is when no quote markers found', () => {
    const input = 'Just a clean reply.';
    expect(extractReplyText(input)).toBe('Just a clean reply.');
  });

  it('strips trailing whitespace and blank lines', () => {
    expect(extractReplyText('hi  \n\n\n')).toBe('hi');
  });
});
```

- [ ] **Step 3.2: Run, verify fail**

Run: `npx vitest run tests/unit/reply-parse.test.ts`
Expected: 6 failing tests.

- [ ] **Step 3.3: Implementation**

Create `supabase/functions/_shared/reply-parse.ts`:

```typescript
// Strips the quoted-thread tail from an email reply body so the resulting
// text is just the user's new content.

const HEADER_PATTERNS: RegExp[] = [
  // Gmail: "On Mon, May 6, 2024 at 11:23 AM Alice <alice@x.com> wrote:"
  /^On .{1,200}\bwrote:\s*$/m,
  // Apple Mail: "On May 6, 2024, at 11:23 AM, alice@x.com wrote:"
  /^On .{1,200} at .{1,40} wrote:\s*$/m,
  // Outlook: "-----Original Message-----"
  /^-{2,}\s*Original Message\s*-{2,}\s*$/m,
  // Outlook (sometimes localized): "From: ..."
  /^From: .+\nSent: .+\n(To|Subject): /m,
];

export function extractReplyText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n');

  // Find earliest header match and cut at its position.
  let cutAt: number | null = null;
  for (const re of HEADER_PATTERNS) {
    const m = re.exec(text);
    if (m && (cutAt === null || m.index < cutAt)) cutAt = m.index;
  }
  if (cutAt !== null) {
    text = text.slice(0, cutAt);
  }

  // Strip any trailing block of "> " quoted lines.
  text = text.replace(/(?:^>.*\n?)+$/m, '');

  return text.replace(/[ \t]+$/gm, '').replace(/\n{2,}$/g, '').trim();
}
```

- [ ] **Step 3.4: Verify and commit**

```bash
npx vitest run tests/unit/reply-parse.test.ts  # 6 passing
git add supabase/functions/_shared/reply-parse.ts tests/unit/reply-parse.test.ts
git commit -m "$(cat <<'EOF'
feat: add email reply quoted-text parser

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 4: SendGrid signature verifier (TDD)

**Files:**
- Create: `supabase/functions/_shared/sendgrid-sign.ts`
- Create: `tests/unit/sendgrid-sign.test.ts`

SendGrid Inbound Parse signs requests with an ECDSA over a public/private keypair generated when you enable signed-event verification. The simpler alternative — and what we'll use — is the `X-Twilio-Email-Event-Webhook-Signature` HMAC mode set up in SendGrid Inbound Parse settings. This task implements the HMAC variant.

For this plan we'll use a simpler shared-secret HMAC scheme: SendGrid Inbound Parse can be configured with a "Basic Auth username" / "password" arrangement on the webhook URL, OR pass a shared secret in a custom header. We'll use a path-shared-secret approach: append `?secret=<value>` to the webhook URL and verify on receipt.

- [ ] **Step 4.1: Write failing test**

Create `tests/unit/sendgrid-sign.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { verifySendgridSecret } from '../../supabase/functions/_shared/sendgrid-sign';

describe('verifySendgridSecret', () => {
  it('accepts the matching secret', () => {
    expect(verifySendgridSecret('abc123', 'abc123')).toBe(true);
  });

  it('rejects a different secret', () => {
    expect(verifySendgridSecret('abc123', 'wrong')).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(verifySendgridSecret('', 'x')).toBe(false);
    expect(verifySendgridSecret('x', '')).toBe(false);
  });

  it('uses constant-time compare (length mismatch fails fast)', () => {
    expect(verifySendgridSecret('short', 'much-longer-secret')).toBe(false);
  });
});
```

- [ ] **Step 4.2: Run, fail, write**

Create `supabase/functions/_shared/sendgrid-sign.ts`:

```typescript
// Verifies a shared secret passed by SendGrid Inbound Parse as a query param.
// Configure SendGrid to POST to:
//   https://<project>.supabase.co/functions/v1/integrations-webhook?provider=gmail-inbound&secret=<SENDGRID_INBOUND_SECRET>

export function verifySendgridSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
```

Run `npx vitest run tests/unit/sendgrid-sign.test.ts` → 4 passing.

```bash
git add supabase/functions/_shared/sendgrid-sign.ts tests/unit/sendgrid-sign.test.ts
git commit -m "$(cat <<'EOF'
feat: add SendGrid inbound shared-secret verifier

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 5: `send-email` action

**Files:**
- Modify: `supabase/functions/integrations-action/index.ts`

- [ ] **Step 5.1: Add the action**

Add to the `actions` object in `integrations-action/index.ts`:

```typescript
  // Sends an email via the user's Gmail account (gmail.send scope).
  // payload: { to: string[], subject: string, html: string, taskId: string, fromName?: string }
  // Returns: { messageId }
  'send-email': async ({ tokens, payload, userId }) => {
    const { to, subject, html, taskId, fromName } = payload ?? {};
    if (!Array.isArray(to) || to.length === 0) throw new Error('send-email: to[] required');
    if (!subject || !html || !taskId) throw new Error('send-email: subject/html/taskId required');

    const replySecret = Deno.env.get('REPLY_TOKEN_SECRET');
    const inboundDomain = Deno.env.get('INBOUND_DOMAIN');
    if (!replySecret || !inboundDomain) {
      throw new Error('REPLY_TOKEN_SECRET and INBOUND_DOMAIN required');
    }

    // Import locally to avoid hoisting cost at function startup.
    const { signReplyToken } = await import('../_shared/reply-token.ts');
    const replyToken = await signReplyToken({ taskId, senderId: userId }, replySecret);
    const replyTo = `reply+task_${replyToken}@${inboundDomain}`;

    const fromEmail = (tokens.metadata as { email?: string })?.email;
    if (!fromEmail) throw new Error('send-email: connected account email missing');

    // RFC 2822 message
    const headers = [
      `From: ${fromName ? `"${fromName}" <${fromEmail}>` : fromEmail}`,
      `To: ${to.join(', ')}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
    ];
    const message = headers.join('\r\n') + html;
    const raw = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );
    if (!res.ok) throw new Error(`send-email failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return { messageId: json.id };
  },
```

- [ ] **Step 5.2: Commit**

```bash
git add supabase/functions/integrations-action/index.ts
git commit -m "$(cat <<'EOF'
feat: add send-email Gmail action with HMAC Reply-To routing

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 6: Inbound webhook handler

**Files:**
- Modify: `supabase/functions/integrations-webhook/index.ts`

Add a `gmail-inbound` branch that verifies the SendGrid secret, parses the multipart form, extracts the Reply-To token, looks up the task, strips quoted text, and inserts a comment.

- [ ] **Step 6.1: Replace the default branch with a routed branch**

In the existing `serve(...)` body, after the `handleSlack` branch, add BEFORE the default `logEvent` call:

```typescript
  if (provider === 'gmail-inbound') {
    return await handleGmailInbound(req, rawBody, supabase);
  }
```

Then add the handler function at the bottom of the file:

```typescript
async function handleGmailInbound(
  req: Request,
  // rawBody is the entire multipart payload — SendGrid Inbound Parse format.
  rawBody: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<Response> {
  const expectedSecret = Deno.env.get('SENDGRID_INBOUND_SECRET');
  const replySecret = Deno.env.get('REPLY_TOKEN_SECRET');
  const inboundDomain = Deno.env.get('INBOUND_DOMAIN');
  if (!expectedSecret || !replySecret || !inboundDomain) {
    return json({ error: 'Server configuration error' }, 500);
  }
  const provided = new URL(req.url).searchParams.get('secret') ?? '';
  const { verifySendgridSecret } = await import('../_shared/sendgrid-sign.ts');
  if (!verifySendgridSecret(provided, expectedSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }

  // SendGrid Inbound Parse posts multipart/form-data. Parse via FormData.
  // The Request body has already been consumed as text (rawBody), so we
  // re-construct a Request to use the FormData parser. A simpler approach
  // is to re-read the body — but req has already been drained. SendGrid's
  // payload arrives as form fields like: from, to, subject, text, html, etc.
  // To avoid the re-parse complexity, configure SendGrid to send JSON:
  //   In SendGrid Inbound Parse settings, enable "Send Raw" = OFF and use the
  //   default URL-encoded form. We can parse the rawBody as form data:
  const params = new URLSearchParams(rawBody.includes('=') && !rawBody.startsWith('--') ? rawBody : '');

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const text = params.get('text') ?? '';

  // Extract reply token from To: "reply+task_<token>@inbound.foo.app"
  const replyMatch = to.match(/reply\+task_([^@]+)@/);
  if (!replyMatch) {
    return json({ ok: true, ignored: 'no reply token in To' });
  }
  const replyToken = replyMatch[1];

  let payload: { taskId: string; senderId: string };
  try {
    const { verifyReplyToken } = await import('../_shared/reply-token.ts');
    payload = await verifyReplyToken(replyToken, replySecret);
  } catch {
    return json({ ok: true, ignored: 'invalid reply token' });
  }

  // Strip quoted text
  const { extractReplyText } = await import('../_shared/reply-parse.ts');
  const body = extractReplyText(text);
  if (!body) return json({ ok: true, ignored: 'empty body after parse' });

  // Parse the from header for the bare email
  const fromEmail = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

  // Insert the comment. Attribution: try to map fromEmail to a known user;
  // otherwise leave user_id null and rely on from_email for display.
  const { data: existingUser } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('email', fromEmail)
    .maybeSingle();

  const { error } = await supabase.from('comments').insert({
    task_id: payload.taskId,
    user_id: existingUser?.user_id ?? null,
    body,
    source: 'email',
    from_email: fromEmail,
  });
  if (error) {
    console.error('comments insert failed', error);
    return json({ ok: true, error: error.message });
  }

  // Forward a copy of the reply to the original sender's Gmail. Best-effort.
  try {
    const { getProviderTokens } = await import('../_shared/tokens.ts');
    const tokens = await getProviderTokens(supabase, payload.senderId, 'gmail');
    const senderEmail = (tokens.metadata as { email?: string })?.email;
    if (senderEmail) {
      const forwardSubject = `Reply on task — ${body.slice(0, 60)}`;
      const forwardHtml = `
        <p><strong>${fromEmail}</strong> replied:</p>
        <blockquote style="margin:0 0 0 1em; padding-left:1em; border-left:3px solid #ccc;">${body.replace(/\n/g, '<br>')}</blockquote>
      `;
      const headers = [
        `From: TaskCalendar <${senderEmail}>`,
        `To: ${senderEmail}`,
        `Subject: ${forwardSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
      ];
      const raw = btoa(unescape(encodeURIComponent(headers.join('\r\n') + forwardHtml)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      });
    }
  } catch (err) {
    console.warn('forward-to-sender failed:', err);
  }

  return json({ ok: true });
}
```

- [ ] **Step 6.2: Commit**

```bash
git add supabase/functions/integrations-webhook/index.ts
git commit -m "$(cat <<'EOF'
feat: add Gmail inbound handler to integrations-webhook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 7: Route notifications through Gmail when enabled

**Files:**
- Modify: `src/services/email/emailService.ts` (or wherever EmailJS is called)
- Modify: `src/lib/notificationPreferences.ts` (add `sendViaGmail` pref)

- [ ] **Step 7.1: Add the preference**

In `src/lib/notificationPreferences.ts`, update:

```typescript
export interface UserNotificationPreferences {
  // ... existing fields ...
  sendViaGmail: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  // ... existing fields ...
  sendViaGmail: false,
};
```

Update any normalization helpers (`normalizeNotificationPreferences`) to default missing values.

- [ ] **Step 7.2: Branch the email send path**

Wherever notifications currently call `emailService.send(...)`, branch on the user's `sendViaGmail` preference + their Gmail connection status:

```typescript
import { callAction } from '@/services/integrations/api';
import { listIntegrations } from '@/services/integrations/api';

async function dispatchEmail(args: {
  recipientEmail: string;
  subject: string;
  html: string;
  senderUserId: string;
  taskId: string;
  fromName?: string;
}) {
  const prefs = /* load prefs for senderUserId */;
  if (prefs.sendViaGmail) {
    const integrations = await listIntegrations();
    const gmail = integrations.find((i) => i.provider === 'gmail' && i.status === 'active');
    if (gmail) {
      await callAction('gmail', 'send-email', {
        to: [args.recipientEmail],
        subject: args.subject,
        html: args.html,
        taskId: args.taskId,
        fromName: args.fromName,
      });
      return;
    }
  }
  // Fallback to existing EmailJS path:
  await emailService.send(args);
}
```

Find the existing call sites:

```bash
grep -rn "emailService\.send\|sendTaskAssignedEmail" src/services src/components 2>&1 | head -10
```

Wrap each with the branching logic above.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/notificationPreferences.ts src/services/email/emailService.ts <other files>
git commit -m "$(cat <<'EOF'
feat: route outbound notifications through user's Gmail when enabled

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 8: Notification preference toggle UI

**Files:**
- Modify: `src/pages/Settings.tsx` (notifications tab) or whichever subcomponent renders the prefs

- [ ] **Step 8.1: Add the toggle**

Locate where existing notification prefs are rendered (each pref shows as a `Switch` + `Label`). Add a new row:

```tsx
import { Mail } from 'lucide-react';
import { useIntegration } from '@/hooks/useIntegration';

const { status: gmailStatus } = useIntegration('gmail');

// In the render, inside the notifications prefs section:
<div className="flex items-center justify-between">
  <div className="space-y-1">
    <Label htmlFor="send-via-gmail" className="flex items-center gap-2">
      <Mail className="h-4 w-4 text-rose-600" />
      Send my notifications via my Gmail
    </Label>
    <p className="text-sm text-muted-foreground">
      {gmailStatus === 'active'
        ? 'Notification emails will be sent from your Gmail address. Recipients can reply and their reply lands as a task comment.'
        : (<>Requires Gmail connection. <a href="/settings?tab=integrations" className="underline">Connect Gmail</a> first.</>)
      }
    </p>
  </div>
  <Switch
    id="send-via-gmail"
    checked={notificationPreferences.sendViaGmail}
    onCheckedChange={(v) => updatePref('sendViaGmail', v)}
    disabled={gmailStatus !== 'active'}
  />
</div>
```

- [ ] **Step 8.2: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
feat: add "Send via my Gmail" notification preference toggle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 9: "via email" badge on comments

**Files:**
- Modify: wherever comments are rendered (likely `src/components/comments/...` or inline in task detail)

- [ ] **Step 9.1: Find the comment component**

```bash
grep -rn "comment\.body\|comments?\.map" src/components src/pages 2>&1 | head -10
```

In the comment component, when the comment row's `source === 'email'`, render a small Badge next to the author name:

```tsx
import { Badge } from '@/components/ui/badge';
import { Mail } from 'lucide-react';

{comment.source === 'email' && (
  <Badge variant="secondary" className="ml-2 gap-1">
    <Mail className="h-3 w-3" />
    via email
  </Badge>
)}
```

If `comment.user_id` is null and `comment.from_email` is set, display the bare email as the author name instead of the linked user profile.

- [ ] **Step 9.2: Commit**

```bash
git add <modified files>
git commit -m "$(cat <<'EOF'
feat: show "via email" badge on email-originated comments

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C · Task 10: Verification + ship

- [ ] **Step 10.1: Tests + type-check + build**

```bash
npm run test    # 12 + 3 + 6 + 4 = 25 passing
npx tsc --noEmit
npm run build
```

- [ ] **Step 10.2: Deploy**

```bash
npx supabase functions deploy oauth-callback integrations-action integrations-webhook
npx supabase db push --linked
```

Also configure SendGrid Inbound Parse to point at:
```
https://<project>.supabase.co/functions/v1/integrations-webhook?provider=gmail-inbound&secret=<SENDGRID_INBOUND_SECRET>
```
(or set up via deployment guide Step 4 if you skipped it earlier.)

- [ ] **Step 10.3: Manual smoke test**

1. Connect Gmail in Settings → Integrations
2. Settings → Notifications → toggle "Send my notifications via my Gmail" ON
3. From a teammate's account, assign a task to an external email address (e.g., your personal Gmail)
4. Check the external Gmail inbox → email arrives from you, with Reply-To: `reply+task_…@inbound.<your-domain>`
5. Reply to the email
6. Wait ~30 seconds; refresh the task in TaskCalendar → reply appears as a comment with "via email" badge
7. Check the teammate's Gmail → forwarded notification of the reply arrived

- [ ] **Step 10.4: Merge & ship**

```bash
git checkout main
git merge --no-ff feature/integrations-gmail
git push origin main
git branch -d feature/integrations-gmail
```

**Phase C complete.** All three integrations are now live.

---
---

## Cross-phase spec coverage

| Spec section | Phase | Where in plan |
|---|---|---|
| Slack: workspace-level OAuth | A | Framework Plan (already shipped); scopes set in Phase A Task 1 |
| Slack: per-project channel link | A | Tasks 2, 7, 8 |
| Slack: slash command | A | Task 5 |
| Slack: message action | A | Out of scope here — easy follow-up (add a `view_submission` branch to the webhook + a Slack app message action shortcut config) |
| Slack: outbound notifications | A | Task 6 (fan-out helper) |
| Google Meet: Calendar event creation | B | Task 3 |
| Google Meet: task UI banner with Join/Copy | B | Task 5 |
| Google Meet: re-sync on task changes | B | Task 5 (Re-sync button) |
| Gmail: send via user's Gmail | C | Task 5 |
| Gmail: Reply-To routing | C | Tasks 2, 5 |
| Gmail: inbound parse + comment creation | C | Tasks 3, 4, 6 |
| Gmail: forward-to-sender | C | Task 6 |
| Gmail: notification toggle | C | Tasks 7, 8 |
| Gmail: via-email badge | C | Task 9 |

---

## What's deferred to V2

- `gmail.readonly` + CASA audit → native Gmail thread sync into sender's inbox
- Google Calendar two-way sync of all task due dates (not just meetings)
- Slack message action (right-click → Create TaskCalendar task) — small follow-up to Phase A
- Per-user Slack DMs for personal notifications (Phase A is channel-only)
- Outlook, Teams, Zoom — replicate the pattern with their OAuth scopes

Each is its own focused follow-up plan once these three ship.
