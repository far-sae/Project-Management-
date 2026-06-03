import { describe, it, expect } from "vitest";
import { computeModuleAccess } from "@/services/supabase/crmGrants";

describe("computeModuleAccess", () => {
  it("gives owner/admin full edit on every module regardless of grants", () => {
    const a = computeModuleAccess(true, []);
    expect(a.canView("deals")).toBe(true);
    expect(a.canEdit("deals")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
  });
  it("denies a non-admin with no grants", () => {
    const a = computeModuleAccess(false, []);
    expect(a.canView("deals")).toBe(false);
    expect(a.canEdit("deals")).toBe(false);
  });
  it("view grant -> can view but not edit", () => {
    const a = computeModuleAccess(false, [{ module: "deals", level: "view" }]);
    expect(a.canView("deals")).toBe(true);
    expect(a.canEdit("deals")).toBe(false);
    expect(a.canView("leads")).toBe(false);
  });
  it("edit grant -> can view and edit", () => {
    const a = computeModuleAccess(false, [{ module: "leads", level: "edit" }]);
    expect(a.canView("leads")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
  });
});
