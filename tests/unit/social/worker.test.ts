// @vitest-environment node
// The run that sends the posts that are due: whose key is used, when it is
// renewed, and what is written down when a post fails.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUDGET_MS, FAILED_MESSAGE, NOT_CONNECTED_MESSAGE, NO_ACCOUNT_MESSAGE, SERVICE_GIVE_UP_MS, SERVICE_LOOK_MS, SERVICE_WAIT_MS, TOO_LONG_MESSAGE, handedOver, handedOverNote, mediaOf, runWorker, type ContentRow, type WorkerDeps, type WorkerStore } from "../../../api/_social/worker";
import { CRON_LIMIT, PERSON_LIMIT, publishHandler } from "../../../api/social/publish";
import { startingOptions } from "../../../api/_social/shared/platforms";

const shared = { title: "Five tips", text: "What works.", tags: [] as string[] };

const row = (over: Partial<ContentRow> = {}): ContentRow => ({
  id: "post-1", organization_id: "org", workspace_id: "ws", account_id: "acc-x", title: shared.title, body: shared.text,
  media_urls: [], media: [], options: startingOptions("x", shared), ...over,
});

function setUp(over: { refs?: Record<string, string>; rows?: ContentRow[]; secrets?: Record<string, string | null>; providers?: Record<string, string>; reply?: (url: string, n: number) => { status?: number; json?: unknown } } = {}) {
  const secrets: Record<string, string | null> = { "acc-x": "x-token", ...(over.secrets ?? {}) };
  const providers: Record<string, string> = { "acc-x": "x", "acc-yt": "youtube", ...(over.providers ?? {}) };
  const log = { handed: [] as Array<[string, string | null]>, published: [] as Array<[string, string]>, failed: [] as Array<[string, string]>, released: [] as string[], accounts: [] as Array<[string, string | null]>, saved: [] as Array<[string, string]> };
  const store: WorkerStore = {
    claim: vi.fn(async () => over.rows ?? [row()]),
    account: async (id) => (providers[id] ? { id, provider: providers[id], external_account_id: "ext", credential_ref: over.refs?.[id] ?? null } : null),
    markHandedOver: async (id, note) => { log.handed.push([id, note]); },
    secret: async (id) => secrets[id] ?? null,
    saveSecret: async (id, plain) => { log.saved.push([id, plain]); secrets[id] = plain; },
    markPublished: async (r, externalId) => { log.published.push([r.id, externalId]); },
    markFailed: async (id, message) => { log.failed.push([id, message]); },
    release: async (id) => { log.released.push(id); },
    markAccount: async (id, problem) => { log.accounts.push([id, problem]); },
  };
  const calls: Array<{ url: string; auth: string }> = [];
  let clock = 1_000_000;
  const deps: WorkerDeps = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "") });
      const out = over.reply?.(String(url), calls.length) ?? { json: { data: { id: "tweet-1" } } };
      return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
    // Waiting takes time: a wait moves the clock on.
    wait: async (ms: number) => { clock += ms; },
    env: { SUPABASE_URL: "https://abc.supabase.co", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs", X_CLIENT_ID: "xid", POST_FOR_ME_API_KEY: "pfm_key" },
    now: () => clock,
  };
  return { store, deps, log, calls, tick: (ms: number) => { clock += ms; } };
}

