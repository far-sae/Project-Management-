import { describe, it, expect } from "vitest";
import { hashLookupKey, isCacheFresh } from "@/supabase-functions/_shared/apollo";

describe("apolloCache", () => {
  it("hashLookupKey returns hex sha256 (lowercased, trimmed)", async () => {
    const h = await hashLookupKey("jane@acme.com");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await hashLookupKey("JANE@acme.com"));
    expect(h).toBe(await hashLookupKey("  jane@acme.com  "));
  });

  it("isCacheFresh returns true for rows fetched within 30 days", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(recent)).toBe(true);
  });

  it("isCacheFresh returns false for rows older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isCacheFresh(old)).toBe(false);
  });

  it("isCacheFresh returns false for nullish input", () => {
    expect(isCacheFresh(null)).toBe(false);
    expect(isCacheFresh(undefined as unknown as string)).toBe(false);
  });
});
