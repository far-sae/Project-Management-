// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, siteOrigin } from "../../../../api/_signroom/host/admin";
import { AUTH_UNAVAILABLE_MESSAGE, refuseSignedOut, SIGN_IN_MESSAGE, VERIFY_EMAIL_MESSAGE } from "../../../../api/_signroom/host/auth";
import { runInBackground } from "../../../../api/_signroom/host/background";
import { bodyBytes, refuseOversize } from "../../../../api/_signroom/host/bodySize";
import { allowedOrigin, refuseForeign } from "../../../../api/_signroom/host/origin";
import { ATTEMPTS_TABLE, limitVerdict, minutes, peek, refuseVerdict, spend, UNAVAILABLE_MESSAGE, workspaceLimitKey } from "../../../../api/_signroom/host/rateLimit";
import { fakeReq, fakeRes } from "./fakeHttp";

/** The small host helpers under api/_signroom/host: rate limits, origin, sign-in, body size. */

type Attempt = { tool: string; key: string; created_at: string };

/** Just enough of the Supabase query builder for spend(): insert, select…eq…eq…gte, delete…lt. */
function fakeSb(opts: { insertFails?: boolean; selectFails?: boolean; seed?: Attempt[] } = {}) {
  const rows: Attempt[] = [...(opts.seed ?? [])];
  const tables: string[] = [];
  const sb = {
    from: (table: string) => {
      tables.push(table);
      return {
        insert: (r: { tool: string; key: string }) => {
          if (opts.insertFails) return Promise.resolve({ error: { message: 'relation "sr_attempts" does not exist' } });
          rows.push({ ...r, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        },
        select: () => {
          const f: Record<string, string> = {};
          const q = {
            eq(c: string, v: string) {
              f[c] = v;
              return q;
            },
            gte(c: string, v: string) {
              f[`${c}>=`] = v;
              return q;
            },
            then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
              const out = opts.selectFails
                ? { data: null, error: { message: "timeout" } }
                : {
                    data: rows.filter((r) => r.tool === f.tool && r.key === f.key && r.created_at >= f["created_at>="]).map((r) => ({ created_at: r.created_at })),
                    error: null,
                  };
              return Promise.resolve(out).then(ok, bad);
            },
          };
          return q;
        },
        delete: () => ({ lt: () => Promise.resolve({ error: null }) }),
      };
    },
  };
  return { sb: sb as never, rows, tables };
}

describe("rate limits (sr_attempts)", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const at = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
  const HOUR = 3_600_000;

  it("limitVerdict allows up to the limit", () => {
    expect(limitVerdict([at(5), at(10)], now, 3, HOUR)).toEqual({ ok: true });
  });

  it("limitVerdict counts the minutes until enough attempts age out", () => {
    // Limit 3, four in the window (the newest is this request): it frees up when
    // the second oldest (40 minutes ago) leaves the hour, in 20 minutes.
    expect(limitVerdict([at(50), at(40), at(20), at(0)], now, 3, HOUR)).toEqual({ ok: false, minutesLeft: 20 });
  });

  it("limitVerdict ignores attempts outside the window", () => {
    expect(limitVerdict([at(90), at(80), at(1)], now, 2, HOUR)).toEqual({ ok: true });
  });

  it("spend writes to and reads from sr_attempts only", async () => {
    const { sb, tables } = fakeSb();
    await spend(sb, "signroom-send", "workspace:w", 3, 60);
    expect(ATTEMPTS_TABLE).toBe("sr_attempts");
    expect(new Set(tables)).toEqual(new Set(["sr_attempts"]));
  });

  it("spend lets `limit` attempts through, then refuses with the minutes left", async () => {
    const { sb } = fakeSb();
    for (let i = 0; i < 3; i++) expect(await spend(sb, "signroom-send", "k1", 3, 60)).toEqual({ ok: true });
    const r = await spend(sb, "signroom-send", "k1", 3, 60);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.minutesLeft).toBe(60);
  });

  it("spend keeps tools and keys in separate buckets", async () => {
    const { sb } = fakeSb();
    expect(await spend(sb, "a", "k1", 1, 60)).toEqual({ ok: true });
    expect(await spend(sb, "b", "k1", 1, 60)).toEqual({ ok: true });
    expect(await spend(sb, "a", "k2", 1, 60)).toEqual({ ok: true });
    expect((await spend(sb, "a", "k1", 1, 60)).ok).toBe(false);
  });

  it("spend does not count attempts from before the window", async () => {
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const { sb } = fakeSb({ seed: [{ tool: "a", key: "k1", created_at: old }, { tool: "a", key: "k1", created_at: old }] });
    expect(await spend(sb, "a", "k1", 1, 60)).toEqual({ ok: true });
  });

  it("spend fails closed when the insert fails (the table isn't there yet) or the count fails", async () => {
    expect(await spend(fakeSb({ insertFails: true }).sb, "a", "k1", 60, 60)).toEqual({ ok: false, minutesLeft: 1, unavailable: true });
    expect(await spend(fakeSb({ selectFails: true }).sb, "a", "k1", 60, 60)).toEqual({ ok: false, minutesLeft: 1, unavailable: true });
    const throws = { from: () => { throw new Error("boom"); } } as never;
    expect(await spend(throws, "a", "k1", 60, 60)).toEqual({ ok: false, minutesLeft: 1, unavailable: true });
  });

  it("peek counts the window without adding an attempt, and refuses once the window already holds `limit`", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const { sb, rows } = fakeSb({ seed: [{ tool: "signroom-mail", key: "workspace:w1", created_at: recent }] });
    expect(await peek(sb, "signroom-mail", "workspace:w1", 2, 60)).toEqual({ ok: true });
    expect(rows).toHaveLength(1);
    expect(await peek(sb, "signroom-mail", "workspace:w1", 1, 60)).toEqual({ ok: false, minutesLeft: 60 });
    expect(await peek(sb, "signroom-mail", "workspace:w2", 1, 60)).toEqual({ ok: true });
  });

  it("peek fails closed when the count fails", async () => {
    expect(await peek(fakeSb({ selectFails: true }).sb, "a", "k", 100, 1440)).toEqual({ ok: false, minutesLeft: 1, unavailable: true });
  });

  it("refuseVerdict: nothing for ok, 503 when the store failed, else 429 with at least one minute", () => {
    expect(() => refuseVerdict({ ok: true }, () => "x")).not.toThrow();
    expect(() => refuseVerdict({ ok: false, minutesLeft: 1, unavailable: true }, () => "x")).toThrow(expect.objectContaining({ status: 503, message: UNAVAILABLE_MESSAGE }));
    expect(() => refuseVerdict({ ok: false, minutesLeft: 0 }, (m) => `Try again in ${minutes(m)}.`)).toThrow(
      expect.objectContaining({ status: 429, message: "Try again in 1 minute." }),
    );
    expect(minutes(2)).toBe("2 minutes");
    expect(workspaceLimitKey("abc")).toBe("workspace:abc");
  });
});

