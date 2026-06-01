# Bot Phase 0 — Disambiguation Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat bot's disambiguation choice buttons actually resolve a record, instead of replying "rephrase with the full name".

**Architecture:** All logic lives once in `_shared/agent/`; both Telegram and WhatsApp inherit it through their existing re-export wrappers. When a name matches >1 record we persist the partial intent in `agent_conversation_state`, send choice buttons, and on tap we inject the chosen id into `intent.resolved_ids` and re-run `resolveIntent`. `resolveIntent` is taught to use a pre-resolved id instead of re-searching. WhatsApp gains an interactive **list** message for >3 candidates (its buttons cap at 3); Telegram keeps its inline keyboard.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, Meta WhatsApp Cloud API, Telegram Bot API. Tests via `deno test`.

**Reference spec:** [docs/superpowers/specs/2026-06-01-bot-power-expansion-design.md](../specs/2026-06-01-bot-power-expansion-design.md) §3 (Disambiguation state machine).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/functions/_shared/agent/types.ts` | Add `resolved_ids` to `Intent` | Modify |
| `supabase/functions/_shared/agent/agentActions.ts` | `parsePickCallback`, `resolveRef`, `ambiguate`, `queueDisambiguation`, `resumeDisambiguation`; honor `resolved_ids` in `resolveIntent`; widen `LoadedConvo.awaiting_field` | Modify |
| `supabase/functions/_shared/agent/disambiguation_test.ts` | Unit tests for the above | Create |
| `supabase/functions/whatsapp-webhook/whatsapp.ts` | `sendList()` interactive-list transport | Modify |
| `supabase/functions/whatsapp-webhook/handlers.ts` | Route `pick*` to `resumeDisambiguation`; render list for >3; slot-fill guard | Modify |
| `supabase/functions/telegram-webhook/handlers.ts` | Route `pick*` to `resumeDisambiguation`; slot-fill guard | Modify |

**Note on callback chat-id matching:** when `resolveIntent` is called it receives a `chatId` that is `String(msg.chat.id)` for Telegram and the E.164 phone number for WhatsApp. The disambiguation row is keyed by that exact value, and the callback events carry the same value (`cq.message.chat.id` / `m.from`), so resume look-ups match without extra plumbing.

---

## Task 1: Add `resolved_ids` to Intent + `parsePickCallback` helper

**Files:**
- Modify: `supabase/functions/_shared/agent/types.ts`
- Modify: `supabase/functions/_shared/agent/agentActions.ts`
- Test: `supabase/functions/_shared/agent/disambiguation_test.ts` (create)

- [ ] **Step 1: Add `resolved_ids` to the `Intent` interface**

In `types.ts`, the `Intent` interface currently ends with `confidence?: number;`. Add the field just above it:

```typescript
  body?: string | null;         // note body
  /** Internal: ids resolved via disambiguation, keyed by "<entity>_id"
   *  (e.g. project_id, client_id). Carried through a choice tap so
   *  resolveIntent can skip the name lookup. Never set by the parser. */
  resolved_ids?: Record<string, string>;
  confidence?: number;
}
```

- [ ] **Step 2: Write the failing test for `parsePickCallback`**

Create `supabase/functions/_shared/agent/disambiguation_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePickCallback } from "./agentActions.ts";

Deno.test("parsePickCallback maps known prefixes to id fields", () => {
  assertEquals(parsePickCallback("pickproj:abc-123"), { idField: "project_id", id: "abc-123" });
  assertEquals(parsePickCallback("pickws:ws-1"), { idField: "workspace_id", id: "ws-1" });
  assertEquals(parsePickCallback("pickclient:c-9"), { idField: "client_id", id: "c-9" });
});

