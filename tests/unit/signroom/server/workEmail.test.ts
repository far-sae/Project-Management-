// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SCOPES, PROVIDER_HOSTS, TENANT_PATTERN, SIGN_IN_FAILED_MESSAGE, PROVIDER_UNCONFIRMED_MESSAGE,
  authorizeUrl, exchangeCode, providerFetch, renewAccess,
  sendViaProvider, signedInAddress, isValidTenant,
} from "../../../../api/_signroom/workEmail";

type Call = { url: string; init: RequestInit };
function fake(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(String(url), init ?? {});
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const google = { provider: "google" as const, clientId: "cid", tenant: "" };
const ms = { provider: "microsoft" as const, clientId: "cid", tenant: "contoso.onmicrosoft.com" };
const form = (c: Call) => new URLSearchParams(String(c.init.body));

describe("authorizeUrl", () => {
  it("builds Google's URL with PKCE S256", () => {
    const verifier = "v".repeat(64);
    const u = new URL(authorizeUrl(google, "https://app.example.com/cb", "st", verifier));
    expect(u.host).toBe("accounts.google.com");
    expect(u.pathname).toBe("/o/oauth2/v2/auth");
    const p = u.searchParams;
    expect(p.get("scope")).toBe(SCOPES.google);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(u.href).not.toContain(verifier);
    expect(u.href).not.toContain("client_secret");
  });
  it("builds Microsoft's tenant URL without access_type", () => {
    const u = new URL(authorizeUrl(ms, "https://app.example.com/cb", "st", "ver"));
    expect(u.host).toBe("login.microsoftonline.com");
    expect(u.pathname).toBe("/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    expect(u.searchParams.get("access_type")).toBeNull();
    expect(u.searchParams.get("scope")).toBe(SCOPES.microsoft);
  });
  it("refuses hostile tenants", () => {
    for (const t of [".", "..", "a..b", ".a", "a.", "evil.example/x", "a#b", "a?b", "x".repeat(101), ""]) {
      expect(isValidTenant(t), t).toBe(false);
      expect(() => authorizeUrl({ ...ms, tenant: t }, "r", "s", "v"), t).toThrow("Enter a valid Microsoft tenant ID or domain.");
    }
    for (const t of ["organizations", "common", "consumers", "contoso.onmicrosoft.com", "0a-b.c"]) expect(isValidTenant(t)).toBe(true);
    expect(TENANT_PATTERN.test("organizations")).toBe(true);
  });
});

describe("providerFetch", () => {
  it("refuses other hosts before fetching", async () => {
    const { f, calls } = fake(() => json({}));
    for (const url of [
      "https://evil.example/token", "http://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com.evil.example/", "https://graph.microsoft.com@evil.example/",
    ]) await expect(providerFetch(f, url)).rejects.toThrow("Unapproved email API endpoint");
    expect(calls).toHaveLength(0);
    expect(PROVIDER_HOSTS).toHaveLength(5);
  });
  it("calls allowed hosts with redirect error and a signal", async () => {
    const { f, calls } = fake(() => json({}));
    await providerFetch(f, "https://graph.microsoft.com/v1.0/me");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("exchangeCode", () => {
  const args = ["CODE-123", "https://app.example.com/cb?x=1", "VER"] as const;
  it("posts the grant with client_secret when stored", async () => {
    const { f, calls } = fake(() => json({ access_token: "a", refresh_token: "r", expires_in: 3599 }));
    const out = await exchangeCode(f, google, { clientSecret: "S" }, ...args);
    expect(out).toEqual({ accessToken: "a", refreshToken: "r", expiresIn: 3599 });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    const b = form(calls[0]);
    expect(b.get("grant_type")).toBe("authorization_code");
    expect(b.get("code")).toBe("CODE-123");
    expect(b.get("client_id")).toBe("cid");
    expect(b.get("redirect_uri")).toBe("https://app.example.com/cb?x=1");
    expect(b.get("code_verifier")).toBe("VER");
    expect(b.get("client_secret")).toBe("S");
  });
  it("omits client_secret and uses the tenant token URL", async () => {
    const { f, calls } = fake(() => json({ access_token: "a" }));
    await exchangeCode(f, ms, {}, ...args);
    expect(calls[0].url).toBe("https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token");
    expect(form(calls[0]).has("client_secret")).toBe(false);
  });
  it("fails with the fixed sentence, leaking nothing", async () => {
    for (const r of [json({ error: "SECRET-BODY" }, 400), new Response("<html>SECRET-BODY</html>"), json({ foo: 1 })]) {
      const { f } = fake(() => r);
      const e = await exchangeCode(f, google, {}, ...args).catch((x) => x);
      expect(e.message).toBe(SIGN_IN_FAILED_MESSAGE);
      expect(e.status).toBe(400);
      expect(e.message).not.toContain("CODE-123");
    }
  });
});

describe("signedInAddress", () => {
  it("reads Google userinfo", async () => {
    const { f, calls } = fake(() => json({ email: "You@Acme.test" }));
    expect(await signedInAddress(f, "google", "T")).toBe("you@acme.test");
    expect(calls[0].url).toBe("https://openidconnect.googleapis.com/v1/userinfo");
  });
  it("reads Graph me", async () => {
    const { f, calls } = fake(() => json({ mail: null, userPrincipalName: "Me@Contoso.com" }));
    expect(await signedInAddress(f, "microsoft", "T")).toBe("me@contoso.com");
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer T");
  });
  it("returns empty when not ok", async () => {
    const { f } = fake(() => json({ email: "a@b.co" }, 401));
    expect(await signedInAddress(f, "google", "T")).toBe("");
  });
});

describe("renewAccess", () => {
  const secrets = { refreshToken: "R", clientSecret: "S" };
  it("renews", async () => {
    const { f, calls } = fake(() => json({ access_token: "a2", expires_in: 3599 }));
    expect(await renewAccess(f, google, secrets)).toEqual({ kind: "ok", accessToken: "a2", refreshToken: undefined, expiresIn: 3599 });
    expect(form(calls[0]).get("grant_type")).toBe("refresh_token");
    expect(form(calls[0]).get("refresh_token")).toBe("R");
    expect(form(calls[0]).has("scope")).toBe(false);
  });
  it("adds scope for Microsoft", async () => {
    const { f, calls } = fake(() => json({ access_token: "a2" }));
    await renewAccess(f, ms, secrets);
    expect(form(calls[0]).get("scope")).toBe(SCOPES.microsoft);
  });
  it("classifies failures", async () => {
    for (const [r, kind] of [[json({ error: "invalid_grant" }, 400), "refused"], [json({}, 401), "refused"], [json({}, 503), "unreachable"], [json({}), "unreachable"], [new Response("x"), "unreachable"]] as const) {
      const { f } = fake(() => r);
      expect((await renewAccess(f, google, secrets)).kind).toBe(kind);
    }
    const thrown = vi.fn(async () => { throw new TypeError("net"); }) as unknown as typeof fetch;
    expect((await renewAccess(thrown, google, secrets)).kind).toBe("unreachable");
  });
  it("is refused with no refresh token, without a request", async () => {
    const { f, calls } = fake(() => json({}));
    expect((await renewAccess(f, google, {})).kind).toBe("refused");
    expect(calls).toHaveLength(0);
  });
});

describe("sendViaProvider", () => {
  const from = { name: "Acme Ltd", address: "you@acme.test" };
  const m = { to: "pay@bloom.co", subject: "Invoice ü", text: "Hello ".repeat(40), replyTo: "accounts@acme.test" };
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  it("sends a Gmail raw message", async () => {
    const { f, calls } = fake(() => json({ id: "g1" }));
    await sendViaProvider(f, "google", "T", from, m, "d1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const raw = Buffer.from(JSON.parse(String(calls[0].init.body)).raw, "base64url").toString();
    const lines = raw.split("\r\n");
    expect(lines).toContain(`From: =?UTF-8?B?${b64("Acme Ltd")}?= <you@acme.test>`);
    expect(lines).toContain("To: pay@bloom.co");
    expect(lines).toContain("Reply-To: accounts@acme.test");
    expect(lines).toContain(`Subject: =?UTF-8?B?${b64("Invoice ü")}?=`);
    expect(lines).toContain("Message-ID: <d1@acme.test>");
    expect(lines).toContain("Content-Type: text/plain; charset=UTF-8");
    const body = lines.slice(lines.indexOf("") + 1);
    expect(body.every((l) => l.length <= 76)).toBe(true);
    expect(Buffer.from(body.join(""), "base64").toString()).toBe(m.text);
  });
  it("encodes a hostile sender name and rejects CR/LF in addresses", async () => {
    const { f, calls } = fake(() => json({ id: "g1" }));
    await sendViaProvider(f, "google", "T", { name: "Evil\r\nBcc: x@y.z", address: "you@acme.test" }, m, "d1");
    const raw = Buffer.from(JSON.parse(String(calls[0].init.body)).raw, "base64url").toString();
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain("From: =?UTF-8?B?");
    await expect(sendViaProvider(f, "google", "T", { name: "A", address: "you@acme.test\r\nBcc: x@y.z" }, m, "d1")).rejects.toThrow();
    await expect(sendViaProvider(f, "google", "T", from, { ...m, to: "a@b.co\nBcc: x@y.z" }, "d1")).rejects.toThrow();
    await expect(sendViaProvider(f, "google", "T", from, { ...m, replyTo: "a@b.co\r\nX: y" }, "d1")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it("sends a Graph message", async () => {
    const { f, calls } = fake(() => new Response(null, { status: 202 }));
    await sendViaProvider(f, "microsoft", "T", from, m, "d1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.message.toRecipients[0].emailAddress.address).toBe("pay@bloom.co");
    expect(body.message.body.contentType).toBe("Text");
    expect(body.saveToSentItems).toBe(true);
  });
  it("maps a refusal to 502 without the body", async () => {
    const { f } = fake(() => json({ error: "LEAK" }, 401));
    const e = await sendViaProvider(f, "google", "T", from, m, "d1").catch((x) => x);
    expect(e.status).toBe(502);
    expect(e.message).toBe(PROVIDER_UNCONFIRMED_MESSAGE);
  });
  it("turns line breaks in a subject into one line", async () => {
    const g = fake(() => json({ id: "g1" }));
    await sendViaProvider(g.f, "google", "T", from, { ...m, subject: "A\r\nB\nC" }, "d1");
    const raw = Buffer.from(JSON.parse(String(g.calls[0].init.body)).raw, "base64url").toString();
    expect(raw.split("\r\n")).toContain(`Subject: =?UTF-8?B?${b64("A B C")}?=`);
    const o = fake(() => new Response(null, { status: 202 }));
    await sendViaProvider(o.f, "microsoft", "T", from, { ...m, subject: "A\r\nB" }, "d1");
    expect(JSON.parse(String(o.calls[0].init.body)).message.subject).toBe("A B");
  });
  it("refuses an unsafe message id before any request", async () => {
    const { f, calls } = fake(() => json({}));
    await expect(sendViaProvider(f, "google", "T", from, m, "d1>\r\nBcc: x@y.z")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("refuses an invalid stored tenant on renewal without a request", async () => {
    const { f, calls } = fake(() => json({ access_token: "a" }));
    expect((await renewAccess(f, { ...ms, tenant: ".." }, { refreshToken: "R" })).kind).toBe("refused");
    expect(calls).toHaveLength(0);
  });
  it("keeps the host list read-only", () => {
    expect(Object.isFrozen(PROVIDER_HOSTS)).toBe(true);
  });
});