describe("the origin allow-list", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_SITE_URL = "https://app.example.com/";
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_BRANCH_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const from = (headers: Record<string, string>) => allowedOrigin(fakeReq({ headers }));

  it("allows the PUBLIC_SITE_URL host, its www twin and localhost", () => {
    expect(from({ origin: "https://app.example.com" })).toBe(true);
    expect(from({ origin: "https://www.app.example.com" })).toBe(true);
    expect(from({ origin: "http://localhost:5173" })).toBe(true);
    process.env.PUBLIC_SITE_URL = "https://www.example.org";
    expect(from({ origin: "https://example.org" })).toBe(true);
    expect(from({ origin: "https://www.example.org" })).toBe(true);
    expect(from({ origin: "https://app.example.com" })).toBe(false);
  });

  it("refuses other sites and look-alikes", () => {
    for (const origin of [
      "https://evil.example",
      "https://app.example.com.evil.example",
      "https://evilapp.example.com",
      "https://example.com",
      "https://sub.app.example.com",
      "http://localhost.evil.example",
      "null",
      "not a url",
    ])
      expect(from({ origin }), origin).toBe(false);
    expect(from({})).toBe(false);
  });

  it("uses Referer only when Origin is absent", () => {
    expect(from({ referer: "https://app.example.com/sign" })).toBe(true);
    expect(from({ referer: "https://evil.example/app.example.com" })).toBe(false);
    expect(from({ origin: "https://evil.example", referer: "https://app.example.com/" })).toBe(false);
  });

  it("allows this deployment's own Vercel hosts and no other vercel.app host", () => {
    expect(from({ origin: "https://taskcalendar-abc123.vercel.app" })).toBe(false);
    process.env.VERCEL_URL = "taskcalendar-abc123.vercel.app";
    process.env.VERCEL_BRANCH_URL = "https://taskcalendar-git-redesign.vercel.app/";
    expect(from({ origin: "https://taskcalendar-abc123.vercel.app" })).toBe(true);
    expect(from({ origin: "https://taskcalendar-git-redesign.vercel.app" })).toBe(true);
    expect(from({ origin: "https://someone-taskcalendar.vercel.app" })).toBe(false);
  });

  it("with no PUBLIC_SITE_URL only localhost and the Vercel hosts pass", () => {
    delete process.env.PUBLIC_SITE_URL;
    expect(siteOrigin()).toBeNull();
    expect(from({ origin: "https://app.example.com" })).toBe(false);
    expect(from({ origin: "http://localhost:3000" })).toBe(true);
  });

  it("refuseForeign answers 403 forbidden, and nothing for our own pages", () => {
    const r = fakeRes();
    expect(refuseForeign(fakeReq({ headers: { origin: "https://evil.example" } }), r as never)).toBe(true);
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: "forbidden" });
    const ok = fakeRes();
    expect(refuseForeign(fakeReq({ headers: { origin: "https://app.example.com" } }), ok as never)).toBe(false);
    expect(ok.body).toBeUndefined();
  });

  it("siteOrigin drops the path and the trailing slash", () => {
    process.env.PUBLIC_SITE_URL = "https://app.example.com/some/path/";
    expect(siteOrigin()).toBe("https://app.example.com");
    process.env.PUBLIC_SITE_URL = "not a url";
    expect(siteOrigin()).toBeNull();
  });
});

