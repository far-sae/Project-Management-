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
