import { describe, it, expect } from "vitest";
import { sanitizeDraft } from "@/services/supabase/automationDraft";

describe("sanitizeDraft", () => {
  it("keeps a valid draft and drops unknown action types", () => {
    const d = sanitizeDraft({
      name: "Welcome", enabled: true,
      trigger: { type: "client_created", config: {} },
      conditions: [],
      actions: [{ type: "send_email", config: { to: "client_email", subject: "Hi", body_html: "Welcome" } },
                 { type: "teleport", config: {} }],
    });
    expect(d).not.toBeNull();
    expect(d!.actions.map((a) => a.type)).toEqual(["send_email"]);
  });
  it("returns null for an unknown trigger type", () => {
    expect(sanitizeDraft({ name: "x", enabled: true, trigger: { type: "telepathy", config: {} }, conditions: [], actions: [{ type: "notify", config: {} }] })).toBeNull();
  });
  it("returns null when no valid actions remain", () => {
    expect(sanitizeDraft({ name: "x", enabled: true, trigger: { type: "client_created", config: {} }, conditions: [], actions: [{ type: "nope", config: {} }] })).toBeNull();
  });
  it("returns null for non-object input", () => {
    expect(sanitizeDraft(null)).toBeNull();
    expect(sanitizeDraft("oops")).toBeNull();
  });
});