describe("the signed-in check", () => {
  type Reply = { data: { user: unknown }; error: { status?: number } | null };
  const deps = (reply: Reply | "throw" | null) => {
    const getUser = vi.fn(async () => {
      if (reply === "throw") throw new Error("network");
      return reply as Reply;
    });
    return { getUser, deps: { adminClient: () => (reply === null ? null : ({ auth: { getUser } } as never)) } };
  };
  const req = (authorization?: string) => fakeReq({ headers: { origin: "https://app.example.com", ...(authorization === undefined ? {} : { authorization }) } });
  const user = { id: "u1", email: "o@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };

  it("no token, or a malformed header, is 401 without asking Auth", async () => {
    for (const h of [undefined, "", "Bearer", "Basic abc", "abc"]) {
      const d = deps({ data: { user }, error: null });
      const r = fakeRes();
      expect(await refuseSignedOut(req(h), r as never, d.deps)).toBeNull();
      expect(r.statusCode).toBe(401);
      expect(r.body).toEqual({ error: SIGN_IN_MESSAGE });
      expect(d.getUser).not.toHaveBeenCalled();
    }
  });

  it("a valid token for a confirmed account gives its id and email, checked by Auth with that token", async () => {
    const d = deps({ data: { user }, error: null });
    const r = fakeRes();
    expect(await refuseSignedOut(req("Bearer tok-123"), r as never, d.deps)).toEqual({ userId: "u1", email: "o@example.com" });
    expect(d.getUser).toHaveBeenCalledWith("tok-123");
    expect(r.body).toBeUndefined();
  });

  it("an unconfirmed email is 403", async () => {
    const d = deps({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
    const r = fakeRes();
    expect(await refuseSignedOut(req("Bearer t"), r as never, d.deps)).toBeNull();
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: VERIFY_EMAIL_MESSAGE });
  });

  it("a token Auth refuses (4xx) is 401; no user is 401", async () => {
    for (const reply of [{ data: { user: null }, error: { status: 401 } }, { data: { user: null }, error: { status: 403 } }, { data: { user: null }, error: null }]) {
      const r = fakeRes();
      expect(await refuseSignedOut(req("Bearer t"), r as never, deps(reply).deps)).toBeNull();
      expect(r.statusCode).toBe(401);
    }
  });

  it("Auth failing (5xx, 429, no status, a throw, or no Supabase at all) is 503, never 401", async () => {
    for (const reply of [{ data: { user: null }, error: { status: 500 } }, { data: { user: null }, error: { status: 429 } }, { data: { user: null }, error: {} }, "throw" as const, null]) {
      const r = fakeRes();
      expect(await refuseSignedOut(req("Bearer t"), r as never, deps(reply).deps)).toBeNull();
      expect(r.statusCode).toBe(503);
      expect(r.body).toEqual({ error: AUTH_UNAVAILABLE_MESSAGE });
    }
  });
});

describe("the body-size guard", () => {
  const req = (headers: Record<string, string>, body: unknown) => fakeReq({ headers, body });

  it("uses Content-Length when the client sent a genuine one", () => {
    expect(bodyBytes(req({ "content-length": "12345" }, {}))).toBe(12345);
  });

  it("never trusts a forged Content-Length: it measures the body itself", () => {
    const big = { text: "x".repeat(2000) };
    for (const forged of ["-1", "abc", "NaN", "Infinity"]) expect(bodyBytes(req({ "content-length": forged }, big))).toBeGreaterThan(2000);
    expect(bodyBytes(req({}, big))).toBeGreaterThan(2000);
    expect(bodyBytes(req({}, "héllo"))).toBe(6);
    expect(bodyBytes(req({}, Buffer.alloc(4096)))).toBe(4096);
    expect(bodyBytes(req({}, undefined))).toBe(2);
  });

  it("answers 413 with the given sentence over the cap, and nothing at or under it", () => {
    const over = fakeRes();
    expect(refuseOversize(req({ "content-length": "1001" }, {}), over as never, 1000, "Too large.")).toBe(true);
    expect(over.statusCode).toBe(413);
    expect(over.body).toEqual({ error: "Too large." });
    const at = fakeRes();
    expect(refuseOversize(req({ "content-length": "1000" }, {}), at as never, 1000, "Too large.")).toBe(false);
    expect(at.body).toBeUndefined();
    const unsaid = fakeRes();
    expect(refuseOversize(req({}, { text: "x".repeat(2000) }), unsaid as never, 1000, "Too large.")).toBe(true);
  });
});

describe("the service client and background work", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("adminClient is null without SUPABASE_URL and the service-role key", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(adminClient()).toBeNull();
  });

  it("runInBackground runs the task and swallows a rejection or a throw", async () => {
    let ran = false;
    runInBackground(async () => {
      ran = true;
      throw new Error("ignored");
    });
    runInBackground(() => {
      throw new Error("ignored too");
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toBe(true);
  });

  it("runInBackground hands the work to Vercel's waitUntil when the runtime provides it", async () => {
    const kept: Promise<unknown>[] = [];
    const key = Symbol.for("@vercel/request-context");
    const g = globalThis as unknown as Record<symbol, unknown>;
    const before = g[key];
    g[key] = { get: () => ({ waitUntil: (p: Promise<unknown>) => void kept.push(p) }) };
    try {
      runInBackground(async () => "done");
      expect(kept).toHaveLength(1);
      await expect(kept[0]).resolves.toBe("done");
    } finally {
      g[key] = before;
    }
  });
});