Deno.test("parsePickCallback rejects unknown or malformed callbacks", () => {
  assertEquals(parsePickCallback("confirm:abc"), null);
  assertEquals(parsePickCallback("pickproj:"), null);
  assertEquals(parsePickCallback("noseparator"), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: FAIL — `parsePickCallback` is not exported from `agentActions.ts`.

- [ ] **Step 4: Implement `parsePickCallback`**

In `agentActions.ts`, add near the top after the imports (above `const PENDING_TTL_MIN`):

```typescript
// Maps a choice-button callback prefix to the Intent.resolved_ids field it fills.
const PICK_FIELD: Record<string, string> = {
  pickws: "workspace_id",
  pickproj: "project_id",
  pickclient: "client_id",
};

/** Parses a "pick<prefix>:<uuid>" choice callback. Returns null for anything
 *  that isn't a known, non-empty pick callback (e.g. confirm:/cancel:). */
export const parsePickCallback = (
  cb: string,
): { idField: string; id: string } | null => {
  const idx = cb.indexOf(":");
  if (idx < 0) return null;
  const idField = PICK_FIELD[cb.slice(0, idx)];
  const id = cb.slice(idx + 1);
  if (!idField || !id) return null;
  return { idField, id };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/agent/types.ts supabase/functions/_shared/agent/agentActions.ts supabase/functions/_shared/agent/disambiguation_test.ts
git commit -m "feat(bot): add Intent.resolved_ids and parsePickCallback"
```

---

## Task 2: Disambiguation persistence plumbing

Adds `queueDisambiguation`, widens `LoadedConvo.awaiting_field` to `string`, and guards the slot-fill path so a `__pick:*` state is not mistaken for a missing-field answer.

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`

- [ ] **Step 1: Widen `LoadedConvo.awaiting_field` to `string`**

In `agentActions.ts`, change the `LoadedConvo` interface:

```typescript
export interface LoadedConvo {
  awaiting_field: string;   // an AwaitingField, or "__pick:<id_field>" for disambiguation
  partial_intent: Intent;
}
```

And in `loadConvo`, change the returned cast:

```typescript
  return {
    awaiting_field: data.awaiting_field as string,
    partial_intent: data.partial_intent as Intent,
  };
```

- [ ] **Step 2: Add `queueDisambiguation`**

In `agentActions.ts`, directly below the existing `queueConvo` function, add:

```typescript
// Persist the in-flight intent while we wait for the user to tap a choice
// button. awaiting_field encodes which resolved_ids key the tap will fill,
// e.g. "__pick:project_id". Reuses the (provider, chat_id) conversation row
// and its 5-minute TTL.
const queueDisambiguation = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  idField: string,
  partialIntent: Intent,
): Promise<void> => {
  const expiresAt = new Date(Date.now() + CONVO_TTL_MIN * 60_000).toISOString();
  await admin.from("agent_conversation_state").upsert({
    provider,
    chat_id: chatId,
    user_id: account.user_id,
    org_id: account.current_org_id,
    awaiting_field: `__pick:${idField}`,
    partial_intent: partialIntent,
    expires_at: expiresAt,
  }, { onConflict: "provider,chat_id" });
};
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts
git commit -m "feat(bot): add queueDisambiguation and widen LoadedConvo"
```

---

## Task 3: Honor `resolved_ids` in `resolveIntent` + persist on ambiguity

Introduces `resolveRef` (use a pre-resolved id, else search) and `ambiguate` (persist + build the choices reply), then rewrites the six create blocks that currently return choices.

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`
- Test: `supabase/functions/_shared/agent/disambiguation_test.ts`

- [ ] **Step 1: Write the failing test (resolved_ids short-circuits the search)**

Append to `disambiguation_test.ts`:

```typescript
import { resolveIntent } from "./agentActions.ts";
import type { Intent, LinkedAccount } from "./types.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Minimal chainable Supabase fake. Records every .ilike() (the call findByName
// uses) and returns a fixed pending-action id from the insert chain.
function makeAdmin() {
  const calls: string[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.lt = chain;
    b.is = chain;
    b.filter = chain;
    b.order = chain;
    b.limit = chain;
    b.delete = chain;
    b.upsert = () => Promise.resolve({ data: null, error: null });
    b.ilike = () => { calls.push(`ilike:${table}`); return b; };
    b.insert = chain;
    b.single = () =>
      table === "agent_pending_actions"
        ? Promise.resolve({ data: { id: "pa-1" }, error: null })
        : Promise.resolve({ data: null, error: null });
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return b;
  };
  return {
    admin: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) },
    calls,
  };
}

const ACCOUNT: LinkedAccount = { user_id: "u1", current_org_id: "org1", external_id: "chat1" };

Deno.test("resolveIntent uses resolved_ids and skips the name lookup", async () => {
  const { admin, calls } = makeAdmin();
  const intent: Intent = {
    action: "create_task",
    title: "Ship it",
    project: "Acme",
    resolved_ids: { project_id: "p-1" },
  };
  // deno-lint-ignore no-explicit-any
  const reply = await resolveIntent(admin as any, "telegram", ACCOUNT, "chat1", intent);
  assertEquals(reply.kind, "confirm");
  assert(!calls.includes("ilike:projects"), "should not search projects when id is pre-resolved");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: FAIL — `create_task` still calls `findByName` (an `ilike:projects` is recorded), so the assertion fails.

- [ ] **Step 3: Add `resolveRef` and `ambiguate` helpers**

In `agentActions.ts`, directly below the existing `findByName` function, add:

```typescript
type RefResult =
  | { status: "resolved"; id: string }
  | { status: "missing" }
  | { status: "ambiguous"; matches: Array<{ id: string; name: string }> };

// Resolve an entity reference: prefer a pre-resolved id (from a prior choice
// tap), else search by name. "missing" means no id and no/zero-match needle;
// the caller decides whether that's an error or "proceed without it".
const resolveRef = async (
  admin: SupabaseClient,
  orgId: string,
  intent: Intent,
  idField: string,
  needle: string | null | undefined,
  table: string,
  nameCol: string,
  pkCol: string,
): Promise<RefResult> => {
  const pre = intent.resolved_ids?.[idField];
  if (pre) return { status: "resolved", id: pre };
  const n = (needle ?? "").trim();
  if (!n) return { status: "missing" };
  const { matches } = await findByName(admin, table, nameCol, pkCol, orgId, n);
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "resolved", id: matches[0].id };
};

// Persist the in-flight intent and return a choices reply. The tap callback
// "<pickPrefix>:<id>" will be resolved by resumeDisambiguation into idField.
const ambiguate = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
  idField: string,
  matches: Array<{ id: string; name: string }>,
  prompt: string,
  pickPrefix: string,
): Promise<AgentReply> => {
  await queueDisambiguation(admin, provider, account, chatId, idField, intent);
  return {
    kind: "choices",
    prompt,
    choices: matches.map((m) => ({ label: m.name, callback: `${pickPrefix}:${m.id}` })),
  };
};
```

- [ ] **Step 4: Rewrite the `create_project` case**

Replace the entire `case "create_project": { ... }` block with:

```typescript
    case "create_project": {
      const name = (intent.name ?? intent.project ?? intent.title ?? "").trim();
      if (!name) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What should the project be called?" };
      }
      let workspaceId: string | null = null;
      if (intent.resolved_ids?.workspace_id || intent.workspace) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "workspace_id", intent.workspace, "workspaces", "name", "workspace_id");
        if (ref.status === "missing") {
          return { kind: "text", text: `No workspace called *${intent.workspace}*. Create it first or omit the workspace.` };
        }
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "workspace_id", ref.matches, `Multiple workspaces match *${intent.workspace}*. Pick one:`, "pickws");
        }
        workspaceId = ref.id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, workspaceId ? { workspace_id: workspaceId } : {});
      return {
        kind: "confirm",
        summary: `Create project *${name}*${intent.workspace ? ` in *${intent.workspace}*` : ""}?`,
        pendingActionId: pendingId,
      };
    }
