# Bot Phase 3 — Edit / Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bot edit existing records — "mark X done", "reschedule Y to Friday", "move the Acme deal to Won", "set deal value to 20000".

**Architecture:** Add a generic `update` action. The resolver finds the target record by title/name (reusing Phase 0's disambiguation when >1 match), builds a confirm summary, and queues a pending action. On confirm, `executePending` applies an org-scoped `UPDATE` per entity. Every edit confirms first (locked decision). No delete.

**Tech Stack:** Deno edge functions, Supabase JS (service-role admin). Tests via `deno test`.

**Reference spec:** [docs/superpowers/specs/2026-06-01-bot-power-expansion-design.md](../specs/2026-06-01-bot-power-expansion-design.md) §5 (Edit/update).

**Depends on:** Phase 0 (disambiguation, `resolveRef`, `ambiguate`, `PICK_FIELD`, `queuePending`).

**Confirmed enums (from migrations):** tasks.status `undefined|todo|inprogress|done|needreview`; client_tasks.status `pending|done|snoozed`; deals.stage `lead|qualified|proposal|negotiation|won|lost` (+ FK `stage_id`→`pipeline_stages`); leads.lead_status (10 values, incl `converted`,`lost_lead`); meetings.status `scheduled|held|cancelled|no_show`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/functions/_shared/agent/types.ts` | Add `update` action + `target` field | Modify |
| `supabase/functions/_shared/agent/intent.ts` | Parser schema + examples for `update` | Modify |
| `supabase/functions/_shared/agent/editConfig.ts` | Per-entity edit config + status maps + `buildPatch` | Create |
| `supabase/functions/_shared/agent/editConfig_test.ts` | Tests for `buildPatch`/status maps | Create |
| `supabase/functions/_shared/agent/agentActions.ts` | `findByTitle`, `update` case in `resolveIntent`, `update` case in `executePending`, extend `PICK_FIELD` | Modify |
| `supabase/functions/_shared/agent/edit_test.ts` | resolveIntent/executePending update tests | Create |

---

## Task 1: Add `update` action + `target` field

**Files:**
- Modify: `supabase/functions/_shared/agent/types.ts`

- [ ] **Step 1: Add `update` to `AgentActionType`** (next to `"query"`):

```typescript
  | "query"
  | "update"
```

- [ ] **Step 2: Add `target` + `priority` to `Intent`** (above `resolved_ids`):

```typescript
  // Edit fields. `target` is the name/title used to FIND the record;
  // the change itself reuses status/stage/due/title/value/currency/priority.
  target?: string | null;
  priority?: string | null;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/agent/types.ts
git commit -m "feat(bot): add update action + target field to Intent"
```

---

## Task 2: Teach the parser to emit `update`

**Files:**
- Modify: `supabase/functions/_shared/agent/intent.ts`

- [ ] **Step 1: Add fields + action to the schema**

Add `"update"` to the `"action"` enum. Add to the schema object:

```
  "target": string | null,
  "priority": string | null,
```

- [ ] **Step 2: Add routing rules + examples**

Add a section before "Utility:":

```
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
```

- [ ] **Step 3: Add few-shot examples**

```
16. "mark Deploy v2 done"
    → {"action":"update","entity":"task","target":"Deploy v2","status":"done","confidence":0.9}
17. "move the Acme Website deal to Won"
    → {"action":"update","entity":"deal","target":"Acme Website","stage":"won","confidence":0.9}
18. "reschedule Discovery call to tomorrow 4pm"
    → {"action":"update","entity":"meeting","target":"Discovery call","due":"<ISO>","confidence":0.85}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/agent/intent.ts
git commit -m "feat(bot): parser emits update intents"
```

---

## Task 3: Edit config + patch builder (pure, unit-tested)

**Files:**
- Create: `supabase/functions/_shared/agent/editConfig.ts`
- Test: `supabase/functions/_shared/agent/editConfig_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/agent/editConfig_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EDIT_CFG, buildPatch, mapTaskStatus } from "./editConfig.ts";
import type { Intent } from "./types.ts";

