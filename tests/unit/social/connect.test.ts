// @vitest-environment node
// Connecting a social account by logging in at the platform ("Connect"),
// instead of pasting keys by hand: who may start it, where they are sent, and
// what is kept when the platform sends them back.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConnectError, STATE_COOKIE, STATE_MINUTES, connectHandler, connectSetup, finishConnect, startConnect, syncConnect,
  type ConnectDeps, type SavedAccount, type SavedServiceAccount,
} from "../../../api/_social/connect";
import { CONNECT_KINDS, CONNECT_SETTINGS } from "../../../api/_social/shared/connect";

const ENV = {
  PUBLIC_SITE_URL: "https://app.example.com/",
  INTEGRATION_TOKEN_KEY: "k".repeat(43),
  GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret",
  META_APP_ID: "m-id", META_APP_SECRET: "m-secret",
  X_CLIENT_ID: "x-id", X_CLIENT_SECRET: "x-secret",
  TIKTOK_CLIENT_KEY: "t-key", TIKTOK_CLIENT_SECRET: "t-secret",
  LINKEDIN_CLIENT_ID: "l-id", LINKEDIN_CLIENT_SECRET: "l-secret",
};
const CALLBACK = "https://app.example.com/api/social/connect/callback";
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
type Reply = { status?: number; json?: unknown };