```

- [ ] **Step 5: Rewrite the `create_task` case**

Replace the entire `case "create_task": { ... }` block with:

```typescript
    case "create_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      if (!intent.resolved_ids?.project_id && !intent.project) {
        await queueConvo(admin, provider, account, chatId, "project", intent);
        return { kind: "text", text: "Which project? e.g. `task: X in Q1 launch`." };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "project_id", intent.project, "projects", "name", "project_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No project called *${intent.project}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "project_id", ref.matches, `Multiple projects match *${intent.project}*. Pick one:`, "pickproj");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { project_id: ref.id });
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return { kind: "confirm", summary: `Create task *${title}* in *${intent.project ?? "project"}*${dueBit}?`, pendingActionId: pendingId };
    }
```

- [ ] **Step 6: Rewrite the `create_client_task` case**

Replace the entire `case "create_client_task": { ... }` block with:

```typescript
    case "create_client_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      let clientId: string | null = null;
      if (intent.resolved_ids?.client_id || intent.client) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
        if (ref.status === "missing") {
          return { kind: "text", text: `No client called *${intent.client}*.` };
        }
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
        }
        clientId = ref.id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const onBit = intent.client ? ` for *${intent.client}*` : "";
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return { kind: "confirm", summary: `Create client task *${title}*${onBit}${dueBit}?`, pendingActionId: pendingId };
    }
