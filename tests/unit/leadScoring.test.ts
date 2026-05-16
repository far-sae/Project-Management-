// tests/unit/leadScoring.test.ts
import { describe, it, expect } from "vitest";
import {
  mapRuleRow,
  validateRuleInput,
  bandFromScore,
} from "@/services/supabase/leadScoring";

describe("leadScoring", () => {
  it("maps a rule row", () => {
    const row = {
      rule_id: "r1",
      organization_id: "o1",
      label: "Big revenue",
      field: "annual_revenue",
      operator: "gte",
      value: 1000000,
      points: 20,
      position: 1,
      enabled: true,
      created_at: "2026-05-16T00:00:00Z",
      updated_at: "2026-05-16T00:00:00Z",
    };
    const r = mapRuleRow(row);
    expect(r.field).toBe("annual_revenue");
    expect(r.points).toBe(20);
    expect(r.enabled).toBe(true);
  });

  it("rejects invalid operator", () => {
    expect(() =>
      validateRuleInput({ label: "x", field: "industry", operator: "wat" as any, value: 1, points: 5 })
    ).toThrow();
  });

  it("derives band from score and thresholds", () => {
    expect(bandFromScore(80, { hot: 70, warm: 40 })).toBe("hot");
    expect(bandFromScore(50, { hot: 70, warm: 40 })).toBe("warm");
    expect(bandFromScore(10, { hot: 70, warm: 40 })).toBe("cold");
  });
});