describe("a run", () => {
  it("sends each post that is due with its account's key, and marks it as posted", async () => {
    const { store, deps, log, calls } = setUp();
    expect(await runWorker(store, deps, 10)).toEqual({ claimed: 1, published: 1, failed: 0, putBack: 0 });
    expect(store.claim).toHaveBeenCalledWith(10);
    expect(calls[0]).toEqual({ url: "https://api.x.com/2/tweets", auth: "Bearer x-token" });
    expect(log.published).toEqual([["post-1", "tweet-1"]]);
    // The account worked: any old "connect again" mark is cleared.
    expect(log.accounts).toEqual([["acc-x", null]]);
  });

  it("goes on to the next post when one fails, and writes down why in plain words", async () => {
    const { store, deps, log } = setUp({
      rows: [row({ id: "a" }), row({ id: "b" })],
      reply: (_url, n) => (n === 1 ? { status: 400, json: { detail: "Your post is a duplicate." } } : { json: { data: { id: "tweet-2" } } }),
    });
    expect(await runWorker(store, deps, 10)).toMatchObject({ published: 1, failed: 1 });
    expect(log.failed).toEqual([["a", "X did not accept the post: Your post is a duplicate."]]);
    expect(log.published).toEqual([["b", "tweet-2"]]);
  });

  it("fails a post with no account, or an account that was never connected, without calling anybody", async () => {
    const { store, deps, log, calls } = setUp({ rows: [row({ id: "a", account_id: null }), row({ id: "b", account_id: "acc-gone" })] });
    await runWorker(store, deps, 10);
    expect(log.failed).toEqual([["a", NO_ACCOUNT_MESSAGE], ["b", NOT_CONNECTED_MESSAGE]]);
    expect(calls).toHaveLength(0);
  });

  it("marks the account as needing to be connected again when the platform refuses its key", async () => {
    const { store, deps, log } = setUp({ reply: () => ({ status: 401, json: { title: "Unauthorized" } }) });
    await runWorker(store, deps, 10);
    expect(log.failed[0][1]).toContain("Connect the X account again");
    expect(log.accounts).toEqual([["acc-x", log.failed[0][1]]]);
  });

  it("puts the rest back in the queue when it runs out of time, instead of cutting a post off half-way", async () => {
    const setup = setUp({ rows: [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })] });
    const fetchReal = setup.deps.fetch;
    setup.deps.fetch = (async (...args: Parameters<typeof fetch>) => { setup.tick(BUDGET_MS + 1); return fetchReal(...args); }) as typeof fetch;
    expect(await runWorker(setup.store, setup.deps, 10)).toEqual({ claimed: 3, published: 1, failed: 0, putBack: 2 });
    expect(setup.log.released).toEqual(["b", "c"]);
  });

  it("says nothing of an error it does not know", async () => {
    const { store, deps, log } = setUp();
    store.account = async () => { throw new Error('relation "social_accounts" does not exist'); };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runWorker(store, deps, 10);
    expect(log.failed).toEqual([["post-1", FAILED_MESSAGE]]);
    vi.restoreAllMocks();
  });
});