```

- [ ] **Step 7: Rewrite the `create_contact` case**

Replace the entire `case "create_contact": { ... }` block with:

```typescript
    case "create_contact": {
      const lastName = (intent.name ?? "").trim();
      if (!lastName) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What's the contact's name?" };
      }
      if (!intent.resolved_ids?.client_id && !intent.client) {
        return { kind: "text", text: `Which client does *${lastName}* belong to?` };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No client called *${intent.client}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { client_id: ref.id });
      return { kind: "confirm", summary: `Add contact *${lastName}* under *${intent.client ?? "client"}*?`, pendingActionId: pendingId };
    }
```

- [ ] **Step 8: Rewrite the `create_deal` case**

Replace the entire `case "create_deal": { ... }` block with:

```typescript
    case "create_deal": {
      const title = (intent.title ?? intent.name ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the deal title?" };
      }
      let clientId: string | null = null;
      if (intent.resolved_ids?.client_id || intent.client) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
        }
        if (ref.status === "resolved") clientId = ref.id;
        // "missing" → create the deal without a client, as before.
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const valueBit = intent.value ? ` worth *${intent.value} ${intent.currency ?? ""}*`.trim() : "";
      const clientBit = intent.client ? ` for *${intent.client}*` : "";
      return { kind: "confirm", summary: `Create deal *${title}*${clientBit}${valueBit}?`, pendingActionId: pendingId };
    }
```

- [ ] **Step 9: Rewrite the `log_note` case**

Replace the entire `case "log_note": { ... }` block with:

```typescript
    case "log_note": {
      const body = (intent.body ?? intent.description ?? "").trim();
      if (!body) {
        await queueConvo(admin, provider, account, chatId, "body", intent);
        return { kind: "text", text: "What's the note?" };
      }
      if (!intent.resolved_ids?.client_id && !intent.client) {
        return { kind: "text", text: "Which client is the note for?" };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No client called *${intent.client}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { client_id: ref.id });
      const preview = body.length > 60 ? `${body.slice(0, 60)}…` : body;
      return { kind: "confirm", summary: `Add note *"${preview}"* on *${intent.client ?? "client"}*?`, pendingActionId: pendingId };
    }
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: PASS — the `create_task` test now returns `confirm` with no `ilike:projects` recorded. (The two Task 1 tests still pass.)

- [ ] **Step 11: Type-check the whole function**

Run: `deno check supabase/functions/_shared/agent/agentActions.ts`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts supabase/functions/_shared/agent/disambiguation_test.ts
git commit -m "feat(bot): resolveIntent honors resolved_ids and persists on ambiguity"
```

---

## Task 4: `resumeDisambiguation` (the choice-tap resolver)

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`
- Test: `supabase/functions/_shared/agent/disambiguation_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `disambiguation_test.ts`:

```typescript
import { resumeDisambiguation } from "./agentActions.ts";

