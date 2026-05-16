// tests/unit/forecast.test.ts
import { describe, it, expect } from "vitest";
import {
  aggregateForecast,
  ForecastRow,
} from "@/services/supabase/forecast";

const r = (over: Partial<ForecastRow>): ForecastRow => ({
  organizationId: "o1",
  pipelineId: "p1",
  ownerId: "u1",
  ownerName: "Faraz",
  currency: "USD",
  monthBucket: "2026-05",
  value: 0,
  weightedValue: 0,
  isWon: false,
  isLost: false,
  stageKey: "lead",
  ...over,
});

describe("aggregateForecast", () => {
  it("buckets committed vs best-case vs pipeline", () => {
    const rows: ForecastRow[] = [
      r({ value: 100, weightedValue: 100, isWon: true,  monthBucket: "2026-05" }),
      r({ value: 200, weightedValue: 100, isWon: false, monthBucket: "2026-05" }),
      r({ value: 50,  weightedValue: 25,  isWon: false, monthBucket: "2026-06" }),
    ];
    const out = aggregateForecast(rows, { months: ["2026-05", "2026-06"] });
    expect(out["2026-05"].committed).toBe(100);
    expect(out["2026-05"].bestCase).toBe(100);
    expect(out["2026-05"].pipeline).toBe(200);
    expect(out["2026-06"].pipeline).toBe(50);
  });

  it("ignores months outside range", () => {
    const rows = [r({ value: 999, monthBucket: "2025-01" })];
    const out = aggregateForecast(rows, { months: ["2026-05"] });
    expect(out["2026-05"].pipeline).toBe(0);
  });
});
