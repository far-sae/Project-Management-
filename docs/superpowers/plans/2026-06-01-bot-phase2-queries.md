# Bot Phase 2 — Read / List Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bot answer read-only questions — "show my open tasks", "deals closing this month", "upcoming meetings", "recent leads".

**Architecture:** Add a single generic `query` action to the shared intent schema. A new `_shared/agent/query.ts` runs org-scoped `select`s with optional `scope`/`timeframe`/`status`/`stage` filters and formats a compact list (cap 10, "+N more" footer) using Phase 1's `formatLocal`. `resolveIntent` returns the formatted text directly — reads need no confirm.

**Tech Stack:** Deno edge functions, Supabase JS client, OpenAI intent parser. Tests via `deno test`.

**Reference spec:** [docs/superpowers/specs/2026-06-01-bot-power-expansion-design.md](../specs/2026-06-01-bot-power-expansion-design.md) §4 (Read/list queries).

**Depends on:** Phase 1 (`format.ts`).

**v1 simplifications (documented, not silent):** `scope:"mine"` filters by `created_by`/owner column only (not jsonb `assignees`); timeframe day boundaries are computed in the user's timezone via an offset helper.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/functions/_shared/agent/types.ts` | Add `query` action + `entity`/`scope`/`timeframe` fields | Modify |
| `supabase/functions/_shared/agent/intent.ts` | Parser schema + examples for `query` | Modify |
| `supabase/functions/_shared/agent/query.ts` | `runQuery` + timeframe helper + per-entity formatters | Create |
| `supabase/functions/_shared/agent/query_test.ts` | Tests | Create |
| `supabase/functions/_shared/agent/agentActions.ts` | `query` case in `resolveIntent` | Modify |

---

## Task 1: Add `query` action + fields to the Intent type

**Files:**
- Modify: `supabase/functions/_shared/agent/types.ts`

- [ ] **Step 1: Add `query` to `AgentActionType`**

In `types.ts`, add `"query"` to the union (next to `"list_orgs"`):

```typescript
  | "query"
  | "switch_org"
```

- [ ] **Step 2: Add query fields to `Intent`**

In the `Intent` interface, add (above `resolved_ids`):

```typescript
  // Query (read) fields.
  entity?:
    | "task" | "client_task" | "deal" | "lead" | "client" | "meeting" | "call"
    | null;
  scope?: "mine" | "all" | null;
  timeframe?: "today" | "this_week" | "this_month" | "overdue" | "upcoming" | null;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/agent/types.ts
git commit -m "feat(bot): add query action + entity/scope/timeframe to Intent"
```

---

## Task 2: Teach the parser to emit `query`

**Files:**
- Modify: `supabase/functions/_shared/agent/intent.ts`

- [ ] **Step 1: Add the new fields to the JSON schema in the system prompt**

In `intent.ts`, the `SYSTEM_PROMPT` schema lists fields. Add these three lines inside the schema object (after `"body": string | null,`):

```
  "entity": "task" | "client_task" | "deal" | "lead" | "client" | "meeting" | "call" | null,
  "scope": "mine" | "all" | null,
  "timeframe": "today" | "this_week" | "this_month" | "overdue" | "upcoming" | null,
```

And add `"query"` to the `"action"` enum line.

- [ ] **Step 2: Add the query routing rules + examples**

In `SYSTEM_PROMPT`, add a new section before "Utility:":

```
Read / list queries → action "query":
- "show my open tasks" / "what's due today" / "my tasks this week" → query, entity=task, scope=mine, (timeframe/status as stated)
- "tasks in <project>" → query, entity=task, project=<project>
- "deals closing this month" / "open deals" / "my deals" → query, entity=deal, (timeframe=this_month / scope=mine), stage if named
- "recent leads" / "new leads this week" → query, entity=lead, timeframe=this_week
- "list clients" / "show accounts" → query, entity=client
- "my meetings today" / "upcoming meetings" → query, entity=meeting, (timeframe), scope=mine
- "recent calls" → query, entity=call
Map "open" tasks to no specific status (the resolver excludes done); "done"/"completed" → status="done".
```

- [ ] **Step 3: Add few-shot examples**

Append to the numbered few-shot list:

```
12. "show my open tasks"
    → {"action":"query","entity":"task","scope":"mine","confidence":0.9}
13. "deals closing this month"
    → {"action":"query","entity":"deal","timeframe":"this_month","confidence":0.9}
14. "upcoming meetings"
    → {"action":"query","entity":"meeting","timeframe":"upcoming","confidence":0.9}
15. "recent leads"
    → {"action":"query","entity":"lead","timeframe":"this_week","confidence":0.85}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/agent/intent.ts
git commit -m "feat(bot): parser emits query intents"
```

---

## Task 3: `query.ts` — run reads + format results

**Files:**
- Create: `supabase/functions/_shared/agent/query.ts`
- Test: `supabase/functions/_shared/agent/query_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/agent/query_test.ts`:

```typescript
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { timeframeRange, runQuery } from "./query.ts";
import type { Intent, LinkedAccount } from "./types.ts";

const NOW = "2026-06-01T12:00:00Z";
const ACCOUNT: LinkedAccount = { user_id: "u1", current_org_id: "org1", external_id: "c1" };

Deno.test("timeframeRange: overdue is everything before start-of-today", () => {
  const r = timeframeRange(NOW, "UTC", "overdue");
  assertEquals(r, { lt: "2026-06-01T00:00:00.000Z" });
});

Deno.test("timeframeRange: today is the local day window", () => {
  const r = timeframeRange(NOW, "UTC", "today");
  assertEquals(r, { gte: "2026-06-01T00:00:00.000Z", lt: "2026-06-02T00:00:00.000Z" });
});

Deno.test("timeframeRange: this_week is start-of-today + 7 days", () => {
  const r = timeframeRange(NOW, "UTC", "this_week");
  assertEquals(r, { gte: "2026-06-01T00:00:00.000Z", lt: "2026-06-08T00:00:00.000Z" });
});

// Fake admin: returns a fixed set of rows for whichever table is queried.
function makeAdmin(rows: Record<string, unknown>[]) {
  const builder = () => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain; b.eq = chain; b.neq = chain; b.in = chain;
    b.gte = chain; b.lt = chain; b.order = chain; b.contains = chain;
    b.limit = () => Promise.resolve({ data: rows, error: null });
    return b;
  };
  return { from: builder } as unknown as import("./query.ts").AdminLike;
}

Deno.test("runQuery formats tasks with a +N more footer when capped", async () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    title: `Task ${i + 1}`, due_date: null, status: "todo",
  }));
  const intent: Intent = { action: "query", entity: "task", scope: "all" };
  const text = await runQuery(makeAdmin(rows), ACCOUNT, intent, "UTC", NOW);
  assert(text.includes("Task 1"), "lists first task");
  assert(text.includes("Task 10"), "lists tenth task");
  assert(!text.includes("Task 11"), "does not list the eleventh");
  assert(text.includes("and 1 more"), "shows the overflow footer");
});

Deno.test("runQuery returns a friendly empty message", async () => {
  const intent: Intent = { action: "query", entity: "deal", scope: "all" };
  const text = await runQuery(makeAdmin([]), ACCOUNT, intent, "UTC", NOW);
  assert(text.toLowerCase().includes("no "), "mentions nothing found");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared/agent/query_test.ts`
Expected: FAIL — `query.ts` does not exist.

- [ ] **Step 3: Implement `query.ts`**

Create `supabase/functions/_shared/agent/query.ts`:

```typescript
// supabase/functions/_shared/agent/query.ts
// Read-only queries for the chat bot. runQuery dispatches on intent.entity,
// runs an org-scoped select with optional scope/timeframe/status/stage
// filters, and returns a compact text list (cap 10 + "+N more").

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Intent, LinkedAccount } from "./types.ts";
import { formatLocal } from "./format.ts";

export type AdminLike = Pick<SupabaseClient, "from">;

const CAP = 10;

// Wall-clock offset (minutes) of `tz` at instant `d`: localWall - UTC.
const tzOffsetMinutes = (d: Date, tz: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - d.getTime()) / 60000;
};

// Start of "today" in tz, expressed as a UTC ISO instant.
const startOfTodayUtc = (nowIso: string, tz: string): Date => {
  const now = new Date(nowIso);
  const off = tzOffsetMinutes(now, tz);
  const local = new Date(now.getTime() + off * 60000);   // shift into local wall time
  local.setUTCHours(0, 0, 0, 0);                          // midnight local
  return new Date(local.getTime() - off * 60000);         // back to UTC instant
};

const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

export interface Range { gte?: string; lt?: string; }

/** Compute an inclusive-start/exclusive-end UTC range for a timeframe. */
export const timeframeRange = (
  nowIso: string,
  tz: string,
  tf: NonNullable<Intent["timeframe"]>,
): Range => {
  const start = startOfTodayUtc(nowIso, tz);
  switch (tf) {
    case "overdue":   return { lt: start.toISOString() };
    case "today":     return { gte: start.toISOString(), lt: addDays(start, 1).toISOString() };
    case "this_week": return { gte: start.toISOString(), lt: addDays(start, 7).toISOString() };
    case "this_month":return { gte: start.toISOString(), lt: addDays(start, 31).toISOString() };
    case "upcoming":  return { gte: nowIso };
  }
};

interface EntityCfg {
  table: string;
  cols: string;
  dateCol: string;
  ownerCol: string;          // column used for scope=mine
  order: { col: string; asc: boolean };
  // Build the human line for one row.
  line: (r: Record<string, unknown>, tz: string) => string;
  // Apply status/stage defaults; returns [col, op, value] tuples.
  extraFilters?: (intent: Intent) => Array<["eq" | "neq" | "in", string, unknown]>;
}

const s = (v: unknown): string => (v == null ? "" : String(v));

const ENTITY: Record<string, EntityCfg> = {
  task: {
    table: "tasks", cols: "title, due_date, status", dateCol: "due_date",
    ownerCol: "created_by", order: { col: "due_date", asc: true },
    line: (r, tz) => `• ${s(r.title)}${r.due_date ? ` — due ${formatLocal(s(r.due_date), tz)}` : ""}`,
    extraFilters: (i) => i.status ? [["eq", "status", i.status]] : [["neq", "status", "done"]],
  },
  client_task: {
    table: "client_tasks", cols: "title, due_at, status", dateCol: "due_at",
    ownerCol: "assigned_to", order: { col: "due_at", asc: true },
    line: (r, tz) => `• ${s(r.title)}${r.due_at ? ` — due ${formatLocal(s(r.due_at), tz)}` : ""}`,
    extraFilters: (i) => i.status ? [["eq", "status", i.status]] : [["neq", "status", "done"]],
  },
  deal: {
    table: "deals", cols: "title, stage, value, currency, expected_close_date",
    dateCol: "expected_close_date", ownerCol: "owner_id", order: { col: "expected_close_date", asc: true },
    line: (r) => `• ${s(r.title)} — ${s(r.stage)}${r.value ? ` · ${s(r.value)} ${s(r.currency)}` : ""}${r.expected_close_date ? ` · closes ${s(r.expected_close_date)}` : ""}`,
    extraFilters: (i) => i.stage ? [["eq", "stage", i.stage.toLowerCase()]] : [],
  },
  lead: {
    table: "leads", cols: "first_name, last_name, company, created_at",
    dateCol: "created_at", ownerCol: "created_by", order: { col: "created_at", asc: false },
    line: (r) => `• ${[s(r.first_name), s(r.last_name)].filter(Boolean).join(" ")} — ${s(r.company)}`,
  },
  client: {
    table: "clients", cols: "name, created_at", dateCol: "created_at",
    ownerCol: "created_by", order: { col: "name", asc: true },
    line: (r) => `• ${s(r.name)}`,
  },
  meeting: {
    table: "meetings", cols: "title, start_at, status", dateCol: "start_at",
    ownerCol: "host_user_id", order: { col: "start_at", asc: true },
    line: (r, tz) => `• ${s(r.title)} — ${formatLocal(s(r.start_at), tz)}`,
  },
  call: {
    table: "calls", cols: "subject, call_status, call_start_at", dateCol: "call_start_at",
    ownerCol: "caller_user_id", order: { col: "call_start_at", asc: false },
    line: (r, tz) => `• ${s(r.subject)} — ${s(r.call_status)}${r.call_start_at ? ` · ${formatLocal(s(r.call_start_at), tz)}` : ""}`,
  },
};

const LABEL: Record<string, string> = {
  task: "tasks", client_task: "follow-ups", deal: "deals", lead: "leads",
  client: "clients", meeting: "meetings", call: "calls",
};

export const runQuery = async (
  admin: AdminLike,
  account: LinkedAccount,
  intent: Intent,
  tz: string,
  nowIso: string,
): Promise<string> => {
  const entity = intent.entity ?? "task";
  const cfg = ENTITY[entity];
  if (!cfg) return "I can list tasks, deals, leads, clients, meetings or calls. Try `show my open tasks`.";

  // deno-lint-ignore no-explicit-any
  let q: any = admin.from(cfg.table).select(cfg.cols).eq("organization_id", account.current_org_id);

  if (intent.scope === "mine") q = q.eq(cfg.ownerCol, account.user_id);
  for (const [op, col, val] of cfg.extraFilters?.(intent) ?? []) q = (q as Record<string, (c: string, v: unknown) => unknown>)[op](col, val);
  if (intent.timeframe) {
    const r = timeframeRange(nowIso, tz, intent.timeframe);
    if (r.gte) q = q.gte(cfg.dateCol, r.gte);
    if (r.lt) q = q.lt(cfg.dateCol, r.lt);
  }
  q = q.order(cfg.order.col, { ascending: cfg.order.asc });

  const { data, error } = await q.limit(CAP + 1);
  if (error) return `Couldn't read ${LABEL[entity]}: ${error.message}`;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return `No ${LABEL[entity]} found.`;

  const shown = rows.slice(0, CAP);
  const lines = shown.map((r) => cfg.line(r, tz));
  const footer = rows.length > CAP ? `\n…and ${rows.length - CAP} more — open TaskCalendar to see all.` : "";
  const header = `*${shown.length}${rows.length > CAP ? "+" : ""} ${LABEL[entity]}${intent.scope === "mine" ? " (yours)" : ""}*`;
  return `${header}\n${lines.join("\n")}${footer}`;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/agent/query_test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/query.ts supabase/functions/_shared/agent/query_test.ts
