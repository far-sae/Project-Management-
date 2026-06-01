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
