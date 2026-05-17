// tests/unit/sendWindow.test.ts
import { describe, it, expect } from "vitest";
import { nextSendableTime } from "../../supabase/functions/crm-run-automations/triggers/sendWindow.ts";

const W = (overrides: Partial<{ hours: [number, number]; days: number[]; timezone: string }> = {}) => ({
  hours: [9, 18] as [number, number],
  days: [1, 2, 3, 4, 5],
  timezone: "UTC",
  ...overrides,
});

describe("nextSendableTime", () => {
  it("returns now when null window (any time)", () => {
    const now = new Date("2026-05-17T03:00:00Z");
    expect(nextSendableTime(null, now).toISOString()).toBe(now.toISOString());
  });

  it("returns now when inside window", () => {
    const now = new Date("2026-05-18T10:00:00Z"); // Mon 10am UTC
    expect(nextSendableTime(W(), now).toISOString()).toBe(now.toISOString());
  });

  it("jumps to start hour later same day when before window on a valid weekday", () => {
    const now = new Date("2026-05-18T03:00:00Z"); // Mon 3am UTC
    const next = nextSendableTime(W(), now);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCDate()).toBe(18);
  });

  it("jumps to Monday morning when called on Saturday", () => {
    const now = new Date("2026-05-16T14:00:00Z"); // Saturday
    const next = nextSendableTime(W(), now);
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.getUTCHours()).toBe(9);
  });

  it("respects non-UTC timezone (NYC offset)", () => {
    // 14:00 UTC = 09:00 America/New_York (EST, UTC-5) — should be inside a 9–18 NYC window.
    const now = new Date("2026-01-12T14:00:00Z"); // Monday Jan 12
    const next = nextSendableTime(W({ timezone: "America/New_York" }), now);
    expect(next.toISOString()).toBe(now.toISOString());
  });
});
