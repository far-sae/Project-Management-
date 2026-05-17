import { describe, it, expect } from "vitest";
import { verifySlackSignature } from "@/supabase-functions/slack-events/index";

// We import the function but never invoke Deno.serve under vitest
// (the Deno shim in tests/setup.ts swallows it).

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

const sign = async (body: string, ts: string): Promise<string> => {
  const base = `v0:${ts}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  return "v0=" + Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

describe("verifySlackSignature", () => {
  it("accepts a correctly signed request", async () => {
    const body = '{"type":"event_callback","event":{"text":"hi"}}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await sign(body, ts);
    expect(await verifySlackSignature(body, ts, sig, SECRET)).toBe(true);
  });

  it("rejects a request signed with a different secret", async () => {
    const body = "{}";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await sign(body, ts);
    expect(await verifySlackSignature(body, ts, sig, "wrong-secret")).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const body = '{"text":"hi"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await sign(body, ts);
    expect(await verifySlackSignature('{"text":"evil"}', ts, sig, SECRET)).toBe(false);
  });

  it("rejects timestamps older than 5 minutes (replay)", async () => {
    const body = "{}";
    const old = String(Math.floor(Date.now() / 1000) - 60 * 6);
    const sig = await sign(body, old);
    expect(await verifySlackSignature(body, old, sig, SECRET)).toBe(false);
  });

  it("rejects missing signature / timestamp / secret", async () => {
    const body = "{}";
    const ts = String(Math.floor(Date.now() / 1000));
    expect(await verifySlackSignature(body, ts, "", SECRET)).toBe(false);
    expect(await verifySlackSignature(body, "", "v0=abc", SECRET)).toBe(false);
    expect(await verifySlackSignature(body, ts, "v0=abc", "")).toBe(false);
  });
});
