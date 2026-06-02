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
