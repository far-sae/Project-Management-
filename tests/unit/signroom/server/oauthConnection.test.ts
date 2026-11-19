// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentWorkspace } from "../../../../api/_signroom/context";
import { emailConnectionAction } from "../../../../api/_signroom/emailConnection";
import { newSecret, sha } from "../../../../api/_signroom/billing";
import { encryptPassword, decryptPassword, KEY_UNAVAILABLE_MESSAGE } from "../../../../api/_signroom/mailbox/crypto";
import {
  accessFor,
  CALLBACK_ORIGIN_MESSAGE,
  CLIENT_ID_MESSAGE,
  CODE_EXPIRED_MESSAGE,
  CODE_WRONG_MESSAGE,
  finishAuthorization,
  OAUTH_TEST_LIMIT,
  OAUTH_TEST_TOOL,
  RATE_MESSAGE,
  redirectUriFor,
  SAVE_OAUTH_FIRST_MESSAGE,
  startAuthorization,
  TENANT_MESSAGE,
  TEST_BEFORE_SIGN_IN_MESSAGE,
  TEST_FAILED_MESSAGE,
  TEST_SENT_MESSAGE,
  TOO_LONG_MESSAGE,
} from "../../../../api/_signroom/oauthConnection";
import { RECONNECT_MESSAGE, WRONG_ADDRESS_MESSAGE } from "../../../../api/_signroom/workEmail";
import { SERVER_UNREACHABLE_MESSAGE } from "../../../../api/_signroom/emailConnection";
import { sessionView } from "../../../../api/_signroom/workspace";
import { ORG2, WS, WS2 } from "./helpers";
import { asSite, CALLBACK, mailSetup, ORIGIN, OWNER } from "./mailboxFixtures";

/**
 * A workspace's Google or Microsoft connection, end to end over the fake
 * store. Everything is keyed by the workspace (WS): its limits, its row, and
 * what its ciphertexts are bound to.
 */
const owner = OWNER; // { id: "u1", email: "owner@example.com", workspaceId: WS }: an admin of the organisation
/** What the secrets and the PKCE verifier are bound to. */
const AAD = "oauth:" + WS;
const STATE_AAD = "oauth-state:" + WS;
const SECRET = "synthetic-client-secret";
/** The authorization code. Long enough that the leak checks cannot match it inside a uuid. */
const CODE = "c1-synthetic-authorization-code";

type Provider = "google" | "microsoft";
type Call = { url: string; init: RequestInit };
type FakeProvider = {
  calls: Call[];
  address: string;
  tokenStatus: number;
  refresh: { status: number; body: Record<string, unknown> };
  sendStatus: number;
  userinfoThrows: boolean;
  /** Runs while the token request is in flight (to race a save against a sign-in). */
  onToken?: () => Promise<void>;
};

let consoleArgs: unknown[][];
let spies: ReturnType<typeof vi.spyOn>[];
let restoreSite: () => void;
beforeEach(() => {
  restoreSite = asSite();
  consoleArgs = [];
  spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      consoleArgs.push(a);
    }),
  );
});
afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  restoreSite();
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const form = (c: Call) => new URLSearchParams(String(c.init.body));
const isToken = (c: Call) => /\/token$/.test(new URL(c.url).pathname);
const isSend = (c: Call) => c.url.includes("/messages/send") || c.url.endsWith("/me/sendMail");

/** mailSetup() with a fetch that answers Google's and Microsoft's token, userinfo, me and send URLs. */
function setup() {
  const t = mailSetup();
  const p: FakeProvider = {
    calls: [],
    address: "Sender@Example.test",
    tokenStatus: 200,
    refresh: { status: 200, body: { access_token: "at-2", expires_in: 3600 } },
    sendStatus: 200,
    userinfoThrows: false,
  };
  t.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const c = { url, init: init ?? {} };
    p.calls.push(c);
    const u = new URL(url);
    if (isToken(c)) {
      const grant = form(c).get("grant_type");
      if (p.onToken) await p.onToken();
      if (grant === "refresh_token") return json(p.refresh.body, p.refresh.status);
      return json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }, p.tokenStatus);
    }
    if (u.hostname === "openidconnect.googleapis.com") {
      if (p.userinfoThrows) throw new TypeError("fetch failed at-1 " + url);
      return json({ email: p.address });
    }
    if (u.hostname === "graph.microsoft.com" && u.pathname === "/v1.0/me") {
      if (p.userinfoThrows) throw new TypeError("fetch failed at-1 " + url);
      return json({ mail: p.address, userPrincipalName: "upn@example.test" });
    }
    if (isSend(c)) return new Response(p.sendStatus < 300 ? '{"id":"m1"}' : "{}", { status: p.sendStatus });
    return json({ error: "unexpected" }, 404);
  }) as never;
  return { ...t, p };
}
type T = ReturnType<typeof setup>;

