import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveIntent } from "./agentActions.ts";
import type { Intent, LinkedAccount } from "./types.ts";

const ACCOUNT: LinkedAccount = { user_id: "u1", current_org_id: "org1", external_id: "c1" };

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
