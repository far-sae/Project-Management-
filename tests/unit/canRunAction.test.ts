import { describe, it, expect } from "vitest";
import { canRunAction } from "@/services/agent/agentActions";

const perms = (over: Partial<{ isAdmin: boolean; deals: boolean; leads: boolean }> = {}) => ({
  isAdmin: over.isAdmin ?? false,
  canEditModule: (m: "deals" | "leads") => (m === "deals" ? !!over.deals : !!over.leads),
});

describe("canRunAction", () => {
  it("deal actions require deals edit grant", () => {
    expect(canRunAction("create_deal", perms({ deals: false }))).toBe(false);
    expect(canRunAction("update_deal", perms({ deals: true }))).toBe(true);
    expect(canRunAction("move_deal_stage", perms({ deals: true }))).toBe(true);
  });
  it("lead actions require leads edit grant", () => {
    expect(canRunAction("create_lead", perms({ leads: false }))).toBe(false);
    expect(canRunAction("update_lead_status", perms({ leads: true }))).toBe(true);
  });
  it("non-CRM-module actions require admin", () => {
    expect(canRunAction("create_project", perms({ isAdmin: false }))).toBe(false);
    expect(canRunAction("create_project", perms({ isAdmin: true }))).toBe(true);
    expect(canRunAction("create_client", perms({ isAdmin: true }))).toBe(true);
  });
});