const SAVE = (provider: Provider, extra: Record<string, unknown> = {}) => ({
  provider,
  email: "sender@example.test",
  clientId: "synthetic-client-id",
  clientSecret: SECRET,
  tenant: "organizations",
  ...extra,
});

async function save(t: T, provider: Provider = "google", extra: Record<string, unknown> = {}) {
  return (await emailConnectionAction(t.deps, owner, "save", SAVE(provider, extra), ORIGIN)) as { verified: boolean; view: Record<string, unknown> };
}

async function authorize(t: T, origin = ORIGIN) {
  const r = (await emailConnectionAction(t.deps, owner, "authorize", {}, origin)) as { url: string; browser: string };
  const u = new URL(r.url);
  return { ...r, u, state: u.searchParams.get("state")! };
}

const view = (t: T, origin = ORIGIN) => emailConnectionAction(t.deps, owner, "view", {}, origin) as Promise<Record<string, unknown>>;
const row = (t: T) => t.store.oauthRows()[0];
const tokenCalls = (t: T) => t.p.calls.filter(isToken).length;

/** The six-digit code inside the last verification email the fake provider received. */
function sentCode(t: T, provider: Provider): string {
  const send = t.p.calls.filter(isSend).at(-1)!;
  const body = JSON.parse(String(send.init.body));
  let textBody: string;
  if (provider === "google") {
    const raw = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(raw).toContain("To: sender@example.test");
    const [, encoded] = raw.split("\r\n\r\n");
    textBody = Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8");
  } else {
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "sender@example.test" } }]);
    textBody = body.message.body.content;
  }
  const m = /verification code is (\d{6})\./.exec(textBody);
  expect(m).not.toBeNull();
  return m![1];
}

/** Saved, signed in (authenticated). */
async function signedIn(provider: Provider = "google") {
  const t = setup();
  await save(t, provider);
  const a = await authorize(t);
  await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
  return { t, a };
}

