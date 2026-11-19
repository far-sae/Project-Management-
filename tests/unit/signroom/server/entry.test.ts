// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as guard from "../../../../api/_signroom/host/auth";
import { config, MAX_BODY_BYTES, realSignedIn, signroomHandler, splitPath, WORKSPACE_HEADER_MAX, type SignroomDeps } from "../../../../api/signroom";

vi.mock("../../../../api/_signroom/host/auth", async (orig) => ({ ...(await orig<typeof import("../../../../api/_signroom/host/auth")>()), refuseSignedOut: vi.fn() }));

/** The entry reads the site's own address from PUBLIC_SITE_URL: the tests run as https://app.example.com. */
const savedSite = process.env.PUBLIC_SITE_URL;
beforeAll(() => {
  process.env.PUBLIC_SITE_URL = "https://app.example.com";
});
afterAll(() => {
  if (savedSite === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = savedSite;
});

type Res = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sent: Uint8Array | undefined;
  status(c: number): Res;
  json(b: unknown): Res;
  setHeader(k: string, v: string): Res;
  send(b: unknown): Res;
};
const res = (): Res => {
  const r: Res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: undefined,
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
    send(b) {
      r.sent = b as Uint8Array;
      return r;
    },
  };
  return r;
};
const req = (over: Record<string, unknown> = {}) =>
  ({ method: "GET", headers: { origin: "https://app.example.com" }, query: {}, body: {}, ...over }) as never;

function deps(routeResult: unknown, seen: unknown[] = []): SignroomDeps {
  return {
    signedIn: vi.fn(async () => ({ id: "u1", email: "o@example.com" })),
    route: vi.fn(async (_deps: unknown, r: unknown) => {
      seen.push(r);
      return routeResult as never;
    }) as never,
  };
}

