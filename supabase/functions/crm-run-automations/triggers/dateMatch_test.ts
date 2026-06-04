import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { targetDateFor } from "./dateMatch.ts";

const NOW = new Date("2026-06-04T12:00:00Z");

Deno.test("targetDateFor: -3 (3 days before close) targets a future date", () => {
  assertEquals(targetDateFor(-3, NOW), "2026-06-07");
});

Deno.test("targetDateFor: +2 (2 days after) targets a past date", () => {
  assertEquals(targetDateFor(2, NOW), "2026-06-02");
});

Deno.test("targetDateFor: 0 is today", () => {
  assertEquals(targetDateFor(0, NOW), "2026-06-04");
});
