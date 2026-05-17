// tests/unit/wait.test.ts
import { describe, it, expect, vi } from "vitest";
import { wait } from "../../supabase/functions/crm-run-automations/actions/wait.ts";

const makeCtx = (overrides: Partial<any> = {}) => {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const neq = vi.fn().mockReturnThis();
  const head = vi.fn().mockResolvedValue({ count: 0 });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "pending_actions") {
        return { insert, select: () => ({ eq: () => ({ eq: () => ({ neq: () => head() }) }) }) };
      }
      return { select, eq, neq };
    }),
  };
  return {
    admin,
    orgId: "org-1",
    event: { event_id: "evt-1", payload: { deal_id: "d-1", client_id: "c-1" } },
    recipeId: "rec-1",
    recipeName: "Test recipe",
    runStartedAt: new Date(),
    aiOutputs: {},
    nextActionIndex: 2,
    ...overrides,
  };
};

describe("wait action", () => {
  it("returns meta.defer=true and inserts a pending_actions row", async () => {
    const ctx = makeCtx();
    const r = await wait(ctx as any, { value: 1, unit: "days" });
    expect(r.status).toBe("success");
    expect(r.meta?.defer).toBe(true);
    expect(typeof r.meta?.fire_at).toBe("string");
  });

  it("rejects zero or negative values", async () => {
    const ctx = makeCtx();
    const r = await wait(ctx as any, { value: 0, unit: "minutes" });
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/> 0/);
  });

  it("requires nextActionIndex from the worker", async () => {
    const ctx = makeCtx({ nextActionIndex: undefined });
    const r = await wait(ctx as any, { value: 1, unit: "hours" });
    expect(r.status).toBe("failure");
    expect(r.message).toMatch(/nextActionIndex/);
  });

  it("fails with recursion_limit when 10 pending already exist", async () => {
    const ctx = makeCtx();
    // Override the count chain to return 10.
    ctx.admin.from = vi.fn((table: string) => {
      if (table === "pending_actions") {
        return {
          insert: vi.fn(),
          select: () => ({ eq: () => ({ eq: () => ({ neq: () => Promise.resolve({ count: 10 }) }) }) }),
        };
      }
      return { select: vi.fn(), eq: vi.fn(), neq: vi.fn() };
    });
    const r = await wait(ctx as any, { value: 1, unit: "minutes" });
    expect(r.status).toBe("failure");
    expect(r.message).toBe("recursion_limit");
  });
});
