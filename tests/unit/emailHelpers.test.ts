import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/email/crypto";
import { encrypt as denoEncrypt } from "../../supabase/functions/_shared/crypto";
import { substitutePlaceholders, escapeHtml } from "@/lib/email/substitute";
import {
  signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, ensureUnsubscribeLink,
} from "@/lib/email/unsubscribe";
import { normalizeEmail, dedupeRecipients, filterSuppressed } from "@/lib/email/suppression";
import { buildMessage } from "@/lib/email/message";

const KEY = "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc";

describe("crypto", () => {
  it("round-trips a secret", async () => {
    const packed = await encryptSecret("hunter2", KEY);
    expect(packed).not.toContain("hunter2");
    expect(await decryptSecret(packed, KEY)).toBe("hunter2");
  });
  it("produces a different ciphertext each time", async () => {
    expect(await encryptSecret("x", KEY)).not.toBe(await encryptSecret("x", KEY));
  });
  it("fails with the wrong key", async () => {
    const other = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
    await expect(decryptSecret(await encryptSecret("x", KEY), other)).rejects.toThrow();
  });
  it("decrypts what the Deno edge-function helper encrypted (wire-compatible)", async () => {
    const packed = await denoEncrypt("shared-secret", KEY);
    expect(await decryptSecret(packed, KEY)).toBe("shared-secret");
  });
});

describe("substitutePlaceholders", () => {
  const ctx = { first_name: "Ada", company: "Acme", empty: "" };
  it("replaces known keys", () => {
    expect(substitutePlaceholders("Hi {{first_name}} at {{company}}", ctx)).toBe("Hi Ada at Acme");
  });
  it("tolerates spaces inside the braces", () => {
    expect(substitutePlaceholders("Hi {{ first_name }}", ctx)).toBe("Hi Ada");
  });
  it("replaces an unknown key with an empty string", () => {
    expect(substitutePlaceholders("Hi {{nope}}!", ctx)).toBe("Hi !");
  });
  it("escapes HTML in values so a name cannot inject markup", () => {
    expect(substitutePlaceholders("Hi {{first_name}}", { first_name: "<b>x</b>" }))
      .toBe("Hi &lt;b&gt;x&lt;/b&gt;");
  });
  it("leaves a single brace alone", () => {
    expect(substitutePlaceholders("100% {sure}", ctx)).toBe("100% {sure}");
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("unsubscribe tokens", () => {
  const S = "unsub-secret";
  it("verifies a token it signed", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m1", t, S)).toBe(true);
  });
  it("rejects a token for a different message", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m2", t, S)).toBe(false);
  });
  it("rejects a tampered token", async () => {
    const t = await signUnsubscribeToken("m1", S);
    expect(await verifyUnsubscribeToken("m1", t.slice(0, -1) + "x", S)).toBe(false);
  });
  it("rejects a token signed with a different secret", async () => {
    const t = await signUnsubscribeToken("m1", "other");
    expect(await verifyUnsubscribeToken("m1", t, S)).toBe(false);
  });
  it("builds a url", () => {
    expect(unsubscribeUrl("https://app.test", "m1", "tok"))
      .toBe("https://app.test/api/email/unsubscribe?m=m1&t=tok");
  });
});

describe("ensureUnsubscribeLink", () => {
  const url = "https://app.test/api/email/unsubscribe?m=m1&t=tok";
  it("appends a link when the body has none", () => {
    const out = ensureUnsubscribeLink("<p>Hello</p>", url);
    expect(out).toContain(url);
    expect(out.toLowerCase()).toContain("unsubscribe");
  });
  it("does not append twice when the body already links to it", () => {
    const body = `<p>Hello</p><a href="${url}">Unsubscribe</a>`;
    expect(ensureUnsubscribeLink(body, url)).toBe(body);
  });
});

describe("suppression", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Ada@Acme.COM ")).toBe("ada@acme.com");
  });
  it("dedupes case-insensitively, keeping the first", () => {
    const out = dedupeRecipients([
      { email: "a@x.com", name: "first" },
      { email: "A@X.com", name: "second" },
      { email: "b@x.com", name: "third" },
    ]);
    expect(out.map((r) => r.name)).toEqual(["first", "third"]);
  });
  it("splits sendable from suppressed, case-insensitively", () => {
    const { sendable, suppressed } = filterSuppressed(
      [{ email: "a@x.com" }, { email: "b@x.com" }],
      ["A@X.COM"],
    );
    expect(sendable.map((r) => r.email)).toEqual(["b@x.com"]);
    expect(suppressed.map((r) => r.email)).toEqual(["a@x.com"]);
  });
});

describe("buildMessage", () => {
  const base = {
    subject: "Hi {{first_name}}",
    bodyHtml: "<p>Hello {{first_name}} at {{company}}</p>",
    mergeData: { first_name: "Ada", company: "Acme" },
  };
  it("substitutes into the subject and body", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.subject).toBe("Hi Ada");
    expect(m.html).toContain("Hello Ada at Acme");
  });
  it("derives a plain-text part from the html", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.text).toContain("Hello Ada at Acme");
    expect(m.text).not.toContain("<p>");
  });
  it("adds one-click unsubscribe headers for a bulk send", () => {
    const url = "https://app.test/api/email/unsubscribe?m=m1&t=tok";
    const m = buildMessage({ ...base, kind: "bulk", unsubscribeUrl: url });
    expect(m.headers["List-Unsubscribe"]).toBe(`<${url}>`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.html).toContain(url);
  });
  it("adds no unsubscribe headers for a single transactional send", () => {
    const m = buildMessage({ ...base, kind: "single" });
    expect(m.headers["List-Unsubscribe"]).toBeUndefined();
    expect(m.html).not.toContain("unsubscribe");
  });
});