describe("an account connected through the posting service", () => {
  const service = { refs: { "acc-x": "postforme:spc_x" }, secrets: { "acc-x": null } };
  const isCreate = (url: string) => url.endsWith("/v1/social-posts");

  it("hands the post over once, waits for the platform's answer, and marks it as posted with where it is", async () => {
    const { store, deps, log, calls } = setUp({
      ...service,
      reply: (url, n) => isCreate(url) ? { json: { id: "sp_1" } } : n < 4 ? { json: { data: [] } } : { json: { data: [{ success: true, platform_data: { url: "https://x.com/northwind/status/1" } }] } },
    });
    expect(await runWorker(store, deps, 10)).toEqual({ claimed: 1, published: 1, failed: 0, putBack: 0 });
    expect(calls.filter((c) => isCreate(c.url))).toHaveLength(1);
    expect(calls[0].auth).toBe("Bearer pfm_key");
    // It needs no key of the account: the service has it.
    expect(log.handed).toHaveLength(1);
    expect(handedOver(log.handed[0][1])).toMatchObject({ postId: "sp_1" });
    expect(log.published).toEqual([["post-1", "https://x.com/northwind/status/1"]]);
    expect(log.accounts).toEqual([["acc-x", null]]);
  });

  it("puts the post back when the platform has not answered in time, and the next run only asks again", async () => {
    const first = setUp({ ...service, reply: (url) => (isCreate(url) ? { json: { id: "sp_1" } } : { json: { data: [] } }) });
    expect(await runWorker(first.store, first.deps, 10)).toEqual({ claimed: 1, published: 0, failed: 0, putBack: 1 });
    expect(first.log.released).toEqual(["post-1"]);
    expect(first.log.failed).toEqual([]);
    // It looked several times, and stopped within the time one run may wait.
    const looks = first.calls.filter((c) => !isCreate(c.url)).length;
    expect(looks).toBeGreaterThan(2);
    expect(looks).toBeLessThanOrEqual(SERVICE_WAIT_MS / SERVICE_LOOK_MS + 1);

    const note = first.log.handed[0][1] as string;
    const next = setUp({
      ...service, rows: [row({ external_post_id: note })],
      reply: () => ({ json: { data: [{ success: true, platform_data: { id: "tweet-9" } }] } }),
    });
    expect(await runWorker(next.store, next.deps, 10)).toMatchObject({ published: 1 });
    // Not handed over a second time: the post is never sent twice.
    expect(next.calls.some((c) => isCreate(c.url))).toBe(false);
    expect(next.log.handed).toEqual([]);
    expect(next.log.published).toEqual([["post-1", "tweet-9"]]);
  });

  it("writes down the platform's reason when it refuses, and forgets the hand-over so the post can be tried again", async () => {
    const { store, deps, log } = setUp({
      ...service,
      reply: (url) => (isCreate(url) ? { json: { id: "sp_1" } } : { json: { data: [{ success: false, error: "Your post is a duplicate." }] } }),
    });
    expect(await runWorker(store, deps, 10)).toMatchObject({ failed: 1 });
    expect(log.failed).toEqual([["post-1", "X did not accept the post: Your post is a duplicate."]]);
    expect(log.handed.map(([, note]) => (note ? "kept" : null))).toEqual(["kept", null]);
    expect(log.accounts).toEqual([]);
  });

  it("marks the account for connecting again when the platform refused the connection", async () => {
    const { store, deps, log } = setUp({
      ...service,
      reply: (url) => (isCreate(url) ? { json: { id: "sp_1" } } : { json: { data: [{ success: false, error: "The access token has expired." }] } }),
    });
    await runWorker(store, deps, 10);
    expect(log.failed[0][1]).toBe("X account needs to be connected again. Connect it again, then try the post again.");
    expect(log.accounts).toEqual([["acc-x", log.failed[0][1]]]);
  });

  it("puts the post back, untouched, while the service is busy: nothing was taken", async () => {
    const { store, deps, log } = setUp({ ...service, reply: () => ({ status: 503, json: {} }) });
    expect(await runWorker(store, deps, 10)).toEqual({ claimed: 1, published: 0, failed: 0, putBack: 1 });
    expect(log.handed).toEqual([]);
    expect(log.failed).toEqual([]);
  });

  it("gives up on a post the platform never answered, in plain words", async () => {
    const old = handedOverNote("sp_old", 1_000_000);
    const { store, deps, log, calls, tick } = setUp({ ...service, rows: [row({ external_post_id: old })], reply: () => ({ json: { data: [] } }) });
    tick(SERVICE_GIVE_UP_MS + 1000);
    expect(await runWorker(store, deps, 10)).toMatchObject({ failed: 1 });
    expect(log.failed).toEqual([["post-1", TOO_LONG_MESSAGE]]);
    expect(log.handed).toEqual([["post-1", null]]);
    expect(calls.some((c) => isCreate(c.url))).toBe(false);
  });

  it("reads only its own notes: an address left by an earlier post is not one", () => {
    expect(handedOver("https://youtu.be/abc")).toBeNull();
    expect(handedOver("pfm:sp_1")).toBeNull();
    expect(handedOver(null)).toBeNull();
    expect(handedOver(handedOverNote("sp_1", 1_700_000_000_000))).toEqual({ postId: "sp_1", at: 1_700_000_000_000 });
  });

  it("leaves accounts connected with their own key exactly as they were", async () => {
    const { store, deps, log, calls } = setUp();
    await runWorker(store, deps, 10);
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(log.handed).toEqual([]);
  });
});

describe("keys that run out (YouTube, TikTok, X)", () => {
  const youtubeRow = () => row({
    account_id: "acc-yt", options: { ...startingOptions("youtube", shared), madeForKids: false },
    media: [{ url: "https://abc.supabase.co/storage/v1/object/public/social-media/ws/clip.mp4", kind: "video", mime: "video/mp4", bytes: 10, name: "clip.mp4" }],
  });

  it("are renewed before use, and the new key is saved", async () => {
    const { store, deps, log, calls } = setUp({
      rows: [youtubeRow()],
      secrets: { "acc-yt": JSON.stringify({ accessToken: "old", refreshToken: "refresh-1", expiresAt: 1 }) },
      reply: (url) => {
        if (url === "https://oauth2.googleapis.com/token") return { json: { access_token: "fresh", expires_in: 3600 } };
        if (url.startsWith("https://abc.supabase.co")) return { json: {} };
        return { status: 401, json: {} };
      },
    });
    await runWorker(store, deps, 10);
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(JSON.parse(log.saved[0][1])).toMatchObject({ accessToken: "fresh", refreshToken: "refresh-1" });
    // The upload was tried with the new key, never the old one.
    expect(calls.some((c) => c.auth === "Bearer old")).toBe(false);
    expect(calls.some((c) => c.auth === "Bearer fresh")).toBe(true);
  });

  it("are renewed once and tried once more when the platform refuses a key that looked good", async () => {
    let posts = 0;
    const { store, deps, log } = setUp({
      secrets: { "acc-x": JSON.stringify({ accessToken: "looks-good", refreshToken: "r", expiresAt: 1_000_000 + 3_600_000 }) },
      reply: (url) => {
        if (url === "https://api.x.com/2/oauth2/token") return { json: { access_token: "renewed", refresh_token: "r2", expires_in: 7200 } };
        posts += 1;
        return posts === 1 ? { status: 401, json: {} } : { json: { data: { id: "tweet-9" } } };
      },
    });
    expect(await runWorker(store, deps, 10)).toMatchObject({ published: 1, failed: 0 });
    expect(posts).toBe(2);
    expect(JSON.parse(log.saved[0][1])).toMatchObject({ accessToken: "renewed", refreshToken: "r2" });
  });
});