Deno.test("mapTaskStatus normalizes natural phrasings", () => {
  assertEquals(mapTaskStatus("done"), "done");
  assertEquals(mapTaskStatus("complete"), "done");
  assertEquals(mapTaskStatus("in progress"), "inprogress");
  assertEquals(mapTaskStatus("reopen"), "todo");
  assertEquals(mapTaskStatus("review"), "needreview");
  assertEquals(mapTaskStatus("garbage"), null);
});

Deno.test("buildPatch(task) maps status=done and stamps completed_at", () => {
  const intent: Intent = { action: "update", entity: "task", target: "X", status: "done" };
  const patch = buildPatch("task", intent, "2026-06-01T12:00:00Z");
  assertEquals(patch.status, "done");
  assertEquals(patch.completed_at, "2026-06-01T12:00:00Z");
});

Deno.test("buildPatch(task) reschedule sets due_date and rename sets title", () => {
  const due = "2026-06-05T15:00:00Z";
  assertEquals(buildPatch("task", { action: "update", entity: "task", due }, "now").due_date, due);
  assertEquals(buildPatch("task", { action: "update", entity: "task", title: "New" }, "now").title, "New");
});

Deno.test("buildPatch(deal) value + expected_close_date", () => {
  const patch = buildPatch("deal", { action: "update", entity: "deal", value: 20000, currency: "usd", due: "2026-07-01T00:00:00Z" }, "now");
  assertEquals(patch.value, 20000);
  assertEquals(patch.currency, "USD");
  assertEquals(patch.expected_close_date, "2026-07-01");
});

Deno.test("buildPatch(meeting) cancel + reschedule", () => {
  assertEquals(buildPatch("meeting", { action: "update", entity: "meeting", status: "cancelled" }, "now").status, "cancelled");
  const due = "2026-06-09T16:00:00Z";
  assertEquals(buildPatch("meeting", { action: "update", entity: "meeting", due }, "now").start_at, due);
});