function setUp(over: { env?: Record<string, string | undefined>; admin?: boolean; workspaceOrg?: string | null; reply?: (call: Call) => Reply; now?: number } = {}) {
  const calls: Call[] = [];
  const saved: SavedAccount[] = [];
  const linked: SavedServiceAccount[] = [];
  let admin = over.admin ?? true;
  let now = over.now ?? NOW;
  let n = 0;
  const deps: ConnectDeps = {
    env: over.env ?? ENV,
    now: () => now,
    nonce: () => `nonce-${++n}`,
    fetch: (async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const call: Call = { url: String(input), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: typeof init?.body === "string" ? init.body : "" };
      calls.push(call);
      const reply = over.reply?.(call) ?? {};
      return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
    store: {
      isAdmin: async () => admin,
      workspaceOrg: async () => (over.workspaceOrg === undefined ? "org-1" : over.workspaceOrg),
      saveAccount: async (account) => { saved.push(account); },
      saveServiceAccount: async (account) => { linked.push(account); },
    },
  };
  return { deps, calls, saved, linked, setAdmin: (value: boolean) => { admin = value; }, setNow: (value: number) => { now = value; } };
}

const begin = (deps: ConnectDeps, kind: string) => startConnect(deps, { kind, organizationId: "org-1", workspaceId: "ws-1", userId: "user-1" });
const cookieOf = (setCookie: string) => setCookie.split(";")[0];
const param = (url: string, name: string) => new URL(url).searchParams.get(name) ?? "";
const formOf = (call: Call) => Object.fromEntries(new URLSearchParams(call.body));

describe("which platforms can be connected", () => {
  it("is each platform whose own keys are set", () => {
    expect(connectSetup(ENV)).toEqual({
      via: "direct", kinds: ["youtube", "meta", "x", "tiktok", "linkedin"],
      ready: { youtube: true, meta: true, x: true, tiktok: true, linkedin: true },
      needs: { youtube: [], meta: [], x: [], tiktok: [], linkedin: [] },
      callback: CALLBACK,
    });
    const some = connectSetup({ ...ENV, META_APP_SECRET: "", TIKTOK_CLIENT_KEY: undefined, LINKEDIN_CLIENT_ID: "  " });
    expect(some.ready).toEqual({ youtube: true, meta: false, x: true, tiktok: false, linkedin: false });
    // And it says which settings each one still misses.
    expect(some.needs).toEqual({ youtube: [], meta: ["META_APP_SECRET"], x: [], tiktok: ["TIKTOK_CLIENT_KEY"], linkedin: ["LINKEDIN_CLIENT_ID"] });
  });

  it("is none without the site's address or the key that seals the stored keys", () => {
    for (const missing of ["PUBLIC_SITE_URL", "INTEGRATION_TOKEN_KEY"]) {
      const setup = connectSetup({ ...ENV, [missing]: "" });
      expect(Object.values(setup.ready)).toEqual([false, false, false, false, false]);
      expect(setup.needs.youtube).toEqual([missing]);
    }
    expect(connectSetup({ ...ENV, PUBLIC_SITE_URL: "" }).callback).toBeNull();
    // An address that is not https is not handed to a platform.
    expect(connectSetup({ ...ENV, PUBLIC_SITE_URL: "http://app.example.com" }).callback).toBeNull();
  });

  it("names the settings of every platform, for the person who sets the site up", () => {
    for (const kind of CONNECT_KINDS) expect(CONNECT_SETTINGS[kind].length).toBeGreaterThan(0);
  });
});

describe("starting", () => {
  it("is for an owner or admin of that organisation, in a workspace of it", async () => {
    const member = setUp({ admin: false });
    await expect(begin(member.deps, "youtube")).rejects.toMatchObject({ status: 403 });
    const elsewhere = setUp({ workspaceOrg: "org-2" });
    await expect(begin(elsewhere.deps, "youtube")).rejects.toMatchObject({ status: 403 });
    const gone = setUp({ workspaceOrg: null });
    await expect(begin(gone.deps, "youtube")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a platform it does not know, and one whose keys are not set", async () => {
    const { deps } = setUp();
    await expect(begin(deps, "myspace")).rejects.toMatchObject({ status: 400 });
    const off = setUp({ env: { ...ENV, GOOGLE_CLIENT_SECRET: "" } });
    await expect(begin(off.deps, "youtube")).rejects.toBeInstanceOf(ConnectError);
    await expect(begin(off.deps, "youtube")).rejects.toMatchObject({ status: 409 });
  });

  it("sends the person to Google, asking to upload videos and for a lasting key", async () => {
    const { deps } = setUp();
    const { url, cookie } = await begin(deps, "youtube");
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(param(url, "client_id")).toBe("g-id");
    expect(param(url, "redirect_uri")).toBe(CALLBACK);
    expect(param(url, "response_type")).toBe("code");
    expect(param(url, "scope")).toContain("https://www.googleapis.com/auth/youtube.upload");
    expect(param(url, "access_type")).toBe("offline");
    expect(param(url, "prompt")).toBe("consent");
    expect(param(url, "state").length).toBeGreaterThan(40);
    // The secret never travels in the address.
    expect(url).not.toContain("g-secret");
    // The browser is given a short-lived mark, so only the browser that started can finish.
    expect(cookie).toContain(`${STATE_COOKIE}=nonce-1`);
    for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/social/connect", `Max-Age=${STATE_MINUTES * 60}`]) expect(cookie).toContain(part);
  });

  it("sends the person to each other platform with what posting needs", async () => {
    const { deps } = setUp();
    const meta = (await begin(deps, "meta")).url;
    expect(meta.startsWith("https://www.facebook.com/v24.0/dialog/oauth?")).toBe(true);
    expect(param(meta, "client_id")).toBe("m-id");
    for (const scope of ["pages_show_list", "pages_manage_posts", "instagram_content_publish"]) expect(param(meta, "scope")).toContain(scope);

    const x = (await begin(deps, "x")).url;
    expect(x.startsWith("https://x.com/i/oauth2/authorize?")).toBe(true);
    for (const scope of ["tweet.write", "media.write", "offline.access"]) expect(param(x, "scope")).toContain(scope);
    expect(param(x, "code_challenge_method")).toBe("S256");
    expect(param(x, "code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Spaces in the address are written %20, which every platform reads.
    expect(x).not.toContain("+");
    // X refuses a state longer than 500 characters.
    expect(param(x, "state").length).toBeLessThanOrEqual(500);

    const tiktok = (await begin(deps, "tiktok")).url;
    expect(tiktok.startsWith("https://www.tiktok.com/v2/auth/authorize/?")).toBe(true);
    expect(param(tiktok, "client_key")).toBe("t-key");
    expect(param(tiktok, "scope")).toContain("video.publish");

    const linkedin = (await begin(deps, "linkedin")).url;
    expect(linkedin.startsWith("https://www.linkedin.com/oauth/v2/authorization?")).toBe(true);
    expect(param(linkedin, "scope")).toContain("w_member_social");
    for (const url of [meta, x, tiktok, linkedin]) expect(param(url, "redirect_uri")).toBe(CALLBACK);
  });
});

describe("coming back from the platform", () => {
  const finish = async (s: ReturnType<typeof setUp>, kind: string, over: { query?: Record<string, string>; cookie?: string } = {}) => {
    const started = await begin(s.deps, kind);
    const state = param(started.url, "state");
    const result = await finishConnect(s.deps, { state, code: "the-code", ...(over.query ?? {}) }, over.cookie ?? cookieOf(started.cookie));
    return { ...result, started, state };
  };

  it("keeps a YouTube channel with its lasting key", async () => {
    const s = setUp({ reply: (call) => call.url.startsWith("https://oauth2.googleapis.com/token")
      ? { json: { access_token: "ya29", refresh_token: "1//refresh", expires_in: 3600 } }
      : { json: { items: [{ id: "UC123", snippet: { title: "Northwind channel" } }] } } });
    const { location } = await finish(s, "youtube");
    expect(location).toBe("/social?connect=done&p=youtube&n=1");
    expect(formOf(s.calls[0])).toMatchObject({ code: "the-code", client_id: "g-id", client_secret: "g-secret", redirect_uri: CALLBACK, grant_type: "authorization_code" });
    expect(s.calls[1].url).toContain("https://www.googleapis.com/youtube/v3/channels");
    expect(s.calls[1].headers.Authorization).toBe("Bearer ya29");
    expect(s.saved).toEqual([{
      organizationId: "org-1", workspaceId: "ws-1", userId: "user-1", provider: "youtube", externalId: "UC123", name: "Northwind channel",
      secret: { accessToken: "ya29", refreshToken: "1//refresh", expiresAt: NOW + 3600_000 },
    }]);
  });

  it("says so when the Google account has no channel, and keeps nothing", async () => {
    const s = setUp({ reply: (call) => call.url.includes("/token") ? { json: { access_token: "a", refresh_token: "r", expires_in: 3600 } } : { json: { items: [] } } });
    expect((await finish(s, "youtube")).location).toBe("/social?connect=none&p=youtube");
    expect(s.saved).toEqual([]);
  });

  it("keeps every Facebook Page and the Instagram account on it, each with the Page's lasting key", async () => {
    const s = setUp({ reply: (call) => {
      if (call.url.includes("fb_exchange_token")) return { json: { access_token: "long-user" } };
      if (call.url.includes("/oauth/access_token")) return { json: { access_token: "short-user" } };
      return { json: { data: [
        { id: "111", name: "Harbour Dental", access_token: "page-1", instagram_business_account: { id: "999", username: "harbourdental" } },
        { id: "222", name: "Fieldway Logistics", access_token: "page-2" },
      ] } };
    } });
    const { location } = await finish(s, "meta");
    expect(location).toBe("/social?connect=done&p=meta&n=3");
    expect(s.calls[0].url).toContain("https://graph.facebook.com/v24.0/oauth/access_token");
    expect(param(s.calls[0].url, "code")).toBe("the-code");
    expect(param(s.calls[1].url, "fb_exchange_token")).toBe("short-user");
    expect(s.calls[2].url).toContain("/me/accounts");
    expect(s.calls[2].headers.Authorization).toBe("Bearer long-user");
    expect(s.saved.map((a) => [a.provider, a.externalId, a.name, a.secret])).toEqual([
      ["facebook", "111", "Harbour Dental", { accessToken: "page-1" }],
      ["instagram", "999", "@harbourdental", { accessToken: "page-1" }],
      ["facebook", "222", "Fieldway Logistics", { accessToken: "page-2" }],
    ]);
  });

  it("says so when the Facebook log-in has no Page", async () => {
    const s = setUp({ reply: (call) => call.url.includes("/me/accounts") ? { json: { data: [] } } : { json: { access_token: "t" } } });
    expect((await finish(s, "meta")).location).toBe("/social?connect=none&p=meta");
    expect(s.saved).toEqual([]);
  });

  it("proves to X that the same browser started, and keeps the X account", async () => {
    const s = setUp({ reply: (call) => call.url.includes("/oauth2/token")
      ? { json: { access_token: "x-access", refresh_token: "x-refresh", expires_in: 7200 } }
      : { json: { data: { id: "42", username: "northwind", name: "Northwind Studio" } } } });
    const { location, started } = await finish(s, "x");
    expect(location).toBe("/social?connect=done&p=x&n=1");
    const sent = formOf(s.calls[0]);
    expect(s.calls[0].url).toBe("https://api.x.com/2/oauth2/token");
    expect(s.calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("x-id:x-secret").toString("base64")}`);
    // The proof matches the challenge sent at the start.
    expect(createHash("sha256").update(sent.code_verifier).digest("base64url")).toBe(param(started.url, "code_challenge"));
    expect(s.saved[0]).toMatchObject({ provider: "x", externalId: "42", name: "@northwind", secret: { accessToken: "x-access", refreshToken: "x-refresh", expiresAt: NOW + 7200_000 } });
  });

  it("keeps a TikTok account", async () => {
    const s = setUp({ reply: (call) => call.url.includes("/oauth/token")
      ? { json: { access_token: "tt-access", refresh_token: "tt-refresh", expires_in: 86400, open_id: "open-7" } }
      : { json: { data: { user: { display_name: "Northwind" } } } } });
    expect((await finish(s, "tiktok")).location).toBe("/social?connect=done&p=tiktok&n=1");
    expect(formOf(s.calls[0])).toMatchObject({ client_key: "t-key", client_secret: "t-secret", code: "the-code", grant_type: "authorization_code", redirect_uri: CALLBACK });
    expect(s.saved[0]).toMatchObject({ provider: "tiktok", externalId: "open-7", name: "Northwind", secret: { accessToken: "tt-access", refreshToken: "tt-refresh" } });
  });

  it("keeps a LinkedIn profile as the author of its posts", async () => {
    const s = setUp({ reply: (call) => call.url.includes("accessToken")
      ? { json: { access_token: "li-access", expires_in: 5184000 } }
      : { json: { sub: "abc123", name: "Sam Carter" } } });
    expect((await finish(s, "linkedin")).location).toBe("/social?connect=done&p=linkedin&n=1");
    expect(s.saved[0]).toMatchObject({ provider: "linkedin", externalId: "urn:li:person:abc123", name: "Sam Carter", secret: { accessToken: "li-access", expiresAt: NOW + 5184000_000 } });
  });

  it("keeps nothing when the person pressed Cancel at the platform", async () => {
    const s = setUp();
    const { location } = await finish(s, "x", { query: { code: "", error: "access_denied" } });
    expect(location).toBe("/social?connect=cancelled&p=x");
    expect(s.calls).toEqual([]);
    expect(s.saved).toEqual([]);
  });

  it("refuses a return that this browser did not start", async () => {
    const s = setUp();
    // Another browser: no mark, or somebody else's.
    expect((await finish(s, "youtube", { cookie: "" })).location).toBe("/social?connect=expired");
    expect((await finish(s, "youtube", { cookie: `${STATE_COOKIE}=nonce-999` })).location).toBe("/social?connect=expired");
    expect(s.calls).toEqual([]);
    expect(s.saved).toEqual([]);
  });

  it("refuses a state that was changed, made up, or is too old", async () => {
    const s = setUp();
    const started = await begin(s.deps, "youtube");
    const state = param(started.url, "state");
    const cookie = cookieOf(started.cookie);
    const [body, mark] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), o: "org-2" })).toString("base64url");
    for (const bad of [`${forged}.${mark}`, `${body}.${"A".repeat(mark.length)}`, "nonsense", "", `${body}`]) {
      expect((await finishConnect(s.deps, { state: bad, code: "c" }, cookie)).location).toBe("/social?connect=expired");
    }
    s.setNow(NOW + STATE_MINUTES * 60_000 + 1000);
    expect((await finishConnect(s.deps, { state, code: "c" }, cookie)).location).toBe("/social?connect=expired");
    expect(s.calls).toEqual([]);
  });

  it("keeps nothing for somebody who stopped being an admin in the meantime", async () => {
    const s = setUp();
    const started = await begin(s.deps, "youtube");
    s.setAdmin(false);
    const result = await finishConnect(s.deps, { state: param(started.url, "state"), code: "c" }, cookieOf(started.cookie));
    expect(result.location).toBe("/social?connect=failed&p=youtube");
    expect(s.calls).toEqual([]);
  });

  it("never passes on what a platform answered when it said no", async () => {
    const s = setUp({ reply: () => ({ status: 400, json: { error: "invalid_grant", error_description: "Malformed auth code secret-detail" } }) });
    for (const kind of CONNECT_KINDS) {
      const { location } = await finish(s, kind);
      expect(location).toBe(`/social?connect=failed&p=${kind}`);
    }
    expect(s.saved).toEqual([]);
  });

  it("does not keep a YouTube or X key that would stop working within hours", async () => {
    const s = setUp({ reply: (call) => call.url.includes("token") ? { json: { access_token: "only-short", expires_in: 3600 } } : { json: { items: [{ id: "UC1", snippet: { title: "C" } }], data: { id: "1", username: "u" } } } });
    expect((await finish(s, "youtube")).location).toBe("/social?connect=failed&p=youtube");
    expect((await finish(s, "x")).location).toBe("/social?connect=failed&p=x");
    expect(s.saved).toEqual([]);
  });
});

describe("the three addresses", () => {
  type Sent = { status: number; body: unknown; headers: Record<string, string>; location: string | null };
  const call = async (s: ReturnType<typeof setUp>, route: string, req: { method?: string; query?: Record<string, string>; body?: unknown; cookie?: string; user?: string | null }) => {
    const sent: Sent = { status: 0, body: null, headers: {}, location: null };
    const res = {
      setHeader: (name: string, value: string) => { sent.headers[name] = value; return res; },
      status: (code: number) => { sent.status = code; return res; },
      json: (body: unknown) => { sent.body = body; return res; },
      redirect: (code: number, to: string) => { sent.status = code; sent.location = to; return res; },
    };
    const handler = connectHandler({ ...s.deps, userOf: async () => (req.user === undefined ? "user-1" : req.user) });
    await handler({ method: req.method ?? "GET", query: req.query ?? {}, body: req.body, headers: { cookie: req.cookie ?? "" } } as never, res as never, route);
    return sent;
  };

  it("tell a signed-in person which platforms can be connected", async () => {
    const s = setUp();
    const sent = await call(s, "setup", {});
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual(connectSetup(ENV));
    expect((await call(s, "setup", { user: null })).status).toBe(401);
  });

  it("start for a signed-in admin, and hand the browser its mark", async () => {
    const s = setUp();
    const body = { kind: "youtube", organizationId: "org-1", workspaceId: "ws-1" };
    const sent = await call(s, "start", { method: "POST", body });
    expect(sent.status).toBe(200);
    expect((sent.body as { url: string }).url).toContain("accounts.google.com");
    expect(sent.headers["Set-Cookie"]).toContain(STATE_COOKIE);
    expect((await call(s, "start", { method: "POST", body, user: null })).status).toBe(401);
    expect((await call(s, "start", { method: "GET" })).status).toBe(405);
    s.setAdmin(false);
    const refused = await call(s, "start", { method: "POST", body });
    expect(refused.status).toBe(403);
    expect(refused.headers["Set-Cookie"]).toBeUndefined();
  });

  it("send the browser back to the Social page after the platform, signed in or not, and take the mark away", async () => {
    const s = setUp({ reply: (c) => c.url.includes("/token") ? { json: { access_token: "a", refresh_token: "r", expires_in: 3600 } } : { json: { items: [{ id: "UC1", snippet: { title: "C" } }] } } });
    const started = await begin(s.deps, "youtube");
    const sent = await call(s, "callback", { user: null, query: { state: param(started.url, "state"), code: "c" }, cookie: cookieOf(started.cookie) });
    expect(sent.status).toBe(302);
    expect(sent.location).toBe("/social?connect=done&p=youtube&n=1");
    expect(sent.headers["Set-Cookie"]).toContain(`${STATE_COOKIE}=;`);
    expect(sent.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect(sent.headers["Cache-Control"]).toContain("no-store");
  });

  it("answer nothing else", async () => {
    expect((await call(setUp(), "elsewhere", {})).status).toBe(404);
  });
});

describe("through the posting service", () => {
  const SERVICE = { ...ENV, POST_FOR_ME_API_KEY: "pfm_key" };
  const TAG = "tc_ws-1";

  it("offers its own list of platforms, all ready, with no key of ours for any of them", () => {
    const bare = { POST_FOR_ME_API_KEY: "pfm_key", PUBLIC_SITE_URL: "https://app.example.com" };
    expect(connectSetup(bare)).toEqual({
      via: "service", kinds: ["youtube", "facebook", "instagram", "x", "tiktok", "linkedin"],
      ready: { youtube: true, facebook: true, instagram: true, x: true, tiktok: true, linkedin: true },
      needs: { youtube: [], facebook: [], instagram: [], x: [], tiktok: [], linkedin: [] },
      // Where the service's project must send people back to.
      callback: "https://app.example.com/social",
    });
    expect(connectSetup({ POST_FOR_ME_API_KEY: "pfm_key" }).callback).toBeNull();
  });

  it("sends an owner or admin to the log-in address the service gives, with no mark of ours to carry", async () => {
    const s = setUp({ env: SERVICE, reply: () => ({ json: { url: "https://www.tiktok.com/v2/auth/authorize?x=1" } }) });
    const { url, cookie } = await begin(s.deps, "tiktok");
    expect(url).toBe("https://www.tiktok.com/v2/auth/authorize?x=1");
    expect(cookie).toBe("");
    expect(s.calls[0].url).toBe("https://api.postforme.dev/v1/social-accounts/auth-url");
    expect(JSON.parse(s.calls[0].body)).toEqual({ platform: "tiktok", external_id: TAG });
    expect(s.calls[0].headers.Authorization).toBe("Bearer pfm_key");
  });

  it("refuses a member, a workspace of another organisation and a platform it does not have", async () => {
    const member = setUp({ env: SERVICE, admin: false });
    await expect(begin(member.deps, "youtube")).rejects.toMatchObject({ status: 403 });
    const elsewhere = setUp({ env: SERVICE, workspaceOrg: "org-2" });
    await expect(begin(elsewhere.deps, "youtube")).rejects.toMatchObject({ status: 403 });
    const s = setUp({ env: SERVICE });
    // "meta" is the one log-in of our own app; the service has Facebook and Instagram apart.
    await expect(begin(s.deps, "meta")).rejects.toMatchObject({ status: 400 });
    expect(member.calls.length + elsewhere.calls.length + s.calls.length).toBe(0);
  });

  it("says plainly when the service gives no address", async () => {
    const s = setUp({ env: SERVICE, reply: () => ({ status: 401, json: { message: "Invalid API key pfm_key" } }) });
    const error = await begin(s.deps, "x").catch((e) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect(error.message).toBe("The account could not be connected. Please try again.");
  });

  const sync = (deps: ConnectDeps) => syncConnect(deps, { organizationId: "org-1", workspaceId: "ws-1", userId: "user-1" });

  it("brings the workspace's accounts into our list after the log-in", async () => {
    const s = setUp({ env: SERVICE, reply: () => ({ json: { data: [
      { id: "spc_1", platform: "youtube", username: "Northwind channel", status: "connected", external_id: TAG, access_token: "secret" },
      { id: "spc_2", platform: "instagram", username: "northwind.studio", status: "connected", external_id: TAG },
      { id: "spc_9", platform: "facebook", username: "Somebody else", status: "connected", external_id: "tc_ws-2" },
    ] } }) });
    expect(await sync(s.deps)).toEqual({ connected: 2 });
    expect(s.linked).toEqual([
      { organizationId: "org-1", workspaceId: "ws-1", userId: "user-1", provider: "youtube", serviceId: "spc_1", name: "Northwind channel" },
      { organizationId: "org-1", workspaceId: "ws-1", userId: "user-1", provider: "instagram", serviceId: "spc_2", name: "northwind.studio" },
    ]);
    expect(JSON.stringify(s.linked)).not.toContain("secret");
  });

  it("passes on the accounts the log-in named, as a short list of ids only", async () => {
    const s = setUp({ env: SERVICE, reply: (call) => (call.url.includes("id=") && !call.url.includes("external_id=")
      ? { json: { data: [{ id: "spc_7", platform: "tiktok", username: "northwind", status: "connected", external_id: null }] } }
      : { json: { data: [] } }) });
    const many = Array.from({ length: 40 }, (_, i) => `spc_${i}`);
    const out = await syncConnect(s.deps, { organizationId: "org-1", workspaceId: "ws-1", userId: "user-1", accountIds: ["spc_7", 12, "<script>", ...many] });
    expect(out).toEqual({ connected: 1 });
    expect(s.linked[0]).toMatchObject({ provider: "tiktok", serviceId: "spc_7" });
    const asked = new URL(s.calls[1].url).searchParams.getAll("id");
    expect(asked[0]).toBe("spc_7");
    expect(asked.length).toBeLessThanOrEqual(20);
    expect(asked.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  });

  it("brings nothing for a member, or while the service is off", async () => {
    const member = setUp({ env: SERVICE, admin: false });
    await expect(sync(member.deps)).rejects.toMatchObject({ status: 403 });
    const off = setUp();
    expect(await sync(off.deps)).toEqual({ connected: 0 });
    expect(off.calls).toEqual([]);
  });

  it("has an address for it, for a signed-in person only", async () => {
    const s = setUp({ env: SERVICE, reply: () => ({ json: { data: [{ id: "spc_1", platform: "x", username: "northwind", status: "connected", external_id: TAG }] } }) });
    const sent: { status: number; body: unknown } = { status: 0, body: null };
    const res = { setHeader: () => res, status: (code: number) => { sent.status = code; return res; }, json: (body: unknown) => { sent.body = body; return res; } };
    const body = { organizationId: "org-1", workspaceId: "ws-1" };
    await connectHandler({ ...s.deps, userOf: async () => "user-1" })({ method: "POST", query: {}, body, headers: {} } as never, res as never, "sync");
    expect(sent).toEqual({ status: 200, body: { connected: 1 } });
    await connectHandler({ ...s.deps, userOf: async () => null })({ method: "POST", query: {}, body, headers: {} } as never, res as never, "sync");
    expect(sent.status).toBe(401);
  });
});

describe("on the server", () => {
  const v = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
    rewrites: Array<{ source: string; destination: string }>; functions: Record<string, unknown>;
  };

  it("the three addresses lead to a function that exists, ahead of the rule that serves the app", () => {
    const at = v.rewrites.findIndex((r) => r.source === "/api/social/connect/:path*");
    const app = v.rewrites.findIndex((r) => r.destination === "/index.html");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(app);
    expect(v.rewrites[at].destination).toBe("/api/social/account-secret?connect=:path*");
    expect(existsSync(resolve(process.cwd(), "api/social/account-secret.ts"))).toBe(true);
    // No new function file: the plan allows twelve.
    expect(existsSync(resolve(process.cwd(), "api/social/connect.ts"))).toBe(false);
  });
});