git commit -m "feat(bot): query.ts runs org-scoped reads with timeframe/scope filters"
```

---

## Task 4: Wire the `query` case into `resolveIntent`

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`

- [ ] **Step 1: Import the query runner + timezone loader**

At the top of `agentActions.ts`, add:

```typescript
import { runQuery } from "./query.ts";
import { loadUserTimezone } from "./format.ts";
```

- [ ] **Step 2: Add the `query` case**

In `resolveIntent`'s `switch (intent.action)`, add a case (next to `case "list_orgs":`):

```typescript
    case "query": {
      const tz = await loadUserTimezone(admin, account.user_id);
      const text = await runQuery(admin, account, intent, tz, new Date().toISOString());
      return { kind: "text", text };
    }
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/_shared/agent/agentActions.ts`
Expected: no errors.

- [ ] **Step 4: Run the shared test suite**

Run: `deno test supabase/functions/_shared/agent/`
Expected: PASS (Phase 0 + Phase 1 + Phase 2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts
git commit -m "feat(bot): resolveIntent handles read queries"
```

---

## Task 5: Deploy + verify

- [ ] **Step 1: Deploy**

```bash
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- [ ] **Step 2: Seed + query**

Create 2 open tasks and 1 done task in your org (assigned to you / created by you). From the bot send:
- `show my open tasks` → expect the 2 open tasks, not the done one.
- `list clients` → expect your client list.
- `deals closing this month` → expect deals with `expected_close_date` inside the next ~month.
- `upcoming meetings` → expect future meetings only.

- [ ] **Step 3: Verify the cap**

Create 12 clients. Send `list clients` → expect 10 listed plus "…and 2 more".

- [ ] **Step 4: Verify timezone-correct dates**

With your profile timezone set (Phase 1), confirm a task's due time renders in your local time in the list output.

---

## Self-Review

**Spec coverage (§4):** generic `query` action (Task 1–2) ✓; per-entity reads for task/client_task/deal/lead/client/meeting/call (Task 3 `ENTITY` map) ✓; scope=mine (Task 3) ✓; timeframe windows (Task 3 `timeframeRange`) ✓; cap 10 + "+N more" (Task 3) ✓; tz-aware dates via `formatLocal` ✓; org-scoped — every query `.eq("organization_id", ...)` ✓; reads need no confirm (Task 4 returns text) ✓.

**Placeholder scan:** All code complete. The `scope=mine`→`created_by` and rolling-31-day `this_month` simplifications are documented at the top, not silent.

**Type consistency:** `runQuery(admin, account, intent, tz, nowIso)` signature matches its test calls and the `resolveIntent` call site. `timeframeRange(nowIso, tz, tf)` returns `Range` consumed by `runQuery`. `Intent.entity/scope/timeframe` (Task 1) are read in `query.ts`. `AdminLike` is the narrowed admin type used by both the test fake and the real call.
