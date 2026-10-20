import { describe, expect, it } from "vitest";

import { TASKS_SAFE_SELECT } from "@/services/supabase/database";

describe("task schema compatibility", () => {
  it("does not make background task reads depend on migration 165", () => {
    const selectedColumns = TASKS_SAFE_SELECT.split(",").map((column) => column.trim());

    expect(selectedColumns).toContain("source_deal_id");
    expect(selectedColumns).toContain("source_client_id");
    expect(selectedColumns).not.toContain("source_crm_deal_id");
    expect(selectedColumns).not.toContain("source_crm_contact_id");
  });

  it("never exposes the task PIN hash", () => {
    expect(TASKS_SAFE_SELECT).not.toContain("lock_pin_hash");
  });
});
