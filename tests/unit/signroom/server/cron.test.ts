// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signroomHandler, type SignroomDeps } from "../../../../api/signroom";
import { route as realRoute, type RouteDeps } from "../../../../api/_signroom/router";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import { fakeReq, fakeRes } from "./fakeHttp";

/**
 * Vercel's cron calls GET /api/signroom/ops/run with "Authorization: Bearer <CRON_SECRET>"
 * and no Origin. That header, compared in constant time, is the only way in.
 */

const SECRET = "cron-secret-for-tests-0123456789";

function deps(seen: unknown[] = [], over: Partial<SignroomDeps> = {}): SignroomDeps {
  return {
    signedIn: vi.fn(async () => ({ id: "u1", email: "o@example.com" })),
    route: vi.fn(async (_deps: unknown, r: unknown) => {
      seen.push(r);
      return { status: 200, json: { processed: 3 } } as never;
    }) as never,
    cronSecret: () => SECRET,
    keepAlive: () => undefined,
    ...over,
  };
}

const cronReq = (headers: Record<string, string>, method = "GET", query: Record<string, unknown> = { path: "ops/run" }) => fakeReq({ method, headers, query, body: undefined });

describe("the Vercel cron run (ops/run)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_SITE_URL = "https://app.example.com/";
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("a GET with the right Bearer secret and no Origin runs the route as cron, signed out, with the site's own origin", async () => {
    const seen: any[] = [];
    const d = deps(seen);
    const r = fakeRes();
    await signroomHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }), r as never);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ processed: 3 });
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", path: ["ops", "run"], user: null, cron: true, origin: "https://app.example.com" });
  });

  it("a POST with the right secret works too, and the array form of ?path", async () => {
    const seen: any[] = [];
    const r = fakeRes();
    await signroomHandler(deps(seen))(cronReq({ authorization: `Bearer ${SECRET}` }, "POST", { path: ["ops", "run"] }), r as never);
    expect(r.statusCode).toBe(200);
    expect(seen[0].cron).toBe(true);
  });

  it("reads CRON_SECRET when no cronSecret is given", async () => {
    process.env.CRON_SECRET = "from-the-environment";
    const seen: any[] = [];
    const d = deps(seen);
    delete d.cronSecret;
    const ok = fakeRes();
    await signroomHandler(d)(cronReq({ authorization: "Bearer from-the-environment" }), ok as never);
    expect(ok.statusCode).toBe(200);
    const bad = fakeRes();
    await signroomHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }), bad as never);
    expect(bad.statusCode).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it("is 503 when no cron secret is configured, and the route is never called", async () => {
    for (const cronSecret of [() => undefined, () => ""]) {
      const d = deps([], { cronSecret });
      const r = fakeRes();
      await signroomHandler(d)(cronReq({ authorization: "Bearer " }), r as never);
      expect(r.statusCode).toBe(503);
      expect(d.route).not.toHaveBeenCalled();
    }
  });

  it("a missing, wrong, malformed or near-miss secret is 403 forbidden, and the route is never called", async () => {
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
      // The old pg_cron header is not a way in.
      { "x-cron-secret": SECRET },
      // A browser on our own page with a sign-in token is not the cron either.
      { origin: "https://app.example.com", authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature" },
    ];
    for (const headers of attempts) {
      const r = fakeRes();
      await signroomHandler(d)(cronReq(headers), r as never);
      expect(r.statusCode, JSON.stringify(headers)).toBe(403);
      expect(r.body).toEqual({ error: "forbidden" });
    }
    expect(d.route).not.toHaveBeenCalled();
    expect(d.signedIn).not.toHaveBeenCalled();
  });

  it("ignores x-signroom-workspace and cookies: the run stays signed out", async () => {
    const seen: any[] = [];
    await signroomHandler(deps(seen))(
      cronReq({ authorization: `Bearer ${SECRET}`, "x-signroom-workspace": "0a000000-0000-4000-8000-000000000001", cookie: "sr_sign=S; sr_billing=B" }),
      fakeRes() as never,
    );
    expect(seen[0].user).toBeNull();
    expect(seen[0].signSession).toBeUndefined();
    expect(seen[0].guestSession).toBeUndefined();
  });

  it("keeps the function alive for the whole run", async () => {
    const kept: Promise<unknown>[] = [];
    const d = deps([], { keepAlive: (p) => void kept.push(p) });
    await signroomHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }), fakeRes() as never);
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toMatchObject({ status: 200 });
  });

  it("a run that throws is a plain 500, and deps that cannot be built are 503", async () => {
    const boom = deps([], { route: vi.fn(async () => { throw new Error("secret detail"); }) as never });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = fakeRes();
    await signroomHandler(boom)(cronReq({ authorization: `Bearer ${SECRET}` }), r as never);
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret detail");

    const none = deps([], { build: () => null });
    const r2 = fakeRes();
    await signroomHandler(none)(cronReq({ authorization: `Bearer ${SECRET}` }), r2 as never);
    expect(r2.statusCode).toBe(503);
    expect(none.route).not.toHaveBeenCalled();
  });

  it("still runs when PUBLIC_SITE_URL is not set (the run builds no link from the request)", async () => {
    delete process.env.PUBLIC_SITE_URL;
    const seen: any[] = [];
    const r = fakeRes();
    await signroomHandler(deps(seen))(cronReq({ authorization: `Bearer ${SECRET}` }), r as never);
    expect(r.statusCode).toBe(200);
    expect(seen[0].origin).toBe("");
  });

  it("the router runs ops/run only for the checked cron call, never for a signed-in user or a guest", async () => {
    const store = fakeStore();
    const routeDeps = { mail: { store, sb: {}, fetch, resendKey: undefined, jobKey: null, evidenceKey: null } } as unknown as RouteDeps;
    const base = { path: ["ops", "run"], query: {}, body: {}, origin: "https://app.example.com" };
    expect((await realRoute(routeDeps, { ...base, method: "POST", user: null, cron: true })).status).toBe(200);
    expect((await realRoute(routeDeps, { ...base, method: "POST", user: null })).status).toBe(404);
    expect((await realRoute(routeDeps, { ...base, method: "POST", user: { id: "u1", email: "o@example.com", workspaceId: "w" } })).status).toBe(404);
    expect((await realRoute(routeDeps, { ...base, method: "GET", user: { id: "u1", email: "o@example.com", workspaceId: "w" } })).status).toBe(404);
  });

  it("any other method on ops/run is treated as an ordinary request: the origin check refuses it", async () => {
    const d = deps();
    const r = fakeRes();
    await signroomHandler(d)(cronReq({ authorization: `Bearer ${SECRET}` }, "PUT"), r as never);
    expect(r.statusCode).toBe(403);
    expect(d.route).not.toHaveBeenCalled();
  });
});

describe("vercel.json", () => {
  const v = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));

  it("calls the function directly at ?path=ops/run every 5 minutes, without relying on the rewrite, and keeps the existing cron", () => {
    expect(v.crons).toContainEqual({ path: "/api/signroom?path=ops/run", schedule: "*/5 * * * *" });
    expect(v.crons).toContainEqual({ path: "/api/social/publish", schedule: "*/5 * * * *" });
  });

  it("rewrites /api/signroom/* to the function before the SPA rewrite, which still skips api/", () => {
    const at = v.rewrites.findIndex((r: { source: string }) => r.source === "/api/signroom/:path*");
    const spa = v.rewrites.findIndex((r: { destination: string }) => r.destination === "/index.html");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(v.rewrites[at].destination).toBe("/api/signroom?path=:path*");
    expect(spa).toBeGreaterThan(at);
    expect(v.rewrites[spa].source).toContain("(?!api/");
  });

  it("gives the function 300 seconds", () => {
    expect(v.functions["api/signroom.ts"].maxDuration).toBe(300);
  });
});