describe("save and authorize", () => {
  it.each(["google", "microsoft"] as const)("%s: official endpoint, PKCE S256, browser-bound state, no credential in the URL", async (provider) => {
    const t = setup();
    const saved = await save(t, provider);
    expect(saved.verified).toBe(false);
    expect(saved.view).toMatchObject({ configured: true, provider, status: "configured", mode: "platform", email: "sender@example.test", clientId: "synthetic-client-id", hasClientSecret: true });
    expect(saved.view.tenant).toBe(provider === "microsoft" ? "organizations" : "");
    const before = Date.now();
    const a = await authorize(t);
    expect(a.u.hostname).toBe(provider === "google" ? "accounts.google.com" : "login.microsoftonline.com");
    expect(a.u.searchParams.get("code_challenge")).toBeTruthy();
    expect(a.u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(a.u.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(a.u.searchParams.get("client_id")).toBe("synthetic-client-id");
    expect(a.url).not.toContain(SECRET);
    expect(a.url).not.toContain(a.browser);
    expect(a.browser.length).toBeGreaterThanOrEqual(43);
    const states = t.store.oauthStates();
    expect(states).toHaveLength(1);
    expect(states[0].digest).toBe(createHash("sha256").update(a.state).digest("hex"));
    expect(states[0].browserDigest).toBe(sha(a.browser));
    expect(states[0].verifierEnc.startsWith("v1:")).toBe(true);
    expect(states[0].redirectUri).toBe(CALLBACK);
    expect(states[0]).toMatchObject({ workspaceId: WS, userId: "u1", connectionId: row(t).id, revision: row(t).revision });
    expect(states[0].expires).toBeGreaterThanOrEqual(before + 600_000);
    expect(states[0].expires).toBeLessThanOrEqual(Date.now() + 600_000);
    // A forged browser is refused without any provider request.
    await expect(finishAuthorization(t.deps, { state: a.state, code: "synthetic-not-a-real-code", browser: "wrong-browser" })).rejects.toThrow();
    expect(t.p.calls).toHaveLength(0);
  });

  it("authorize with no saved Google or Microsoft configuration is refused", async () => {
    const t = setup();
    const ws = (await currentWorkspace(t.store, owner)).workspace;
    await expect(startAuthorization(t.deps, ws, owner.id, ORIGIN)).rejects.toMatchObject({ status: 400, message: SAVE_OAUTH_FIRST_MESSAGE });
    expect(t.store.oauthStates()).toHaveLength(0);
  });

  it("authorize from another origin is refused and stores nothing; localhost gets its own redirect URI", async () => {
    const t = setup();
    await save(t);
    await expect(authorize(t, "https://evil.example")).rejects.toMatchObject({ status: 400, message: CALLBACK_ORIGIN_MESSAGE });
    await expect(authorize(t, "http://localhost.evil.com")).rejects.toMatchObject({ status: 400, message: CALLBACK_ORIGIN_MESSAGE });
    expect(t.store.oauthStates()).toHaveLength(0);
    const a = await authorize(t, "http://localhost:8080");
    expect(a.u.searchParams.get("redirect_uri")).toBe("http://localhost:8080/api/signroom/email-connection/callback");
    expect(t.store.oauthStates()[0].redirectUri).toBe("http://localhost:8080/api/signroom/email-connection/callback");
  });

  it("redirectUriFor appends the fixed path to an own origin and refuses anything else", () => {
    expect(redirectUriFor(ORIGIN)).toBe(CALLBACK);
    expect(() => redirectUriFor("https://app.example.com.evil.example")).toThrow(CALLBACK_ORIGIN_MESSAGE);
    expect(() => redirectUriFor("https://app.example.com:8443")).toThrow(CALLBACK_ORIGIN_MESSAGE);
    expect(() => redirectUriFor("https://app.example.com/")).toThrow(CALLBACK_ORIGIN_MESSAGE);
    expect(() => redirectUriFor("http://app.example.com")).toThrow(CALLBACK_ORIGIN_MESSAGE);
    // The www twin of the site is the same site.
    expect(redirectUriFor("https://www.app.example.com")).toBe("https://www.app.example.com/api/signroom/email-connection/callback");
    expect(() => redirectUriFor("")).toThrow(CALLBACK_ORIGIN_MESSAGE);
  });

  it("authorize twice: only the second sign-in remains", async () => {
    const t = setup();
    await save(t);
    const first = await authorize(t);
    const second = await authorize(t);
    const states = t.store.oauthStates();
    expect(states).toHaveLength(1);
    expect(states[0].digest).toBe(sha(second.state));
    await expect(finishAuthorization(t.deps, { state: first.state, code: CODE, browser: first.browser })).rejects.toThrow();
    await finishAuthorization(t.deps, { state: second.state, code: CODE, browser: second.browser });
    expect(row(t).status).toBe("authenticated");
  });

  it("a missing key refuses the save with 503 before anything is written", async () => {
    const t = setup();
    t.deps.key = null;
    await expect(save(t)).rejects.toMatchObject({ status: 503, message: KEY_UNAVAILABLE_MESSAGE });
    expect(t.store.oauthRows()).toHaveLength(0);
  });
});

describe("the happy path", () => {
  it.each(["google", "microsoft"] as const)("%s: sign in, send the real test, confirm the code", async (provider) => {
    const t = setup();
    await save(t, provider);
    const a = await authorize(t);
    await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
    expect(row(t).status).toBe("authenticated");
    expect(row(t).verifiedAt).toBeUndefined();
    expect(t.store.oauthStates()).toHaveLength(0);

    const tokenReq = t.p.calls.find(isToken)!;
    expect(new URL(tokenReq.url).hostname).toBe(provider === "google" ? "oauth2.googleapis.com" : "login.microsoftonline.com");
    const f = form(tokenReq);
    expect(f.get("grant_type")).toBe("authorization_code");
    expect(f.get("code")).toBe(CODE);
    expect(f.get("client_secret")).toBe(SECRET);
    expect(f.get("redirect_uri")).toBe(a.u.searchParams.get("redirect_uri"));
    expect(createHash("sha256").update(f.get("code_verifier")!).digest("base64url")).toBe(a.u.searchParams.get("code_challenge"));

    const tested = (await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)) as { ok: boolean; message: string };
    expect(tested).toEqual({ ok: true, message: TEST_SENT_MESSAGE });
    const sends = t.p.calls.filter(isSend);
    expect(sends).toHaveLength(1);
    expect((sends[0].init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
    const code = sentCode(t, provider);
    expect(row(t).challenge).toMatchObject({ digest: sha(code), attempts: 0 });
    expect(row(t).lastTestAt).toBeTruthy();

    await expect(emailConnectionAction(t.deps, owner, "confirm", { code: "000000" }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_WRONG_MESSAGE });
    expect(row(t).challenge!.attempts).toBe(1);
    const done = (await emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN)) as Record<string, unknown>;
    expect(done).toMatchObject({ status: "verified", mode: "live", provider });
    expect(row(t).verifiedAt).toBeTruthy();
    expect(row(t).challenge).toBeUndefined();
    await expect(emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
    expect(await view(t)).toMatchObject({ status: "verified", mode: "live", provider });
  });

  it("signing in again after verification returns to authenticated", async () => {
    const { t } = await signedIn();
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    await emailConnectionAction(t.deps, owner, "confirm", { code: sentCode(t, "google") }, ORIGIN);
    expect(row(t).status).toBe("verified");
    const a = await authorize(t);
    await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
    expect(row(t)).toMatchObject({ status: "authenticated" });
    expect(row(t).verifiedAt).toBeUndefined();
    expect(await view(t)).toMatchObject({ status: "authenticated", mode: "platform" });
  });
});

describe("forged, replayed and stray callbacks", () => {
  /** finishAuthorization rejects, the row is unchanged and (unless allowed) no token request was made. */
  async function refused(t: T, q: Parameters<typeof finishAuthorization>[1], tokenRequests = 0) {
    const before = JSON.stringify(t.store.oauthRows());
    const calls = tokenCalls(t);
    await expect(finishAuthorization(t.deps, q)).rejects.toThrow();
    expect(JSON.stringify(t.store.oauthRows())).toBe(before);
    expect(tokenCalls(t) - calls).toBe(tokenRequests);
  }

  it("no browser cookie", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    await refused(t, { state: a.state, code: CODE });
    await refused(t, { state: a.state, code: CODE, browser: "" });
  });

  it("another browser's cookie (the state survives for the real browser)", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    await refused(t, { state: a.state, code: CODE, browser: newSecret() });
    expect(t.store.oauthStates()).toHaveLength(1);
  });

  it("the same state a second time, after a success", async () => {
    const { t, a } = await signedIn();
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
  });

  it("an expired state", async () => {
    const t = setup();
    await save(t);
    const start = new Date();
    t.deps.now = () => start;
    const a = await authorize(t);
    t.deps.now = () => new Date(start.getTime() + 600_001);
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
  });

  it("a state from before the configuration was saved again", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    const stale = t.store.oauthStates()[0];
    await save(t, "google", { clientId: "synthetic-client-id-2" });
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
    // Even if the old pending sign-in had survived the save, its connection id and revision no longer match.
    await t.store.insertOAuthState(stale);
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
    // The right connection id with an older revision is refused too.
    await t.store.insertOAuthState({ ...stale, connectionId: row(t).id, revision: row(t).revision - 1 });
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
    expect(row(t).status).toBe("configured");
  });

  it("a state for a workspace that is unknown, or that its starter has no say in", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    const st = t.store.oauthStates()[0];
    await t.store.insertOAuthState({ ...st, workspaceId: "00000000-0000-4000-8000-000000000000" });
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
    // Someone else's workspace: u1 is nobody in its organisation.
    t.store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
    t.store.setOrgMember(WS2, "u9", "admin");
    await currentWorkspace(t.store, { id: "u9", email: "other@example.com", workspaceId: WS2 });
    await t.store.insertOAuthState({ ...st, workspaceId: WS2 });
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
  });

  it("the person who started the sign-in is no longer an owner or admin when the provider redirects back", async () => {
    for (const change of [(t: T) => t.store.setOrgMember(WS, owner.id, "member"), (t: T) => t.store.setOrgMember(WS, owner.id, "admin", "removed")]) {
      const t = setup();
      await save(t);
      const a = await authorize(t);
      change(t);
      await refused(t, { state: a.state, code: CODE, browser: a.browser });
      expect(row(t).status).toBe("configured");
    }
  });

  it("after disconnect", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    await emailConnectionAction(t.deps, owner, "disconnect", {}, ORIGIN);
    await refused(t, { state: a.state, code: CODE, browser: a.browser });
    expect(t.store.oauthRows()).toHaveLength(0);
  });

  it("?error=access_denied, an over-long code or state, a missing code", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    await refused(t, { state: a.state, code: CODE, browser: a.browser, error: "access_denied" });
    await refused(t, { state: a.state, code: "x".repeat(2049), browser: a.browser });
    await refused(t, { state: a.state + "x".repeat(200), code: CODE, browser: a.browser });
    await refused(t, { state: a.state, browser: a.browser });
    await refused(t, { state: a.state, code: "", browser: a.browser });
    await refused(t, { code: CODE, browser: a.browser });
    // None of these used the pending sign-in up.
    expect(t.store.oauthStates()).toHaveLength(1);
    await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
    expect(row(t).status).toBe("authenticated");
  });

  it("a sign-in as a different address", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    t.p.address = "someone@else.test";
    const before = JSON.stringify(t.store.oauthRows());
    await expect(finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser })).rejects.toMatchObject({ message: WRONG_ADDRESS_MESSAGE });
    expect(JSON.stringify(t.store.oauthRows())).toBe(before);
    expect(row(t).status).toBe("configured");
    expect(tokenCalls(t)).toBe(1);
  });

  it("a provider that refuses the code, or a userinfo request that fails outright, is a refusal", async () => {
    const t = setup();
    await save(t);
    let a = await authorize(t);
    t.p.tokenStatus = 400;
    await refused(t, { state: a.state, code: CODE, browser: a.browser }, 1);
    t.p.tokenStatus = 200;
    t.p.userinfoThrows = true;
    a = await authorize(t);
    const before = JSON.stringify(t.store.oauthRows());
    const err = await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "AppError", status: 400 });
    expect(String((err as Error).message)).not.toContain("at-1");
    expect(JSON.stringify(t.store.oauthRows())).toBe(before);
  });

  it("a save made while the provider is answering wins: the sign-in stores nothing", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    t.p.onToken = async () => {
      t.p.onToken = undefined;
      await save(t, "google", { clientId: "changed-client-id" });
    };
    await expect(finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser })).rejects.toThrow();
    expect(row(t)).toMatchObject({ clientId: "changed-client-id", status: "configured" });
    expect(JSON.parse(decryptPassword(t.deps.key!, AAD, row(t).secretsEnc)!)).toEqual({ clientSecret: SECRET });
  });

  it("two callbacks of one state started together: exactly one fulfils", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    const q = { state: a.state, code: CODE, browser: a.browser };
    const results = await Promise.allSettled([finishAuthorization(t.deps, q), finishAuthorization(t.deps, q)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(tokenCalls(t)).toBe(1);
    expect(row(t).status).toBe("authenticated");
  });
});

