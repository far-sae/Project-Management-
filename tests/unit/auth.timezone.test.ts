import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the object passed to .update(...) so we can assert the mapping.
const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock("@/services/supabase/config", () => ({
  supabase: { from: () => ({ update: updateSpy }) },
}));

import { updateUserProfile } from "@/services/supabase/auth";

describe("updateUserProfile timezone mapping", () => {
  beforeEach(() => updateSpy.mockClear());

  it("maps the timezone field to the update payload", async () => {
    await updateUserProfile("user-1", { timezone: "Asia/Tokyo" });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Asia/Tokyo" }));
  });
});
