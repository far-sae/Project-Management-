// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automationHandler, config, MAX_BODY_BYTES, setupProblem, splitPath, WORKSPACE_HEADER_MAX, type AutomationDeps } from "../../../../api/automation";
import { route as realRoute } from "../../../../api/_automation/router";
import { world } from "./helpers";

/**
 * api/automation.ts: the way in. Our own pages only, a small body, the
 * signed-in account with its workspace header, then the router; and the cron
 * call, which is let in by its secret alone.
 */

const SITE = "https://app.example.com";
const SECRET = "cron-secret-for-tests-0123456789";

type Res = { statusCode: number; body: unknown; headers: Record<string, string>; status(c: number): Res; json(b: unknown): Res; setHeader(k: string, v: string): Res };
const res = (): Res => {
  const r: Res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) {
      r.statusCode = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
    setHeader(k, v) {
      r.headers[k.toLowerCase()] = v;
      return r;
    },
  };
  return r;
};
const req = (over: Record<string, unknown> = {}) => ({ method: "GET", headers: { origin: SITE }, query: {}, body: {}, ...over }) as never;

function deps(seen: any[] = [], over: Partial<AutomationDeps> = {}): AutomationDeps {
  return {
    signedIn: vi.fn(async () => ({ id: "u1", email: "o@example.com" })),
    route: vi.fn(async (_deps: unknown, r: unknown) => {
      seen.push(r);
      return { status: 200, json: { ok: true } };
    }) as never,
    cronSecret: () => SECRET,
    keepAlive: () => undefined,
    ...over,
  };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.PUBLIC_SITE_URL = SITE;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("api/automation entry", () => {
  it("a foreign origin is 403 before anything else", async () => {
    const d = deps();
    const r = res();
    await automationHandler(d)(req({ headers: { origin: "https://evil.example" }, query: { path: "overview" } }), r as never);
    expect(r.statusCode).toBe(403);
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(d.route).not.toHaveBeenCalled();
  });

  it("splits ?path= into segments, keeps the other query values and passes the body", async () => {
    expect(splitPath("runs/abc/stop")).toEqual(["runs", "abc", "stop"]);
    expect(splitPath(["runs", "abc"])).toEqual(["runs", "abc"]);
    expect(splitPath(undefined)).toEqual([]);
    const seen: any[] = [];
    const r = res();
    await automationHandler(deps(seen))(req({ method: "POST", query: { path: "runs/abc/replied", limit: "5" }, body: '{"positive":true}' }), r as never);
    expect(seen[0]).toMatchObject({ method: "POST", path: ["runs", "abc", "replied"], query: { limit: "5" }, body: { positive: true }, user: { id: "u1", email: "o@example.com" } });
    expect(seen[0].cron).toBeUndefined();
    expect(r.body).toEqual({ ok: true });
    expect(r.headers["cache-control"]).toBe("private, no-store");
  });

  it("a body that is not a JSON object reaches the router as an empty one", async () => {
    for (const body of ["not json", "[1,2]", 5, null]) {
      const seen: any[] = [];
      await automationHandler(deps(seen))(req({ method: "POST", query: { path: "setup" }, body }), res() as never);
      expect(seen[0].body).toEqual({});
    }
  });

  it("a signed-out request stops at the sign-in answer", async () => {
    const d = deps();
    d.signedIn = async (_q, rs) => {
      rs.status(401).json({ error: "Please sign in to use this tool." });
      return null;
    };
    const r = res();
    await automationHandler(d)(req({ query: { path: "overview" } }), r as never);
    expect(r.statusCode).toBe(401);
    expect(d.route).not.toHaveBeenCalled();
  });

  it("carries X-Workspace-Id as user.workspaceId: the first value, and only when it is 1 to 64 characters", async () => {
    const W = "11111111-2222-4333-8444-555555555555";
    const user = async (headers: Record<string, unknown>) => {
      const seen: any[] = [];
      await automationHandler(deps(seen))(req({ query: { path: "overview" }, headers: { origin: SITE, ...headers } }), res() as never);
      return seen[0].user;
    };
    expect(await user({ "x-workspace-id": W })).toEqual({ id: "u1", email: "o@example.com", workspaceId: W });
    expect((await user({ "x-workspace-id": [W, "other"] })).workspaceId).toBe(W);
    for (const headers of [{}, { "x-workspace-id": "" }, { "x-workspace-id": "a".repeat(65) }, { "x-signroom-workspace": W }]) expect(await user(headers)).toEqual({ id: "u1", email: "o@example.com" });
    expect(WORKSPACE_HEADER_MAX).toBe(64);
  });

  it("a body over 500 KB is refused before sign-in", async () => {
    const d = deps();
    const r = res();
    await automationHandler(d)(req({ method: "POST", query: { path: "assistant" }, headers: { origin: SITE, "content-length": String(MAX_BODY_BYTES + 1) } }), r as never);
    expect(r.statusCode).toBe(413);
    expect(r.body).toEqual({ error: "That request is too large." });
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(MAX_BODY_BYTES).toBe(500_000);
  });

  it("says what is missing when the database is not configured, naming the setting and never its value", async () => {
    const r = res();
    await automationHandler(deps([], { setup: () => "Automation is not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel's environment variables." }))(req({ query: { path: "overview" } }), r as never);
    expect(r.statusCode).toBe(503);
    expect(r.body).toEqual({ error: "Automation is not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel's environment variables." });

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(setupProblem()).toMatch(/SUPABASE_SERVICE_ROLE_KEY is missing/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-value";
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    expect(setupProblem()).toMatch(/SUPABASE_URL is missing/);
    expect(setupProblem()).not.toContain("service-role-secret-value");
    process.env.SUPABASE_URL = "https://db.example.co";
    expect(setupProblem()).toBeNull();
  });

  it("503 when the deps cannot be built, and a plain 500 with no detail when the route throws", async () => {
    const none = deps([], { build: () => null });
    const a = res();
    await automationHandler(none)(req({ query: { path: "overview" } }), a as never);
    expect(a.statusCode).toBe(503);
    expect(none.route).not.toHaveBeenCalled();

    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = deps([], { route: vi.fn(async () => { throw new Error("secret detail"); }) as never });
    const b = res();
    await automationHandler(boom)(req({ query: { path: "overview" } }), b as never);
    expect(b.statusCode).toBe(500);
    expect(JSON.stringify(b.body)).not.toContain("secret detail");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret detail");
  });

  it("the config gives the function 300 seconds", () => {
    expect(config).toEqual({ maxDuration: 300 });
  });
});

describe("the Vercel cron run (ops/run)", () => {
  const cronReq = (headers: Record<string, string>, method = "GET", query: Record<string, unknown> = { path: "ops/run" }) => req({ method, headers, query, body: undefined });

  it("a GET with the right Bearer secret and no Origin runs the route as cron, signed out", async () => {
    const seen: any[] = [];
    const d = deps(seen);
    const r = res();
    await automationHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }), r as never);
    expect(r.statusCode).toBe(200);
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", path: ["ops", "run"], user: null, cron: true });
  });

  it("a POST works too, and so does the array form of ?path", async () => {
    const seen: any[] = [];
    await automationHandler(deps(seen))(cronReq({ authorization: `Bearer ${SECRET}` }, "POST", { path: ["ops", "run"] }), res() as never);
    expect(seen[0].cron).toBe(true);
  });

  it("reads CRON_SECRET when no cronSecret is given", async () => {
    process.env.CRON_SECRET = "from-the-environment";
    const seen: any[] = [];
    const d = deps(seen);
    delete d.cronSecret;
    const good = res();
    await automationHandler(d)(cronReq({ authorization: "Bearer from-the-environment" }), good as never);
    expect(good.statusCode).toBe(200);
    const bad = res();
    await automationHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }), bad as never);
    expect(bad.statusCode).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it("is 503 when no cron secret is configured", async () => {
    for (const cronSecret of [() => undefined, () => ""]) {
      const d = deps([], { cronSecret });
      const r = res();
      await automationHandler(d)(cronReq({ authorization: "Bearer " }), r as never);
      expect(r.statusCode).toBe(503);
      expect(d.route).not.toHaveBeenCalled();
    }
  });

  it("a missing, wrong, malformed or near-miss secret is 403, and the route is never called", async () => {
    const d = deps();
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer wrong" },
      { authorization: `Bearer ${SECRET}x` },
      { authorization: `Bearer ${SECRET.slice(0, -1)}` },
      { authorization: `Basic ${SECRET}` },
      { authorization: SECRET },
      { authorization: `Bearer ${SECRET} extra` },
      { "x-cron-secret": SECRET },
      // A browser on our own page with a sign-in token is not the cron either.
      { origin: SITE, authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature" },
    ];
    for (const headers of attempts) {
      const r = res();
      await automationHandler(d)(cronReq(headers), r as never);
      expect(r.statusCode, JSON.stringify(headers)).toBe(403);
      expect(r.body).toEqual({ error: "forbidden" });
    }
    expect(d.route).not.toHaveBeenCalled();
    expect(d.signedIn).not.toHaveBeenCalled();
  });

  it("keeps the function alive for the whole run, and ignores the workspace header", async () => {
    const kept: Promise<unknown>[] = [];
    const seen: any[] = [];
    await automationHandler(deps(seen, { keepAlive: (p) => void kept.push(p) }))(cronReq({ authorization: `Bearer ${SECRET}`, "x-workspace-id": "0a000000-0000-4000-8000-000000000001" }), res() as never);
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toMatchObject({ status: 200 });
    expect(seen[0].user).toBeNull();
  });

  it("a run that throws is a plain 500, and deps that cannot be built are 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = res();
    await automationHandler(deps([], { route: vi.fn(async () => { throw new Error("secret detail"); }) as never }))(cronReq({ authorization: `Bearer ${SECRET}` }), r as never);
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret detail");
    const none = deps([], { build: () => null });
    const r2 = res();
    await automationHandler(none)(cronReq({ authorization: `Bearer ${SECRET}` }), r2 as never);
    expect(r2.statusCode).toBe(503);
    expect(none.route).not.toHaveBeenCalled();
  });

  it("the router runs ops/run only for the checked cron call, never for a signed-in person", async () => {
    const w = world();
    const base = { path: ["ops", "run"], query: {}, body: {} };
    expect((await realRoute(w.deps, { ...base, method: "POST", user: null, cron: true })).status).toBe(200);
    expect((await realRoute(w.deps, { ...base, method: "POST", user: null })).status).toBe(404);
    expect((await realRoute(w.deps, { ...base, method: "POST", user: { id: "u1", email: "o@example.com", workspaceId: "w" } })).status).toBe(404);
    expect((await realRoute(w.deps, { ...base, method: "GET", user: { id: "u1", email: "o@example.com", workspaceId: "w" } })).status).toBe(404);
  });

  it("any other method on ops/run is an ordinary request: the origin check refuses it", async () => {
    const d = deps();
    const r = res();
    await automationHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }, "PUT"), r as never);
    expect(r.statusCode).toBe(403);
    expect(d.route).not.toHaveBeenCalled();
  });
});