describe("api/signroom entry", () => {
  it("a foreign origin is 403 before anything else", async () => {
    const d = deps({ status: 200, json: {} });
    const r = res();
    await signroomHandler(d)(req({ headers: { origin: "https://evil.example" } }), r as never);
    expect(r.statusCode).toBe(403);
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(d.route).not.toHaveBeenCalled();
  });

  it("splits ?path=billing/abc/artifact into segments", async () => {
    expect(splitPath("billing/abc/artifact")).toEqual(["billing", "abc", "artifact"]);
    expect(splitPath(["billing", "abc"])).toEqual(["billing", "abc"]);
    expect(splitPath(undefined)).toEqual([]);
    const seen: any[] = [];
    const r = res();
    await signroomHandler(deps({ status: 200, json: { ok: true } }, seen))(
      req({ query: { path: "billing/abc/artifact", payment: "p1" } }),
      r as never,
    );
    expect(seen[0].path).toEqual(["billing", "abc", "artifact"]);
    expect(seen[0].query).toEqual({ payment: "p1" });
    expect(seen[0].user).toEqual({ id: "u1", email: "o@example.com" });
    expect(r.body).toEqual({ ok: true });
  });

  it("a signed-out request to a user path stops at the sign-in answer", async () => {
    const d = deps({ status: 200, json: {} });
    d.signedIn = async (_q, rs) => {
      rs.status(401).json({ error: "Please sign in to use this tool." });
      return null;
    };
    const r = res();
    await signroomHandler(d)(req({ query: { path: "clients" } }), r as never);
    expect(r.statusCode).toBe(401);
    expect(d.route).not.toHaveBeenCalled();
  });

  it("a signed-out upload with a body that is not a Buffer is 401, not 400", async () => {
    const d = deps({ status: 200, json: {} });
    d.signedIn = async (_q, rs) => {
      rs.status(401).json({ error: "Please sign in to use this tool." });
      return null;
    };
    const r = res();
    await signroomHandler(d)(req({ method: "POST", query: { path: "workspaces/branding-template" }, body: { a: 1 } }), r as never);
    expect(r.statusCode).toBe(401);
    expect(d.route).not.toHaveBeenCalled();
  });

  it("guest paths skip sign-in and pass the sr_billing cookie", async () => {
    const seen: any[] = [];
    const d = deps({ status: 200, json: {} }, seen);
    await signroomHandler(d)(
      req({ query: { path: "billing-guest/artifact" }, headers: { origin: "https://app.example.com", cookie: "a=1; sr_billing=SESS; b=2" } }),
      res() as never,
    );
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(seen[0].guestSession).toBe("SESS");
    expect(seen[0].user).toBeNull();
  });

  it("a guest verify sets the cookie with all five attributes", async () => {
    const r = res();
    await signroomHandler(deps({ status: 200, json: { ok: true }, setGuestSession: { raw: "RAW", expires: 1 } }))(
      req({ method: "POST", query: { path: "billing-guest/verify" }, body: { access: "a", code: "1" } }),
      r as never,
    );
    expect(r.headers["set-cookie"]).toBe("sr_billing=RAW; HttpOnly; Secure; SameSite=Strict; Path=/api/signroom; Max-Age=1800");
  });

  it("agreement guest paths skip sign-in and pass the sr_sign cookie as signSession", async () => {
    const seen: any[] = [];
    const d = deps({ status: 200, json: {} }, seen);
    await signroomHandler(d)(
      req({ query: { path: "guest/artifact-url", kind: "final" }, headers: { origin: "https://app.example.com", cookie: "sr_billing=BILL; sr_sign=SIGN" } }),
      res() as never,
    );
    expect(d.signedIn).not.toHaveBeenCalled();
    expect(seen[0].user).toBeNull();
    expect(seen[0].signSession).toBe("SIGN");
    expect(seen[0].guestSession).toBeUndefined();
  });

  it("billing-guest still uses sr_billing only", async () => {
    const seen: any[] = [];
    await signroomHandler(deps({ status: 200, json: {} }, seen))(
      req({ query: { path: "billing-guest/artifact" }, headers: { origin: "https://app.example.com", cookie: "sr_billing=BILL; sr_sign=SIGN" } }),
      res() as never,
    );
    expect(seen[0].guestSession).toBe("BILL");
    expect(seen[0].signSession).toBeUndefined();
  });

  it("an agreement guest verify sets sr_sign with all five attributes", async () => {
    const r = res();
    await signroomHandler(deps({ status: 200, json: { ok: true }, setSignSession: { raw: "RAW", expires: 1 } }))(
      req({ method: "POST", query: { path: "guest/verify" }, body: { access: "a", code: "1" } }),
      r as never,
    );
    expect(r.headers["set-cookie"]).toBe("sr_sign=RAW; HttpOnly; Secure; SameSite=Strict; Path=/api/signroom; Max-Age=1800");
    expect(r.body).toEqual({ ok: true });
  });

  it("a PDF result is application/pdf, no-store, inline or attachment", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const a = res();
    await signroomHandler(deps({ status: 200, pdf: { bytes, filename: "INV-1.pdf", inline: true } }))(
      req({ query: { path: "billing/x/preview" } }),
      a as never,
    );
    expect(a.headers["content-type"]).toBe("application/pdf");
    expect(a.headers["cache-control"]).toBe("private, no-store");
    expect(a.headers["content-disposition"]).toBe('inline; filename="INV-1.pdf"');
    expect(Buffer.from(a.sent as Uint8Array)).toEqual(Buffer.from(bytes));
    const b = res();
    await signroomHandler(deps({ status: 200, pdf: { bytes, filename: "INV-1.pdf", inline: false } }))(
      req({ query: { path: "billing/x/artifact" } }),
      b as never,
    );
    expect(b.headers["content-disposition"]).toBe('attachment; filename="INV-1.pdf"');
  });

  it("a body over 1 MB is refused", async () => {
    const d = deps({ status: 200, json: {} });
    const r = res();
    await signroomHandler(d)(
      req({ method: "POST", query: { path: "clients" }, headers: { origin: "https://app.example.com", "content-length": "1100000" } }),
      r as never,
    );
    expect(r.statusCode).toBe(413);
    expect(d.route).not.toHaveBeenCalled();
  });

  it("a 3 MB octet-stream POST to workspaces/branding-template reaches the router as raw bytes", async () => {
    const seen: any[] = [];
    const body = Buffer.alloc(3 * 1024 * 1024, 1);
    const r = res();
    await signroomHandler(deps({ status: 200, json: { ok: true } }, seen))(
      req({
        method: "POST",
        query: { path: "workspaces/branding-template" },
        body,
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/octet-stream",
          "content-length": String(body.length),
          "x-file-name": encodeURIComponent("my letterhead.pdf"),
        },
      }),
      r as never,
    );
    expect(r.statusCode).toBe(200);
    expect(seen[0].raw.bytes.length).toBe(3 * 1024 * 1024);
    expect(seen[0].raw.name).toBe("my letterhead.pdf");
  });

  it("a missing or bad X-File-Name becomes letterhead.pdf", async () => {
    for (const name of [undefined, "%E0%A4%A"]) {
      const seen: any[] = [];
      await signroomHandler(deps({ status: 200, json: {} }, seen))(
        req({
          method: "POST",
          query: { path: "workspaces/branding-template" },
          body: Buffer.alloc(10),
          headers: { origin: "https://app.example.com", ...(name ? { "x-file-name": name } : {}) },
        }),
        res() as never,
      );
      expect(seen[0].raw.name).toBe("letterhead.pdf");
    }
  });

  it("over 4 MB on that path is 413, and a body that is not a Buffer is 400, both with the size sentence", async () => {
    const d = deps({ status: 200, json: {} });
    const big = res();
    await signroomHandler(d)(
      req({ method: "POST", query: { path: "workspaces/branding-template" }, body: Buffer.alloc(1), headers: { origin: "https://app.example.com", "content-length": String(4 * 1024 * 1024 + 1) } }),
      big as never,
    );
    expect(big.statusCode).toBe(413);
    expect(big.body).toEqual({ error: "Choose a single-page PDF up to 4 MB." });
    const json = res();
    await signroomHandler(d)(
      req({ method: "POST", query: { path: "workspaces/branding-template" }, body: { a: 1 } }),
      json as never,
    );
    expect(json.statusCode).toBe(400);
    expect(json.body).toEqual({ error: "Choose a single-page PDF up to 4 MB." });
    expect(d.route).not.toHaveBeenCalled();
  });

  it("a GET to workspaces/branding-template keeps the 1 MB limit", async () => {
    const d = deps({ status: 200, json: {} });
    const r = res();
    await signroomHandler(d)(
      req({ method: "GET", query: { path: "workspaces/branding-template", hash: "h" }, headers: { origin: "https://app.example.com", "content-length": String(3 * 1024 * 1024) } }),
      r as never,
    );
    expect(r.statusCode).toBe(413);
    expect(r.body).toEqual({ error: "That request is too large." });
    expect(d.route).not.toHaveBeenCalled();
  });

  it("a 3 MB JSON POST elsewhere is still refused by the 1 MB limit", async () => {
    const d = deps({ status: 200, json: {} });
    const r = res();
    await signroomHandler(d)(
      req({ method: "POST", query: { path: "workspaces/branding" }, headers: { origin: "https://app.example.com", "content-length": String(3 * 1024 * 1024) } }),
      r as never,
    );
    expect(r.statusCode).toBe(413);
    expect(r.body).toEqual({ error: "That request is too large." });
    expect(d.route).not.toHaveBeenCalled();
  });
});

