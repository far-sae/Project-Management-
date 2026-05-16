import { describe, it, expect } from "vitest";
import { triggerConfigMatches } from "../../supabase/functions/crm-run-automations/triggers/matchers.ts";

describe("triggerConfigMatches", () => {
  it("deal_stage_entered with stage_id filter matches only that stage", () => {
    const event = { event_type: "deal_stage_entered", payload: { stage_id: "won-uuid" } } as any;
    expect(triggerConfigMatches({ stage_id: "won-uuid" }, event)).toBe(true);
    expect(triggerConfigMatches({ stage_id: "lost-uuid" }, event)).toBe(false);
  });

  it("deal_stage_entered with no filter matches any stage", () => {
    const event = { event_type: "deal_stage_entered", payload: { stage_id: "x" } } as any;
    expect(triggerConfigMatches({}, event)).toBe(true);
  });

  it("client_tagged matches the named tag", () => {
    const event = { event_type: "client_tagged", payload: { tag: "VIP" } } as any;
    expect(triggerConfigMatches({ tag: "VIP" }, event)).toBe(true);
    expect(triggerConfigMatches({ tag: "junk" }, event)).toBe(false);
  });

  it("deal_score_band_changed filters by new_band", () => {
    const event = { event_type: "deal_score_band_changed", payload: { new_band: "hot" } } as any;
    expect(triggerConfigMatches({ band: "hot" }, event)).toBe(true);
    expect(triggerConfigMatches({ band: "warm" }, event)).toBe(false);
  });
});