describe("vercel.json", () => {
  const v = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));

  it("calls the function at ?path=ops/run every 5 minutes and keeps the crons that were there", () => {
    expect(v.crons).toContainEqual({ path: "/api/automation?path=ops/run", schedule: "*/5 * * * *" });
    expect(v.crons).toContainEqual({ path: "/api/signroom?path=ops/run", schedule: "*/5 * * * *" });
    expect(v.crons).toContainEqual({ path: "/api/social/publish", schedule: "*/5 * * * *" });
    // The social media autopilot has a timer of its own (tests/unit/social/autopilot.test.ts).
    expect(v.crons).toContainEqual({ path: "/api/social/publish?autopilot=tick", schedule: "*/5 * * * *" });
    expect(v.crons).toHaveLength(4);
  });

  it("rewrites /api/automation/* to the function before the SPA rewrite, and leaves the documents rewrite alone", () => {
    const at = v.rewrites.findIndex((r: { source: string }) => r.source === "/api/automation/:path*");
    const spa = v.rewrites.findIndex((r: { destination: string }) => r.destination === "/index.html");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(v.rewrites[at].destination).toBe("/api/automation?path=:path*");
    expect(spa).toBeGreaterThan(at);
    expect(v.rewrites).toContainEqual({ source: "/api/signroom/:path*", destination: "/api/signroom?path=:path*" });
    // The calling server's rewrite sits beside them (tests/unit/voice/server.test.ts),
    // the one for connecting social accounts (tests/unit/social/connect.test.ts),
    // and the one for the social media autopilot.
    expect(v.rewrites).toContainEqual({ source: "/api/social/autopilot/:path*", destination: "/api/social/publish?autopilot=:path*" });
    expect(v.rewrites.findIndex((r: { source: string }) => r.source === "/api/social/autopilot/:path*")).toBeLessThan(spa);
    // Six more belong to Claude's connector (tests/unit/mcp/routes.test.ts).
    expect(v.rewrites).toHaveLength(12);
  });

  it("gives the function 300 seconds and leaves the documents function as it was", () => {
    expect(v.functions["api/automation.ts"]).toEqual({ maxDuration: 300 });
    expect(v.functions["api/signroom.ts"]).toEqual({ maxDuration: 300, includeFiles: "api/_signroom/fonts/**" });
  });
});