describe("api/signroom: the workspace header", () => {
  const W = "11111111-2222-4333-8444-555555555555";
  const signedInWith = async (headers: Record<string, unknown>, path = "clients") => {
    const seen: any[] = [];
    await signroomHandler(deps({ status: 200, json: {} }, seen))(
      req({ query: { path }, headers: { origin: "https://app.example.com", ...headers } }),
      res() as never,
    );
    return seen[0];
  };

  it("a signed-in request carries x-signroom-workspace as user.workspaceId", async () => {
    expect((await signedInWith({ "x-signroom-workspace": W })).user).toEqual({ id: "u1", email: "o@example.com", workspaceId: W });
  });

  it("takes the first value of a repeated header", async () => {
    expect((await signedInWith({ "x-signroom-workspace": [W, "other"] })).user.workspaceId).toBe(W);
  });

  it("without the header, or with an empty or over-long one, user has no workspaceId", async () => {
    for (const headers of [{}, { "x-signroom-workspace": "" }, { "x-signroom-workspace": [] }, { "x-signroom-workspace": "a".repeat(65) }]) {
      const seen = await signedInWith(headers);
      expect(seen.user).toEqual({ id: "u1", email: "o@example.com" });
      expect(seen.user).not.toHaveProperty("workspaceId");
    }
    expect((await signedInWith({ "x-signroom-workspace": "a".repeat(64) })).user.workspaceId).toBe("a".repeat(64));
  });

  it("guest paths ignore it: no user at all", async () => {
    for (const path of ["billing-guest/artifact", "guest/artifact-url"]) {
      const seen = await signedInWith({ "x-signroom-workspace": W }, path);
      expect(seen.user).toBeNull();
    }
  });
});

