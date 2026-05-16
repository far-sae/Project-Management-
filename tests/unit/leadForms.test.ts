// tests/unit/leadForms.test.ts
import { describe, it, expect } from "vitest";
import { validateFormFields, validateSlug } from "@/services/supabase/leadForms";

describe("leadForms validation", () => {
  it("accepts a valid slug", () => {
    expect(() => validateSlug("acme-newbiz")).not.toThrow();
  });
  it("rejects slugs with spaces or upper case", () => {
    expect(() => validateSlug("Acme NewBiz")).toThrow();
    expect(() => validateSlug("ab")).toThrow();   // too short
    expect(() => validateSlug("a".repeat(50))).toThrow();  // too long
  });
  it("requires email and name fields in v1", () => {
    expect(() => validateFormFields([])).toThrow();
    const valid = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ];
    expect(() => validateFormFields(valid as any)).not.toThrow();
  });
});