describe("the file of a post", () => {
  it("is what the composer saved, or the address an older post carried", () => {
    expect(mediaOf(row({ media: [{ url: "https://x/y.mp4", kind: "video", mime: "video/mp4", bytes: 9, name: "y.mp4" }] }))).toEqual({ url: "https://x/y.mp4", kind: "video", mime: "video/mp4", bytes: 9, name: "y.mp4" });
    expect(mediaOf(row({ media: [], media_urls: ["https://x/photo.jpg"] }))).toMatchObject({ kind: "image", url: "https://x/photo.jpg" });
    expect(mediaOf(row({ media: null, media_urls: ["https://x/clip.MOV?x=1"] }))).toMatchObject({ kind: "video" });
    expect(mediaOf(row())).toBeNull();
  });
});

describe("who may start a run", () => {
  const res = () => {
    const out = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
    return Object.assign(out, {
      status(code: number) { out.statusCode = code; return this; },
      json(body: unknown) { out.body = body; return this; },
      setHeader(name: string, value: string) { out.headers[name.toLowerCase()] = value; },
    });
  };
  const deps = (over: Partial<Parameters<typeof publishHandler>[0]> = {}) => ({
    isWorker: () => false, isSignedIn: async () => false, run: vi.fn(async () => ({ claimed: 0, published: 0, failed: 0, putBack: 0 })), ...over,
  });

  it("is the scheduled run, with the worker's secret", async () => {
    const d = deps({ isWorker: () => true });
    const out = res();
    await publishHandler(d)({ method: "GET", headers: {} } as never, out as never);
    expect(out.statusCode).toBe(200);
    expect(d.run).toHaveBeenCalledWith(CRON_LIMIT);
  });

  it("is a signed-in person who has just pressed Post, with a smaller run", async () => {
    const d = deps({ isSignedIn: async () => true });
    const out = res();
    await publishHandler(d)({ method: "POST", headers: {} } as never, out as never);
    expect(out.statusCode).toBe(200);
    expect(d.run).toHaveBeenCalledWith(PERSON_LIMIT);
  });

  it("is nobody else", async () => {
    const d = deps();
    const out = res();
    await publishHandler(d)({ method: "POST", headers: {} } as never, out as never);
    expect(out.statusCode).toBe(401);
    // A signed-in person cannot start it with a plain page load either.
    const d2 = deps({ isSignedIn: async () => true });
    const out2 = res();
    await publishHandler(d2)({ method: "GET", headers: {} } as never, out2 as never);
    expect(out2.statusCode).toBe(401);
    expect(d.run).not.toHaveBeenCalled();
    expect(d2.run).not.toHaveBeenCalled();
  });

  it("says nothing of what went wrong inside", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ isWorker: () => true, run: vi.fn(async () => { throw new Error("claim failed: permission denied for function"); }) });
    const out = res();
    await publishHandler(d)({ method: "GET", headers: {} } as never, out as never);
    expect(out.statusCode).toBe(500);
    expect(JSON.stringify(out.body)).not.toMatch(/permission|claim/);
    vi.restoreAllMocks();
  });
});

describe("the settings and the database file", () => {
  it("gives the run time to upload a video", () => {
    const v = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
    expect(v.functions["api/social/publish.ts"]).toEqual({ maxDuration: 300 });
  });

  it("adds the group, the platform fields and the file to a post, and a public place for the file", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/203_social_composer.sql"), "utf8");
    for (const column of ["post_group_id uuid", "options jsonb", "media jsonb"]) expect(sql).toContain(`add column if not exists ${column}`);
    expect(sql).toContain("'social-media', 'social-media', true");
    // A post cut off half-way does not stay "publishing" for ever.
    expect(sql).toContain("interval '20 minutes'");
    // Only people of the workspace may put a file there.
    expect(sql).toMatch(/social_media_write[\s\S]*can_access_workspace/);
  });
});