// Fake whose agent_conversation_state row holds a create_task partial intent.
function makeAdminWithConvo() {
  const calls: string[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.eq = chain;
    b.lt = chain;
    b.is = chain;
    b.filter = chain;
    b.order = chain;
    b.limit = chain;
    b.delete = () => { calls.push(`delete:${table}`); return b; };
    b.upsert = () => Promise.resolve({ data: null, error: null });
    b.ilike = () => { calls.push(`ilike:${table}`); return b; };
    b.insert = chain;
    b.single = () =>
      table === "agent_pending_actions"
        ? Promise.resolve({ data: { id: "pa-2" }, error: null })
        : Promise.resolve({ data: null, error: null });
    b.maybeSingle = () => {
      if (table === "agent_conversation_state") {
        return Promise.resolve({
          data: {
            awaiting_field: "__pick:project_id",
            partial_intent: { action: "create_task", title: "Ship it", project: "Acme" },
            user_id: "u1",
            org_id: "org1",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return b;
  };
  return { admin: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) }, calls };
}

Deno.test("resumeDisambiguation injects the picked id and returns confirm", async () => {
  const { admin, calls } = makeAdminWithConvo();
  // deno-lint-ignore no-explicit-any
  const reply = await resumeDisambiguation(admin as any, "telegram", "chat1", "pickproj:p-9");
  assertEquals(reply.kind, "confirm");
  assert(!calls.includes("ilike:projects"), "picked id should skip the project search");
  assert(calls.includes("delete:agent_conversation_state"), "convo state should be cleared");
});

Deno.test("resumeDisambiguation handles a bad callback gracefully", async () => {
  const { admin } = makeAdminWithConvo();
  // deno-lint-ignore no-explicit-any
  const reply = await resumeDisambiguation(admin as any, "telegram", "chat1", "confirm:x");
  assertEquals(reply.kind, "text");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: FAIL — `resumeDisambiguation` is not exported.

- [ ] **Step 3: Implement `resumeDisambiguation`**

In `agentActions.ts`, add directly above `export const resolveIntent`:

```typescript
// Handle a choice-button tap. Loads the persisted partial intent, injects the
// chosen id into resolved_ids, clears the disambiguation state, and re-runs
// resolveIntent (which now skips the name search). The conversation row also
// holds user_id/org_id, so we can rebuild the account without a fresh lookup.
export const resumeDisambiguation = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  chatId: string,
  callback: string,
): Promise<AgentReply> => {
  const pick = parsePickCallback(callback);
  if (!pick) {
    return { kind: "text", text: "Please rephrase the message with the full name." };
  }
  const { data } = await admin
    .from("agent_conversation_state")
    .select("partial_intent, user_id, org_id, expires_at")
    .eq("provider", provider)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) {
    await clearConvo(admin, provider, chatId);
    return { kind: "text", text: "That choice expired — please resend the command." };
  }
  const account: LinkedAccount = {
    user_id: data.user_id as string,
    current_org_id: data.org_id as string,
    external_id: chatId,
  };
  const base = data.partial_intent as Intent;
  const intent: Intent = {
    ...base,
    resolved_ids: { ...(base.resolved_ids ?? {}), [pick.idField]: pick.id },
  };
  await clearConvo(admin, provider, chatId);
  return resolveIntent(admin, provider, account, chatId, intent);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts supabase/functions/_shared/agent/disambiguation_test.ts
git commit -m "feat(bot): add resumeDisambiguation choice-tap resolver"
```

---

## Task 5: WhatsApp — `sendList` + route taps + slot-fill guard

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/whatsapp.ts`
- Modify: `supabase/functions/whatsapp-webhook/handlers.ts`

- [ ] **Step 1: Add `sendList` to `whatsapp.ts`**

In `whatsapp.ts`, add after the `sendButtons` function:

```typescript
export interface ListRow {
  /** Row id <= 200 chars, echoed back as interactive.list_reply.id. */
  id: string;
  /** Row title (max 24 chars). */
  title: string;
}

/** Interactive list message — up to 10 rows. Used for disambiguation when
 *  there are more candidates than WhatsApp's 3-button cap allows. */
export const sendList = async (
  to: string,
  body: string,
  rows: ListRow[],
): Promise<void> => {
  const capped = rows.slice(0, 10);
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: stripMarkdown(body) },
      action: {
        button: "Choose",
        sections: [{
          rows: capped.map((r) => ({
            id: r.id.slice(0, 200),
            title: r.title.slice(0, 24),
          })),
        }],
      },
    },
  });
};
```

- [ ] **Step 2: Render `choices` as a list when >3 in `handlers.ts`**

In `whatsapp-webhook/handlers.ts`, update the import line:

```typescript
import { sendMessage, sendButtons, sendList, type InteractiveButton } from "./whatsapp.ts";
```

Then add `resumeDisambiguation` to the shared-agent import:

```typescript
import {
  resolveIntent as sharedResolveIntent,
  executePending,
  loadConvo as sharedLoadConvo,
  clearConvo as sharedClearConvo,
  resumeDisambiguation as sharedResume,
} from "../_shared/agent/agentActions.ts";
```

Replace the `choices` branch at the bottom of `sendReply` with:

```typescript
  // choices — WhatsApp buttons cap at 3; use an interactive list beyond that.
  if (reply.choices.length <= 3) {
    const buttons: InteractiveButton[] = reply.choices.map((c) => ({
      id: c.callback, title: c.label,
    }));
    return sendButtons(phoneNumber, reply.prompt, buttons);
  }
  return sendList(
    phoneNumber,
    reply.prompt,
    reply.choices.map((c) => ({ id: c.callback, title: c.label })),
  );
```

- [ ] **Step 3: Route `pick*` taps in `handleInteractiveReply`**

In `whatsapp-webhook/handlers.ts`, replace the final fallback line of `handleInteractiveReply` (currently `await sendMessage(phoneNumber, "Please rephrase the message with the full name.");`) with:

```typescript
  // Disambiguation choice (button tap or list selection).
  const reply = await sharedResume(admin, PROVIDER, phoneNumber, buttonId);
  await sendReply(phoneNumber, reply);
```

- [ ] **Step 4: Guard the slot-fill path against `__pick` states**

In `handleNaturalLanguage`, change the convo guard:

```typescript
  const convo = await loadConvo(admin, phoneNumber);
  if (convo && !convo.awaiting_field.startsWith("__")) {
    const filled = { ...convo.partial_intent, [convo.awaiting_field]: text.trim() } as Intent;
    const reply = await resolveIntent(admin, account, phoneNumber, filled);
    await sendReply(phoneNumber, reply);
    return;
  }
```

- [ ] **Step 5: Type-check**

Run: `deno check supabase/functions/whatsapp-webhook/index.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-webhook/whatsapp.ts supabase/functions/whatsapp-webhook/handlers.ts
git commit -m "feat(bot): wire WhatsApp disambiguation taps + list for >3 choices"
```

---

## Task 6: Telegram — route taps + slot-fill guard

**Files:**
- Modify: `supabase/functions/telegram-webhook/handlers.ts`

- [ ] **Step 1: Import `resumeDisambiguation`**

In `telegram-webhook/handlers.ts`, update the agentActions import:

```typescript
import { resolveIntent, executePending, loadConvo, clearConvo, resumeDisambiguation } from "./agentActions.ts";
```

Then re-export it from the wrapper. In `telegram-webhook/agentActions.ts`, add below the existing exports:

```typescript
export const resumeDisambiguation = (
  admin: SupabaseClient,
  chatId: string,
  callback: string,
) => _resumeDisambiguation(admin, "telegram", chatId, callback);
```

And add `resumeDisambiguation as _resumeDisambiguation` to the import from `../_shared/agent/agentActions.ts` at the top of that file:

```typescript
import {
  resolveIntent as _resolveIntent,
  executePending as _executePending,
  loadConvo as _loadConvo,
  clearConvo as _clearConvo,
  resumeDisambiguation as _resumeDisambiguation,
} from "../_shared/agent/agentActions.ts";
```

(Adjust the `handlers.ts` import to drop the provider arg — it calls `resumeDisambiguation(admin, String(chatId), data)`.)

- [ ] **Step 2: Route `pick*` in `handleCallbackQuery`**

In `telegram-webhook/handlers.ts`, replace the final fallback of `handleCallbackQuery` (the two lines after the `cancel:` block: `await answerCallbackQuery(callbackQueryId);` and `await sendMessage(chatId, "Please rephrase...");`) with:

```typescript
  // Disambiguation choice tap.
  await answerCallbackQuery(callbackQueryId);
  const reply = await resumeDisambiguation(admin, String(chatId), data);
  await sendReply(chatId, reply);
```

- [ ] **Step 3: Guard the slot-fill path against `__pick` states**

In `handleNaturalLanguage`, change the convo guard:

```typescript
  const convo = await loadConvo(admin, String(chatId));
  if (convo && !convo.awaiting_field.startsWith("__")) {
    const filled = { ...convo.partial_intent, [convo.awaiting_field]: text.trim() } as Intent;
    const reply = await resolveIntent(admin, account, String(chatId), filled);
    await sendReply(chatId, reply);
    return;
  }
```

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/telegram-webhook/index.ts`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `deno test supabase/functions/_shared/agent/disambiguation_test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/telegram-webhook/handlers.ts supabase/functions/telegram-webhook/agentActions.ts
git commit -m "feat(bot): wire Telegram disambiguation taps"
```

---

## Task 7: Deploy + manual verification

- [ ] **Step 1: Deploy both functions**

```bash
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- [ ] **Step 2: Set up two same-named records to force disambiguation**

In TaskCalendar, create two projects both named `Launch` in your current org.

- [ ] **Step 3: Telegram — verify the tap resolves**

Send `task: ship the thing in Launch`. Expected: a message "Multiple projects match *Launch*. Pick one:" with two inline buttons. Tap one. Expected: "Create task *ship the thing* in *Launch*?" with Confirm/Cancel. Tap Confirm. Expected: "✅ Task *ship the thing* created." Verify the task appears under the correct `Launch` project in the app.

- [ ] **Step 4: WhatsApp — verify the tap resolves**

Send the same message to the WhatsApp bot. Expected: two reply buttons (≤3 → buttons). Tap one → confirm → confirm → task created.

- [ ] **Step 5: WhatsApp — verify the list path (>3 candidates)**

Create a third and fourth project named `Launch`. Send the message again. Expected: an interactive **list** ("Choose" button → 4 rows) instead of buttons. Select one → confirm flow works.

- [ ] **Step 6: Verify typing instead of tapping doesn't break**

Trigger disambiguation, then *type* a new command instead of tapping. Expected: the new command is parsed fresh (the stale `__pick` state is ignored), not slotted as a field.

---

## Self-Review

**Spec coverage (§3 Disambiguation):**
- "Persist partial intent on >1 match" → Task 3 `ambiguate` + Task 2 `queueDisambiguation`. ✓
- "`pick<type>:<id>` resolves via resumeDisambiguation" → Task 4. ✓
- "resolveIntent honors resolved_ids / skips findByName" → Task 3 `resolveRef`. ✓
- "WhatsApp >3 → interactive list" → Task 5 `sendList`. ✓
- "Telegram inline keyboard unchanged" → Task 6 routes taps; rendering already exists. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `parsePickCallback` → `{idField,id}` used identically in `resumeDisambiguation`. `resolveRef` returns `{status}` consumed in all six create blocks. `ambiguate`/`queueDisambiguation` signatures match call sites. `LoadedConvo.awaiting_field: string` consumed by both handlers' `.startsWith("__")` guard. ✓

**Note for the next phase:** edit/update (Phase 3) will add new pick prefixes (`picktask`, `pickdeal`, …) to `PICK_FIELD` and new branches to `resolveRef` call sites — the plumbing here is built to extend.