describe("no secret leaves the server", () => {
  it("view, session, errors, logs and the table hold no secret in the clear", async () => {
    const t = setup();
    await save(t);
    const a = await authorize(t);
    await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
    const verifier = form(t.p.calls.find(isToken)!).get("code_verifier")!;
    const stateRow = { verifierEnc: "" };
    const errors: unknown[] = [];
    const attempt = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        errors.push(e);
      }
    };
    // Refusals that carry the secrets in.
    await attempt(finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser }));
    const b = await authorize(t);
    stateRow.verifierEnc = t.store.oauthStates()[0].verifierEnc;
    t.p.address = "someone@else.test";
    await attempt(finishAuthorization(t.deps, { state: b.state, code: CODE, browser: b.browser }));
    t.p.address = "Sender@Example.test";
    await attempt(finishAuthorization(t.deps, { state: b.state, code: CODE, browser: "wrong" }));
    t.p.userinfoThrows = true;
    const c = await authorize(t);
    await attempt(finishAuthorization(t.deps, { state: c.state, code: CODE, browser: c.browser }));
    t.p.userinfoThrows = false;
    const d = await authorize(t);
    await finishAuthorization(t.deps, { state: d.state, code: CODE, browser: d.browser });
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    const code = sentCode(t, "google");
    await attempt(emailConnectionAction(t.deps, owner, "confirm", { code: "000000" }, ORIGIN));
    const confirmed = await emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN);
    await attempt(emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN));
    t.p.sendStatus = 500;
    await attempt(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN));
    expect(errors.length).toBeGreaterThanOrEqual(6);

    const secrets = [SECRET, "at-1", "rt-1", CODE, a.state, b.state, c.state, d.state, verifier, a.browser, b.browser, c.browser, d.browser];
    const v = JSON.stringify(await view(t));
    const s = JSON.stringify(await sessionView(t.store, owner));
    const thrown = errors.map((e) => `${(e as Error).message} ${JSON.stringify(e)}`).join("\n");
    for (const secret of secrets) {
      expect(v, secret).not.toContain(secret);
      expect(JSON.stringify(confirmed), secret).not.toContain(secret);
      expect(s, secret).not.toContain(secret);
      expect(thrown, secret).not.toContain(secret);
    }
    expect(v).toContain('"hasClientSecret":true');

    // The table: ciphertext and digests only.
    const stored = row(t);
    expect(stored.secretsEnc.startsWith("v1:")).toBe(true);
    const table = JSON.stringify([t.store.oauthRows(), t.store.oauthStates(), stateRow]);
    for (const secret of secrets) expect(table, secret).not.toContain(secret);
    const plain = JSON.parse(decryptPassword(t.deps.key!, AAD, stored.secretsEnc)!);
    expect(plain).toMatchObject({ clientSecret: SECRET, accessToken: "at-1", refreshToken: "rt-1" });
    expect(typeof plain.expires).toBe("number");
    expect(decryptPassword(t.deps.key!, WS, stored.secretsEnc)).toBeNull();
    // Bound to this workspace: the same bytes under another workspace's id do not open.
    expect(decryptPassword(t.deps.key!, "oauth:" + WS2, stored.secretsEnc)).toBeNull();
    expect(decryptPassword(t.deps.key!, STATE_AAD, stateRow.verifierEnc)).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(decryptPassword(t.deps.key!, AAD, stateRow.verifierEnc)).toBeNull();

    // The logs: nothing at all that names a secret or the address.
    const logs = JSON.stringify(consoleArgs.map((args) => args.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${x.stack}` : x))));
    for (const secret of [...secrets, code, "sender@example.test", "Sender@Example.test"]) expect(logs, secret).not.toContain(secret);
  });
});

describe("a saved client secret is kept only for the same app", () => {
  it("same app with a blank secret keeps it and drops the tokens; a new client ID does not keep it", async () => {
    const { t } = await signedIn();
    expect(row(t).status).toBe("authenticated");
    const firstId = row(t).id;
    const firstRevision = row(t).revision;
    const same = await save(t, "google", { clientSecret: "" });
    expect(same.view).toMatchObject({ status: "configured", hasClientSecret: true, mode: "platform" });
    expect(row(t).id).not.toBe(firstId);
    expect(row(t).revision).toBe(firstRevision + 1);
    const plain = JSON.parse(decryptPassword(t.deps.key!, AAD, row(t).secretsEnc)!);
    expect(plain).toEqual({ clientSecret: SECRET });
    const changed = await save(t, "google", { clientSecret: "", clientId: "another-client-id" });
    expect(changed.view).toMatchObject({ status: "configured", hasClientSecret: false, clientId: "another-client-id" });
    expect(JSON.parse(decryptPassword(t.deps.key!, AAD, row(t).secretsEnc)!)).toEqual({});
  });

  it("a different tenant, address or provider does not keep the secret either", async () => {
    const t = setup();
    await save(t, "microsoft", { tenant: "contoso.onmicrosoft.com" });
    expect((await save(t, "microsoft", { tenant: "common", clientSecret: "" })).view).toMatchObject({ hasClientSecret: false });
    await save(t, "microsoft", { tenant: "common" });
    expect((await save(t, "microsoft", { tenant: "common", email: "other@example.test", clientSecret: "" })).view).toMatchObject({ hasClientSecret: false });
    await save(t, "microsoft", { tenant: "common" });
    expect((await save(t, "google", { clientSecret: "" })).view).toMatchObject({ hasClientSecret: false });
  });

  it("the view says hasClientSecret false when the key is missing or the secrets do not decrypt", async () => {
    const t = setup();
    await save(t);
    t.deps.key = null;
    expect(await view(t)).toMatchObject({ provider: "google", hasClientSecret: false });
    t.deps.key = Buffer.alloc(32, 9); // not the test key (32 bytes of 7)
    expect(await view(t)).toMatchObject({ provider: "google", hasClientSecret: false });
  });
});

describe("input aimed at other hosts", () => {
  it.each(["evil.example/x", "a#b", "a?b", "..", ".", "a".repeat(101)])("tenant %s is refused", async (tenant) => {
    const t = setup();
    await expect(save(t, "microsoft", { tenant })).rejects.toMatchObject({ status: 400, message: TENANT_MESSAGE });
    expect(t.store.oauthRows()).toHaveLength(0);
  });

  it("Google ignores the tenant and Microsoft defaults it to organizations", async () => {
    const t = setup();
    await save(t, "google", { tenant: "evil.example/x" });
    expect(row(t).tenant).toBe("");
    await save(t, "microsoft", { tenant: "" });
    expect(row(t).tenant).toBe("organizations");
  });

  it("a missing client ID, a too-long secret and a bad address are refused", async () => {
    const t = setup();
    await expect(save(t, "google", { clientId: "" })).rejects.toMatchObject({ status: 400, message: CLIENT_ID_MESSAGE });
    await expect(save(t, "google", { clientSecret: "s".repeat(4097) })).rejects.toMatchObject({ status: 400, message: TOO_LONG_MESSAGE });
    await expect(save(t, "google", { email: "not an address" })).rejects.toMatchObject({ status: 400 });
    expect(t.store.oauthRows()).toHaveLength(0);
    await save(t, "google", { clientSecret: "s".repeat(4096) });
    expect(row(t)).toBeTruthy();
  });
});

describe("test and confirm", () => {
  it("test before sign-in is refused", async () => {
    const t = setup();
    await save(t);
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 400, message: TEST_BEFORE_SIGN_IN_MESSAGE });
    expect(t.p.calls).toHaveLength(0);
  });

  it("the 4th test in an hour is refused (signroom-email-test, per workspace, 3, 60)", async () => {
    const { t } = await signedIn();
    const spend = vi.fn(t.deps.spend!);
    t.deps.spend = spend;
    for (let i = 0; i < 3; i++) await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 429, message: RATE_MESSAGE });
    expect(spend).toHaveBeenCalledWith(expect.anything(), OAUTH_TEST_TOOL, `workspace:${WS}`, OAUTH_TEST_LIMIT, 60);
    expect(OAUTH_TEST_TOOL).toBe("signroom-email-test");
    expect(OAUTH_TEST_LIMIT).toBe(3);
    expect(t.p.calls.filter(isSend)).toHaveLength(3);
    // The verification email does not count against the workspace's sending limits.
    expect(spend.mock.calls.some((c) => c[1] === "mailbox-email" || c[1] === "signroom-mail")).toBe(false);
  });

  it("a Gmail 500 is a 502 and the challenge is cleared", async () => {
    const { t } = await signedIn();
    t.p.sendStatus = 500;
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 502, message: TEST_FAILED_MESSAGE });
    expect(row(t).challenge).toBeUndefined();
    expect(row(t).lastTestAt).toBeUndefined();
    await expect(emailConnectionAction(t.deps, owner, "confirm", { code: "123456" }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
  });

  it("five wrong codes use the challenge up; an expired code is refused", async () => {
    const { t } = await signedIn();
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    const code = sentCode(t, "google");
    for (let i = 0; i < 5; i++)
      await expect(emailConnectionAction(t.deps, owner, "confirm", { code: "000000" }, ORIGIN)).rejects.toMatchObject({ message: CODE_WRONG_MESSAGE });
    await expect(emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
    expect(row(t).status).toBe("authenticated");

    const start = new Date();
    t.deps.now = () => start;
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    const fresh = sentCode(t, "google");
    t.deps.now = () => new Date(start.getTime() + 600_001);
    await expect(emailConnectionAction(t.deps, owner, "confirm", { code: fresh }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
    expect(row(t).status).toBe("authenticated");
  });

  it("two guesses at once cannot share one attempt", async () => {
    const { t } = await signedIn();
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    const results = await Promise.allSettled(
      [0, 1, 2].map(() => emailConnectionAction(t.deps, owner, "confirm", { code: "000000" }, ORIGIN)),
    );
    const counted = results.filter((r) => r.status === "rejected" && (r.reason as Error).message === CODE_WRONG_MESSAGE).length;
    expect(counted).toBeGreaterThanOrEqual(1);
    expect(row(t).challenge!.attempts).toBe(counted);
  });

  it("a right code is not accepted once the connection needs a new sign-in", async () => {
    const { t } = await signedIn();
    await emailConnectionAction(t.deps, owner, "test", {}, ORIGIN);
    const code = sentCode(t, "google");
    const r = row(t);
    await t.store.updateEmailOAuth(WS, { id: r.id, revision: r.revision }, { status: "reconnect", lastError: RECONNECT_MESSAGE });
    await expect(emailConnectionAction(t.deps, owner, "confirm", { code }, ORIGIN)).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
    expect(row(t).status).toBe("reconnect");
  });
});

describe("accessFor", () => {
  /** A signed-in connection whose access token has expired. */
  async function expired(refreshToken: string | null = "rt-1") {
    const { t } = await signedIn();
    const r = row(t);
    const secrets = { clientSecret: SECRET, accessToken: "at-1", ...(refreshToken ? { refreshToken } : {}), expires: Date.now() - 1 };
    await t.store.updateEmailOAuth(WS, { id: r.id, revision: r.revision }, { secretsEnc: encryptPassword(t.deps.key!, AAD, JSON.stringify(secrets)), status: "verified" });
    return t;
  }

  it("uses the stored token while it has over a minute left, without a request", async () => {
    const { t } = await signedIn();
    const calls = t.p.calls.length;
    expect(await accessFor(t.deps, row(t))).toBe("at-1");
    expect(t.p.calls.length).toBe(calls);
  });

  it("renews an expiring token, keeping the stored refresh token when none is returned", async () => {
    const t = await expired();
    const before = row(t);
    expect(await accessFor(t.deps, before)).toBe("at-2");
    const after = row(t);
    expect(after).toMatchObject({ id: before.id, revision: before.revision, status: "verified" });
    const plain = JSON.parse(decryptPassword(t.deps.key!, AAD, after.secretsEnc)!);
    expect(plain).toMatchObject({ clientSecret: SECRET, accessToken: "at-2", refreshToken: "rt-1" });
    expect(plain.expires).toBeGreaterThan(Date.now() + 3_000_000);
    const refresh = t.p.calls.filter((c) => isToken(c) && form(c).get("grant_type") === "refresh_token");
    expect(form(refresh[0]).get("refresh_token")).toBe("rt-1");
  });

  it("stores a new refresh token when one is returned", async () => {
    const t = await expired();
    t.p.refresh = { status: 200, body: { access_token: "at-3", refresh_token: "rt-3", expires_in: 3600 } };
    expect(await accessFor(t.deps, row(t))).toBe("at-3");
    expect(JSON.parse(decryptPassword(t.deps.key!, AAD, row(t).secretsEnc)!)).toMatchObject({ refreshToken: "rt-3" });
  });

  it("a refused renewal marks the row reconnect; the view offers sign-in again", async () => {
    const t = await expired();
    t.p.refresh = { status: 400, body: { error: "invalid_grant" } };
    await expect(accessFor(t.deps, row(t))).rejects.toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(row(t)).toMatchObject({ status: "reconnect", lastError: RECONNECT_MESSAGE });
    expect(await view(t)).toMatchObject({ status: "configured", mode: "platform", lastError: RECONNECT_MESSAGE });
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 400, message: TEST_BEFORE_SIGN_IN_MESSAGE });
  });

  it("no refresh token, or secrets that do not decrypt, also mean reconnect", async () => {
    const t = await expired(null);
    await expect(accessFor(t.deps, row(t))).rejects.toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(row(t).status).toBe("reconnect");
    const u = await expired();
    const r = row(u);
    await u.store.updateEmailOAuth(WS, { id: r.id, revision: r.revision }, { secretsEnc: encryptPassword(u.deps.key!, WS, "{}") });
    await expect(accessFor(u.deps, row(u))).rejects.toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(row(u).status).toBe("reconnect");
  });

  it("an unreachable token endpoint changes nothing and is a 502", async () => {
    const t = await expired();
    t.p.refresh = { status: 503, body: {} };
    const before = JSON.stringify(t.store.oauthRows());
    await expect(accessFor(t.deps, row(t))).rejects.toMatchObject({ status: 502, message: SERVER_UNREACHABLE_MESSAGE });
    expect(JSON.stringify(t.store.oauthRows())).toBe(before);
  });

  it("a renewal racing a new save does not overwrite the new configuration", async () => {
    const t = await expired();
    const old = row(t);
    await save(t, "google", { clientId: "new-client-id" });
    const fresh = JSON.stringify(t.store.oauthRows());
    await expect(accessFor(t.deps, old)).rejects.toThrow();
    expect(JSON.stringify(t.store.oauthRows())).toBe(fresh);
    t.p.refresh = { status: 400, body: {} };
    await expect(accessFor(t.deps, old)).rejects.toThrow();
    expect(JSON.stringify(t.store.oauthRows())).toBe(fresh);
  });

  it("a missing key is a 503", async () => {
    const { t } = await signedIn();
    t.deps.key = null;
    await expect(accessFor(t.deps, row(t))).rejects.toMatchObject({ status: 503, message: KEY_UNAVAILABLE_MESSAGE });
  });
});

describe("a never-verified connection never blocks mail", () => {
  /** Signed in (authenticated, never verified) with an expired access token. */
  async function expiredUnverified() {
    const { t } = await signedIn();
    const r = row(t);
    const secrets = { clientSecret: SECRET, accessToken: "at-1", refreshToken: "rt-1", expires: Date.now() - 1 };
    await t.store.updateEmailOAuth(WS, { id: r.id, revision: r.revision }, { secretsEnc: encryptPassword(t.deps.key!, AAD, JSON.stringify(secrets)) });
    expect(row(t).status).toBe("authenticated");
    return t;
  }

  it("a refused renewal during the verification test sets it back to configured with the reconnect sentence, not reconnect", async () => {
    const t = await expiredUnverified();
    t.p.refresh = { status: 400, body: { error: "invalid_grant" } };
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 502, message: TEST_FAILED_MESSAGE });
    expect(row(t)).toMatchObject({ status: "configured", lastError: RECONNECT_MESSAGE });
    expect(row(t).challenge).toBeUndefined();
    expect(row(t).verifiedAt).toBeUndefined();
    expect(t.p.calls.filter(isSend)).toHaveLength(0);
    // The view offers sign-in again with the sentence, and the test waits for it.
    expect(await view(t)).toMatchObject({ status: "configured", mode: "platform", lastError: RECONNECT_MESSAGE });
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 400, message: TEST_BEFORE_SIGN_IN_MESSAGE });
    // Signing in again clears the sentence.
    const a = await authorize(t);
    await finishAuthorization(t.deps, { state: a.state, code: CODE, browser: a.browser });
    expect(row(t)).toMatchObject({ status: "authenticated" });
    expect(row(t).lastError).toBeUndefined();
  });

  it("no refresh token or unreadable secrets on a never-verified row also mean configured", async () => {
    const t = await expiredUnverified();
    const r = row(t);
    await t.store.updateEmailOAuth(WS, { id: r.id, revision: r.revision }, { secretsEnc: encryptPassword(t.deps.key!, WS, "{}") });
    await expect(accessFor(t.deps, row(t))).rejects.toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(row(t)).toMatchObject({ status: "configured", lastError: RECONNECT_MESSAGE });
  });

  it("a refusal never overwrites a status that changed meanwhile", async () => {
    const t = await expiredUnverified();
    t.p.refresh = { status: 400, body: {} };
    const stale = row(t);
    // Verified (by another request) after this one read the row.
    await t.store.updateEmailOAuth(WS, { id: stale.id, revision: stale.revision }, { status: "verified" });
    await expect(accessFor(t.deps, stale)).rejects.toMatchObject({ status: 409 });
    expect(row(t).status).toBe("verified");
    expect(row(t).lastError).toBeUndefined();
  });
});