Deno.test("EDIT_CFG maps entity to table/pk/search column", () => {
  assertEquals(EDIT_CFG.task.table, "tasks");
  assertEquals(EDIT_CFG.deal.pkCol, "deal_id");
  assertEquals(EDIT_CFG.lead.searchCol, "last_name");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/_shared/agent/editConfig_test.ts`
Expected: FAIL — `editConfig.ts` does not exist.

- [ ] **Step 3: Implement `editConfig.ts`**

Create `supabase/functions/_shared/agent/editConfig.ts`:

```typescript
// supabase/functions/_shared/agent/editConfig.ts
// Per-entity edit configuration + pure patch builders for the bot's `update`
// action. Knows nothing about the DB client — buildPatch returns the column
// map; agentActions applies it. Stage/probability lookup for deals (which
// needs pipeline_stages) is done in agentActions, not here.

import type { Intent } from "./types.ts";

export interface EditCfg {
  entity: string;
  table: string;
  pkCol: string;
  idField: string;        // resolved_ids key + callback target
  pickPrefix: string;     // disambiguation callback prefix
  searchCol: string;      // column matched against intent.target
  label: string;
}

export const EDIT_CFG: Record<string, EditCfg> = {
  task:        { entity: "task",        table: "tasks",        pkCol: "task_id",   idField: "task_id",        pickPrefix: "picktask",    searchCol: "title",     label: "task" },
  client_task: { entity: "client_task", table: "client_tasks", pkCol: "task_id",   idField: "client_task_id", pickPrefix: "pickctask",   searchCol: "title",     label: "follow-up" },
  deal:        { entity: "deal",        table: "deals",        pkCol: "deal_id",   idField: "deal_id",        pickPrefix: "pickdeal",    searchCol: "title",     label: "deal" },
  lead:        { entity: "lead",        table: "leads",        pkCol: "lead_id",   idField: "lead_id",        pickPrefix: "picklead",    searchCol: "last_name", label: "lead" },
  meeting:     { entity: "meeting",     table: "meetings",     pkCol: "meeting_id",idField: "meeting_id",     pickPrefix: "pickmeeting", searchCol: "title",     label: "meeting" },
};

const TASK_STATUS: Record<string, string> = {
  done: "done", complete: "done", completed: "done", finish: "done", finished: "done",
  "in progress": "inprogress", inprogress: "inprogress", doing: "inprogress", started: "inprogress",
  todo: "todo", "to do": "todo", reopen: "todo", open: "todo", reset: "todo",
  review: "needreview", "needs review": "needreview", needreview: "needreview",
};

const CLIENT_TASK_STATUS: Record<string, string> = {
  done: "done", complete: "done", completed: "done",
  pending: "pending", reopen: "pending", open: "pending",
  snooze: "snoozed", snoozed: "snoozed",
};

const LEAD_STATUS = new Set([
  "new", "attempted_to_contact", "contact_in_future", "contacted", "junk_lead",
  "lost_lead", "not_contacted", "pre_qualified", "not_qualified", "converted",
]);

const MEETING_STATUS: Record<string, string> = {
  cancel: "cancelled", cancelled: "cancelled", canceled: "cancelled",
  held: "held", done: "held", complete: "held", "no show": "no_show", no_show: "no_show",
  scheduled: "scheduled",
};

export const mapTaskStatus = (raw: string | null | undefined): string | null =>
  raw ? (TASK_STATUS[raw.trim().toLowerCase()] ?? null) : null;

export type Patch = Record<string, unknown>;

/** Build the column patch for an entity from the intent's change fields.
 *  `nowIso` is used for completed_at/done_at stamps. Deal stage_id/probability
 *  are NOT set here (needs a pipeline_stages lookup in agentActions). */
export const buildPatch = (entity: string, intent: Intent, nowIso: string): Patch => {
  const patch: Patch = {};
  const norm = (s: string) => s.trim().toLowerCase();
  switch (entity) {
    case "task": {
      const st = mapTaskStatus(intent.status);
      if (st) { patch.status = st; if (st === "done") patch.completed_at = nowIso; }
      if (intent.due) patch.due_date = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      if (intent.priority && ["high", "medium", "low"].includes(norm(intent.priority))) patch.priority = norm(intent.priority);
      break;
    }
    case "client_task": {
      if (intent.status) {
        const st = CLIENT_TASK_STATUS[norm(intent.status)];
        if (st) { patch.status = st; if (st === "done") patch.done_at = nowIso; }
      }
      if (intent.due) patch.due_at = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      break;
    }
    case "deal": {
      // stage handled in agentActions (needs stage_id); here just text + value + date.
      if (intent.stage) patch.stage = norm(intent.stage);
      if (typeof intent.value === "number") patch.value = intent.value;
      if (intent.currency) patch.currency = intent.currency.toUpperCase();
      if (intent.due) patch.expected_close_date = intent.due.slice(0, 10);
      break;
    }
    case "lead": {
      if (intent.status && LEAD_STATUS.has(norm(intent.status).replace(/\s+/g, "_"))) {
        patch.lead_status = norm(intent.status).replace(/\s+/g, "_");
      }
      if (intent.email) patch.email = intent.email;
      if (intent.phone) patch.phone = intent.phone;
      break;
    }
    case "meeting": {
      if (intent.status) {
        const st = MEETING_STATUS[norm(intent.status)];
        if (st) patch.status = st;
      }
      if (intent.due) patch.start_at = intent.due;
      if (intent.title) patch.title = intent.title.trim();
      break;
    }
  }
  return patch;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/agent/editConfig_test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/editConfig.ts supabase/functions/_shared/agent/editConfig_test.ts
git commit -m "feat(bot): edit config + pure patch builder"
```

---

## Task 4: Resolve + confirm `update` in `resolveIntent`

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`
- Test: `supabase/functions/_shared/agent/edit_test.ts`

- [ ] **Step 1: Extend `PICK_FIELD` with edit prefixes**

In `agentActions.ts`, add to the `PICK_FIELD` map:

```typescript
  picktask: "task_id",
  pickctask: "client_task_id",
  pickdeal: "deal_id",
  picklead: "lead_id",
  pickmeeting: "meeting_id",
```

- [ ] **Step 2: Add `findByTitle` (wildcard search for edit targets)**

In `agentActions.ts`, directly below `findByName`, add:

```typescript
// Like findByName but matches a substring (case-insensitive) — used to find
// an edit target the user named loosely ("Deploy v2", "Acme Website").
const findByTitle = async (
  admin: SupabaseClient,
  table: string,
  searchCol: string,
  pkCol: string,
  orgId: string,
  needle: string,
): Promise<Array<{ id: string; name: string }>> => {
  const { data } = await admin
    .from(table)
    .select(`${pkCol}, ${searchCol}`)
    .eq("organization_id", orgId)
    .ilike(searchCol, `%${needle}%`)
    .limit(6);
  const rows = (data ?? []) as Array<Record<string, string>>;
  return rows.map((r) => ({ id: r[pkCol], name: r[searchCol] }));
};
```

- [ ] **Step 3: Import the edit config**

At the top of `agentActions.ts`:

```typescript
import { EDIT_CFG, buildPatch } from "./editConfig.ts";
```

- [ ] **Step 4: Add the `update` case to `resolveIntent`**

In the `switch (intent.action)`, add:

```typescript
    case "update": {
      const cfg = intent.entity ? EDIT_CFG[intent.entity] : undefined;
      if (!cfg) {
        return { kind: "text", text: "I can update tasks, follow-ups, deals, leads or meetings. Try `mark Deploy v2 done`." };
      }
      // Build the change preview to make sure there IS a change.
      const patch = buildPatch(cfg.entity, intent, new Date().toISOString());
      const wantsStage = cfg.entity === "deal" && !!intent.stage;
      if (Object.keys(patch).length === 0 && !wantsStage) {
        return { kind: "text", text: `What should I change on that ${cfg.label}? e.g. mark it done, reschedule it, or set a value.` };
      }
      // Resolve the target record.
      let targetId = intent.resolved_ids?.[cfg.idField] ?? null;
      let targetName = intent.target ?? "";
      if (!targetId) {
        const needle = (intent.target ?? "").trim();
        if (!needle) {
          await queueConvo(admin, provider, account, chatId, "target", intent);
          return { kind: "text", text: `Which ${cfg.label}?` };
        }
        const matches = await findByTitle(admin, cfg.table, cfg.searchCol, cfg.pkCol, account.current_org_id, needle);
        if (matches.length === 0) return { kind: "text", text: `No ${cfg.label} matching *${needle}*.` };
        if (matches.length > 1) {
          return ambiguate(admin, provider, account, chatId, intent, cfg.idField, matches, `Multiple ${cfg.label}s match *${needle}*. Pick one:`, cfg.pickPrefix);
        }
        targetId = matches[0].id;
        targetName = matches[0].name;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { [cfg.idField]: targetId });
      return { kind: "confirm", summary: editSummary(cfg, intent, targetName), pendingActionId: pendingId };
    }
```

- [ ] **Step 5: Add the `editSummary` helper**

In `agentActions.ts`, near the other helpers (above `resolveIntent`), add:

```typescript
// One-line human summary of an edit, for the confirm prompt.
const editSummary = (
  cfg: { entity: string; label: string },
  intent: Intent,
  targetName: string,
): string => {
  const name = targetName || intent.target || "it";
  if (cfg.entity === "deal" && intent.stage) return `Move deal *${name}* to *${intent.stage}*?`;
  if (intent.status) return `Set ${cfg.label} *${name}* to *${intent.status}*?`;
  if (intent.due) return `Reschedule ${cfg.label} *${name}* to *${intent.due}*?`;
  if (intent.title) return `Rename ${cfg.label} *${name}* to *${intent.title}*?`;
  if (typeof intent.value === "number") return `Set ${cfg.label} *${name}* value to *${intent.value} ${intent.currency ?? ""}*?`.trim().replace(/ \?$/, "?");
  if (intent.priority) return `Set ${cfg.label} *${name}* priority to *${intent.priority}*?`;
  return `Update ${cfg.label} *${name}*?`;
};
```

- [ ] **Step 6: Write the failing test**

Create `supabase/functions/_shared/agent/edit_test.ts`:

```typescript
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveIntent } from "./agentActions.ts";
import type { Intent, LinkedAccount } from "./types.ts";

const ACCOUNT: LinkedAccount = { user_id: "u1", current_org_id: "org1", external_id: "c1" };

// Fake admin: findByTitle returns one task; queuePending insert returns an id.
function makeAdmin() {
  const calls: string[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain; b.eq = chain; b.lt = chain; b.delete = chain; b.insert = chain;
    b.upsert = () => Promise.resolve({ data: null, error: null });
    b.ilike = () => { calls.push(`ilike:${table}`); return b; };
    b.limit = () => Promise.resolve({ data: table === "tasks" ? [{ task_id: "t-1", title: "Deploy v2" }] : [], error: null });
    b.single = () => Promise.resolve({ data: { id: "pa-9" }, error: null });
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return b;
  };
  return { admin: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) }, calls };
}

Deno.test("update resolves a single target and asks to confirm", async () => {
  const { admin } = makeAdmin();
  const intent: Intent = { action: "update", entity: "task", target: "Deploy v2", status: "done" };
  // deno-lint-ignore no-explicit-any
  const reply = await resolveIntent(admin as any, "telegram", ACCOUNT, "c1", intent);
  assertEquals(reply.kind, "confirm");
  if (reply.kind === "confirm") assert(reply.summary.toLowerCase().includes("done"));
});

Deno.test("update with a pre-resolved id skips the title search", async () => {
  const { admin, calls } = makeAdmin();
  const intent: Intent = { action: "update", entity: "task", target: "Deploy v2", status: "done", resolved_ids: { task_id: "t-1" } };
  // deno-lint-ignore no-explicit-any
  const reply = await resolveIntent(admin as any, "telegram", ACCOUNT, "c1", intent);
  assertEquals(reply.kind, "confirm");
  assert(!calls.includes("ilike:tasks"), "pre-resolved id should skip search");
});

Deno.test("update with no change field asks what to change", async () => {
  const { admin } = makeAdmin();
  const intent: Intent = { action: "update", entity: "task", target: "Deploy v2" };
  // deno-lint-ignore no-explicit-any
  const reply = await resolveIntent(admin as any, "telegram", ACCOUNT, "c1", intent);
  assertEquals(reply.kind, "text");
});
```

- [ ] **Step 7: Run tests**

Run: `deno test supabase/functions/_shared/agent/edit_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts supabase/functions/_shared/agent/edit_test.ts
git commit -m "feat(bot): resolveIntent resolves + confirms update intents"
```

---

## Task 5: Execute the update

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`

- [ ] **Step 1: Add the `update` case to `executePending`**

In `executePending`, inside the `switch (a.action)`, add (before `default:`):

```typescript
      case "update": {
        const cfg = a.entity ? EDIT_CFG[a.entity] : undefined;
        if (!cfg) throw new Error("Unknown entity to update.");
        const targetId = a.resolved_ids?.[cfg.idField];
        if (!targetId) throw new Error("Target record not resolved.");
        const nowIso = new Date().toISOString();
        const patch = buildPatch(cfg.entity, a, nowIso);

        // Deals: a stage move must also update stage_id + probability, and a
        // won/lost move stamps the close date. Resolve the stage row within
        // the deal's pipeline.
        if (cfg.entity === "deal" && a.stage) {
          const { data: deal } = await admin.from("deals")
            .select("pipeline_id").eq("deal_id", targetId).eq("organization_id", row.org_id).maybeSingle();
          const pipelineId = (deal as { pipeline_id?: string } | null)?.pipeline_id ?? null;
          if (pipelineId) {
            const { data: stage } = await admin.from("pipeline_stages")
              .select("stage_id, default_probability, is_won")
              .eq("pipeline_id", pipelineId).eq("key", a.stage.toLowerCase()).maybeSingle();
            const st = stage as { stage_id?: string; default_probability?: number; is_won?: boolean } | null;
            if (st?.stage_id) {
              patch.stage_id = st.stage_id;
              if (typeof st.default_probability === "number") patch.probability = st.default_probability;
              if (st.is_won) patch.actual_close_date = nowIso.slice(0, 10);
            }
          }
        }

        if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
        const { error: e } = await admin.from(cfg.table)
          .update(patch)
          .eq(cfg.pkCol, targetId)
          .eq("organization_id", row.org_id);
        if (e) throw e;
        return `✅ Updated ${cfg.label}.`;
      }
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/_shared/agent/agentActions.ts`
Expected: no errors.

- [ ] **Step 3: Run the full shared suite**

Run: `deno test supabase/functions/_shared/agent/`
Expected: PASS (all phases' tests).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts
git commit -m "feat(bot): executePending applies org-scoped updates incl. deal stage moves"
```

---

## Task 6: Deploy + verify

- [ ] **Step 1: Deploy**

```bash
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- [ ] **Step 2: Task edits**

Create a task `Deploy v2`. From the bot:
- `mark Deploy v2 done` → confirm → verify status flips to `done` and `completed_at` is set in the app.
- `reschedule Deploy v2 to tomorrow 4pm` → confirm → verify `due_date` updates in your timezone.
- `rename Deploy v2 to Deploy v3` → confirm → verify title.

- [ ] **Step 3: Deal stage move (the tricky one)**

Create a deal `Acme Website` in a pipeline that has a Won stage. Send `move Acme Website to Won` → confirm. Verify in the app: the deal sits in the **Won** column (stage_id moved, not just the text), probability = the Won stage's default, and `actual_close_date` = today.

- [ ] **Step 4: Disambiguation on edit**

Create two tasks both titled `Review`. Send `mark Review done` → expect the pick buttons (Phase 0). Tap one → confirm → only that task flips.

- [ ] **Step 5: Meeting cancel + lead status**

`cancel meeting <title>` → status `cancelled`. `set lead <lastname> to contacted` → `lead_status='contacted'`.

---

## Self-Review

**Spec coverage (§5):** generic `update` action ✓; task status/reschedule/rename/priority ✓; client_task status/reschedule ✓; deal stage(+stage_id+probability+close date)/value/close-date ✓; lead status/email/phone ✓; meeting reschedule/cancel ✓; always-confirm (returns `confirm`, writes only in `executePending`) ✓; target resolution reuses Phase 0 disambiguation ✓; org-scoped UPDATE (`.eq("organization_id", row.org_id)`) ✓; no delete ✓.

**Placeholder scan:** All code complete. The "won also sets actual_close_date" and stage_id lookup are implemented, not deferred.

**Type consistency:** `EDIT_CFG[entity]` shape (`idField`, `pkCol`, `pickPrefix`, `searchCol`, `table`, `label`) is consumed identically in `resolveIntent` and `executePending`. `buildPatch(entity, intent, nowIso)` matches its tests and both call sites. `PICK_FIELD` edit prefixes map to the same `idField`s used by `EDIT_CFG` and `resumeDisambiguation` (Phase 0). `findByTitle` returns `{id,name}` like `findByName`, consumed by `ambiguate`.
