import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatLocal } from "./format.ts";

// 2026-06-01T15:00:00Z is 16:00 in London (BST) and 11:00 in New York (EDT).
Deno.test("formatLocal renders an ISO instant in the given IANA zone", () => {
  const iso = "2026-06-01T15:00:00Z";
  assertEquals(formatLocal(iso, "Europe/London"), "1 Jun 2026, 16:00");
  assertEquals(formatLocal(iso, "America/New_York"), "1 Jun 2026, 11:00");
});

Deno.test("formatLocal falls back to UTC when tz is null/empty", () => {
  const iso = "2026-06-01T15:00:00Z";
  assertEquals(formatLocal(iso, null), "1 Jun 2026, 15:00");
  assertEquals(formatLocal(iso, ""), "1 Jun 2026, 15:00");
});

Deno.test("formatLocal returns the raw string when it is not a valid date", () => {
  assertEquals(formatLocal("not-a-date", "UTC"), "not-a-date");
});
