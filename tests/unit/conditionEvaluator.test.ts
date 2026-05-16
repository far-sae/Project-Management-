import { describe, it, expect } from "vitest";
import { evaluateConditions } from "../../supabase/functions/crm-run-automations/conditions/evaluator.ts";

describe("evaluateConditions", () => {
  const event = {
    event_type: "deal_stage_entered",
    payload: { value: 12000, currency: "USD", client_id: "c1", title: "Renewal" },
  } as any;
  const ctx = {
    deal: { value: 12000, currency: "USD", owner_id: "u1" },
    client: { industry: "SaaS", country: "US", tags: ["VIP", "prospect"] },
  };

  it("empty conditions → true", () => {
    expect(evaluateConditions([], event, ctx)).toBe(true);
  });

  it("gte on deal.value passes", () => {
    expect(evaluateConditions([{ field: "deal.value", operator: "gte", value: 1000 }], event, ctx)).toBe(true);
  });

  it("gte on deal.value fails", () => {
    expect(evaluateConditions([{ field: "deal.value", operator: "gte", value: 100000 }], event, ctx)).toBe(false);
  });

  it("in on client.industry passes", () => {
    expect(evaluateConditions(
      [{ field: "client.industry", operator: "in", value: ["SaaS", "FinTech"] }],
      event, ctx,
    )).toBe(true);
  });

  it("contains on client.tags passes when tag present", () => {
    expect(evaluateConditions(
      [{ field: "client.tags", operator: "contains", value: "VIP" }],
      event, ctx,
    )).toBe(true);
  });

  it("AND semantics: all must pass", () => {
    expect(evaluateConditions([
      { field: "deal.value", operator: "gte", value: 1000 },
      { field: "client.country", operator: "eq", value: "US" },
    ], event, ctx)).toBe(true);
    expect(evaluateConditions([
      { field: "deal.value", operator: "gte", value: 1000 },
      { field: "client.country", operator: "eq", value: "FR" },
    ], event, ctx)).toBe(false);
  });
});
