import { describe, it, expect } from "vitest";
import { computeModuleAccess } from "@/services/supabase/crmGrants";

describe("computeModuleAccess", () => {
  it("gives owner/admin view + edit on every module", () => {
    const a = computeModuleAccess(true, []);
    expect(a.canView("deals")).toBe(true);
    expect(a.canEdit("deals")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
  });
  it("a member with no grants can VIEW by default but cannot edit", () => {
    const a = computeModuleAccess(false, []);
    expect(a.canView("deals")).toBe(true);   // view is the org default
    expect(a.canView("leads")).toBe(true);
    expect(a.canEdit("deals")).toBe(false);  // edit is opt-in
    expect(a.canEdit("leads")).toBe(false);
  });
  it("an edit grant adds edit on that module only", () => {
    const a = computeModuleAccess(false, [{ module: "leads", level: "edit" }]);
    expect(a.canView("leads")).toBe(true);
    expect(a.canEdit("leads")).toBe(true);
    expect(a.canEdit("deals")).toBe(false); // no grant on deals → view-only
  });
});
