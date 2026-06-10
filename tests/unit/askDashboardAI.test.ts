// tests/unit/askDashboardAI.test.ts
//
// The Ask-AI client service is the LAST line of defence before a spec reaches
// the render path, so we lock down its registry sanitization: only specs whose
// metric/chartType/dimension/timeframe are all valid against the live METRICS
// registry survive; anything else collapses to a friendly { error }.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client so `functions.invoke` returns whatever the test sets.
const invokeMock = vi.fn();
vi.mock("@/services/supabase/config", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { askDashboardAI, buildCatalog, isFailure } from "@/services/dashboards/askDashboardAI";
import { METRICS } from "@/services/dashboards/metrics";

const ok = (widget: unknown, takeaway = "A takeaway.") =>
  invokeMock.mockResolvedValueOnce({ data: { widget, takeaway }, error: null });

describe("buildCatalog", () => {
  it("derives one compact entry per registry metric, preserving constraints", () => {
    const catalog = buildCatalog();
    expect(catalog).toHaveLength(METRICS.length);
    const byStage = catalog.find((c) => c.id === "deals_by_stage")!;
    expect(byStage.chartTypes).toEqual(["bar", "donut", "funnel"]);
    expect(byStage.timeframe).toBe(false);
    const expenses = catalog.find((c) => c.id === "expenses_by_month")!;
    expect(expenses.timeframe).toBe(true);
    expect(expenses.dimensions.map((d) => d.id)).toEqual(["expenses", "bills"]);
  });
});

describe("askDashboardAI sanitization", () => {
  beforeEach(() => invokeMock.mockReset());

  it("accepts a valid spec and returns widget + takeaway", async () => {
    ok({ metricId: "deals_by_stage", chartType: "bar", dimension: null, timeframe: null, title: "Deals" });
    const res = await askDashboardAI("org-1", "deals by stage");
    expect(isFailure(res)).toBe(false);
    if (!isFailure(res)) {
      expect(res.widget.metricId).toBe("deals_by_stage");
      expect(res.widget.chartType).toBe("bar");
      expect(res.widget.dimension).toBeUndefined();
      expect(res.widget.timeframe).toBeUndefined();
      expect(res.takeaway).toBe("A takeaway.");
    }
  });

  it("keeps a valid dimension + timeframe", async () => {
    ok({ metricId: "expenses_by_month", chartType: "line", dimension: "bills", timeframe: "90d", title: "Bills" });
    const res = await askDashboardAI("org-1", "vendor bills by month");
    expect(isFailure(res)).toBe(false);
    if (!isFailure(res)) {
      expect(res.widget.dimension).toBe("bills");
      expect(res.widget.timeframe).toBe("90d");
    }
  });

  it("rejects an unknown metric", async () => {
    ok({ metricId: "not_a_metric", chartType: "bar", title: "Nope" });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("rejects a chart type the metric does not allow", async () => {
    // open_pipeline_value only supports kpi.
    ok({ metricId: "open_pipeline_value", chartType: "donut", title: "Pipeline" });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("rejects a dimension not offered by the metric", async () => {
    ok({ metricId: "deals_by_stage", chartType: "bar", dimension: "made_up", title: "x" });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("rejects a timeframe on a metric that has none", async () => {
    ok({ metricId: "deals_by_stage", chartType: "bar", timeframe: "30d", title: "x" });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("passes through a server { error } body as a friendly failure", async () => {
    invokeMock.mockResolvedValueOnce({ data: { error: "bad" }, error: null });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("treats a transport error as a failure", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    expect(isFailure(await askDashboardAI("org-1", "?"))).toBe(true);
  });

  it("short-circuits an empty question without calling the edge fn", async () => {
    expect(isFailure(await askDashboardAI("org-1", "   "))).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("sends the derived catalog in the request body", async () => {
    ok({ metricId: "win_rate", chartType: "kpi", title: "Win rate" });
    await askDashboardAI("org-9", "win rate");
    expect(invokeMock).toHaveBeenCalledWith("dashboard-ai", {
      body: expect.objectContaining({
        organization_id: "org-9",
        question: "win rate",
        catalog: expect.arrayContaining([
          expect.objectContaining({ id: "win_rate" }),
        ]),
      }),
    });
  });
});
