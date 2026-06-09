// tests/unit/activities.pmtask.test.ts
// Unit tests for pm_task activity surfacing via filterByEntity (migration 132).
// Mirrors the structure of activities.timeline.test.ts.

import { describe, it, expect } from "vitest";
import {
  pmTaskToActivity,
  filterByEntity,
  type PmTaskRow,
} from "@/services/supabase/activities";

const makePmTaskRow = (overrides: Partial<PmTaskRow> = {}): PmTaskRow => ({
  task_id: "t1",
  title: "Onboard Acme Corp",
  source_deal_id: "d1",
  source_client_id: "c1",
  completed_at: "2026-06-07T10:00:00Z",
  project_id: "p1",
  organization_id: "o1",
  ...overrides,
});

describe("pmTaskToActivity", () => {
  it("maps a done PM task to an activity with kind pm_task", () => {
    const row = makePmTaskRow();
    const a = pmTaskToActivity(row);
    expect(a.kind).toBe("pm_task");
    expect(a.open).toBe(false);
    expect(a.title).toBe("Delivery task completed: Onboard Acme Corp");
    expect(a.id).toBe("pm_task:t1");
    expect(a.whenAt).toEqual(new Date("2026-06-07T10:00:00Z"));
    expect(a.source.kind).toBe("pm_task");
  });

  it("handles null completed_at gracefully", () => {
    const row = makePmTaskRow({ completed_at: null });
    const a = pmTaskToActivity(row);
    expect(a.whenAt).toBeNull();
  });
});

describe("filterByEntity with pm_task", () => {
  // A task linked to both deal d1 and client c1
  const pmTaskBoth = pmTaskToActivity(makePmTaskRow({
    task_id: "t1", source_deal_id: "d1", source_client_id: "c1",
  }));
  // A task linked only to client c1 (no deal)
  const pmTaskClientOnly = pmTaskToActivity(makePmTaskRow({
    task_id: "t2", source_deal_id: null, source_client_id: "c1",
  }));
  // A task linked to a different deal d2 / client c2
  const pmTaskOther = pmTaskToActivity(makePmTaskRow({
    task_id: "t3", source_deal_id: "d2", source_client_id: "c2",
  }));

  const all = [pmTaskBoth, pmTaskClientOnly, pmTaskOther];

  it("surfaces done pm_task with source_deal_id for that deal", () => {
    const result = filterByEntity(all, "deal", "d1");
    expect(result.map((a) => a.id)).toContain("pm_task:t1");
    expect(result.find((a) => a.id === "pm_task:t2")).toBeUndefined();
    expect(result.find((a) => a.id === "pm_task:t3")).toBeUndefined();
  });

  it("surfaces done pm_task with source_client_id for that client", () => {
    const result = filterByEntity(all, "client", "c1");
    const ids = result.map((a) => a.id);
    expect(ids).toContain("pm_task:t1");
    expect(ids).toContain("pm_task:t2");
    expect(result.find((a) => a.id === "pm_task:t3")).toBeUndefined();
  });

  it("does not surface pm_task for unrelated deal", () => {
    const result = filterByEntity(all, "deal", "d99");
    expect(result).toHaveLength(0);
  });

  it("does not surface pm_task for leads (N/A per spec)", () => {
    const result = filterByEntity(all, "lead", "l1");
    expect(result).toHaveLength(0);
  });
});
