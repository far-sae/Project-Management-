// tests/unit/dupDetection.test.ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizeCompanyName } from "@/services/supabase/dupDetection";

describe("normalization", () => {
  it("lowercases and strips +tags from gmail-style addresses", () => {
    expect(normalizeEmail("Jane+marketing@Acme.com")).toBe("jane@acme.com");
    expect(normalizeEmail("  jane@acme.com  ")).toBe("jane@acme.com");
  });
  it("returns null for empty", () => {
    expect(normalizeEmail("")).toBe(null);
    expect(normalizeEmail(null)).toBe(null);
  });
  it("strips company suffixes for matching", () => {
    expect(normalizeCompanyName("Acme Corp.")).toBe("acme");
    expect(normalizeCompanyName("Acme  Inc")).toBe("acme");
    expect(normalizeCompanyName("ACME LLC")).toBe("acme");
  });
});
