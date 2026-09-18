import { describe, it, expect } from "vitest";
import { mapWorkspaceRow } from "@/services/supabase/workspaces";

const base = {
  workspace_id: "w1",
  name: "Marketing",
  organization_id: "o1",
  is_default: false,
  created_at: "2026-09-18T10:00:00.000Z",
  updated_at: "2026-09-18T10:00:00.000Z",
};

describe("mapWorkspaceRow", () => {
  it("maps a row with menu_pages null to menuPages null", () => {
    const ws = mapWorkspaceRow({ ...base, menu_pages: null });
    expect(ws.workspaceId).toBe("w1");
    expect(ws.menuPages).toBeNull();
    expect(ws.createdAt).toBeInstanceOf(Date);
  });
  it("maps a missing menu_pages (migration not yet applied) to null", () => {
    const ws = mapWorkspaceRow(base);
    expect(ws.menuPages).toBeNull();
  });
  it("keeps a valid list and drops unknown keys", () => {
    const ws = mapWorkspaceRow({ ...base, menu_pages: ["my_tasks", "nope"] });
    expect(ws.menuPages).toEqual(["my_tasks"]);
  });
});