describe("realSignedIn", () => {
  it("takes the email from refuseSignedOut and asks Auth nothing more", async () => {
    vi.mocked(guard.refuseSignedOut).mockResolvedValueOnce({ userId: "u1", email: "o@example.com" });
    expect(await realSignedIn(req(), res() as never)).toEqual({ id: "u1", email: "o@example.com" });
    expect(guard.refuseSignedOut).toHaveBeenCalledTimes(1);
    vi.mocked(guard.refuseSignedOut).mockResolvedValueOnce(null);
    expect(await realSignedIn(req(), res() as never)).toBeNull();
  });
});

describe("api/signroom: what is left out", () => {
  it("the email sign-in callback is an ordinary path now: no way round the origin check or the sign-in", async () => {
    const d = deps({ status: 200, json: {} });
    const foreign = res();
    await signroomHandler(d)(
      req({ headers: { referer: "https://accounts.google.com/", cookie: "sr_mail_oauth=brw123" }, query: { path: "email-connection/callback", state: "S", code: "C" } }),
      foreign as never,
    );
    expect(foreign.statusCode).toBe(403);
    expect(d.route).not.toHaveBeenCalled();
    expect(foreign.headers["set-cookie"]).toBeUndefined();
    expect(foreign.headers.location).toBeUndefined();
  });

  it("the config gives the function 300 seconds, and the limits are the documented ones", () => {
    expect(config).toEqual({ maxDuration: 300 });
    expect(MAX_BODY_BYTES).toBe(1_000_000);
    expect(WORKSPACE_HEADER_MAX).toBe(64);
  });

  it("a referer on our own site passes the origin check when there is no Origin (a same-origin GET)", async () => {
    const seen: any[] = [];
    const r = res();
    await signroomHandler(deps({ status: 200, json: {} }, seen))(req({ headers: { referer: "https://app.example.com/documents/agreements" }, query: { path: "agreements" } }), r as never);
    expect(r.statusCode).toBe(200);
    expect(seen[0].origin).toBe("https://app.example.com");
  });

  it("503 when the deps cannot be built (Supabase is not configured)", async () => {
    const d = { ...deps({ status: 200, json: {} }), build: () => null };
    const r = res();
    await signroomHandler(d)(req({ query: { path: "clients" } }), r as never);
    expect(r.statusCode).toBe(503);
    expect(d.route).not.toHaveBeenCalled();
  });

  it("a route that throws is a plain 500 with no detail", async () => {
    const d = deps({ status: 200, json: {} });
    d.route = vi.fn(async () => {
      throw new Error("secret detail");
    }) as never;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = res();
    await signroomHandler(d)(req({ query: { path: "clients" } }), r as never);
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret detail");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret detail");
    logged.mockRestore();
  });
});
