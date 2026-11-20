// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAILREACH_BASE, mailReach, MailReachError, type MailReach, type MrAccount } from "../../../api/_warmup/mailreach";
import {
  KEY_NO_LONGER_MESSAGE,
  KEY_REFUSED_MESSAGE,
  KEY_SHAPE_MESSAGE,
  MAILBOX_NOT_FOUND_MESSAGE,
  mailboxStatus,
  MEMBERS_ONLY_MESSAGE,
  NO_INBOX_MESSAGE,
  NO_PASSWORD_MESSAGE,
  NOT_IN_SERVICE_MESSAGE,
  NOT_LINKED_MESSAGE,
  OWNER_ONLY_MESSAGE,
  route,
  SEATS_MESSAGE,
  SECRET_KEY_MISSING_MESSAGE,
  signInFailedMessage,
  TABLE_MISSING_MESSAGE,
  UNAVAILABLE_MESSAGE,
  type WarmupDeps,
} from "../../../api/_warmup/router";
import { notReadyReason, type WarmupMailbox, type WarmupStatus } from "../../../api/_warmup/shared/types";
import type { Mailbox, WarmupStore } from "../../../api/_warmup/store";
import { warmupHandler, type WarmupHandlerDeps } from "../../../api/email/warmup";

/**
 * Mailbox warm-up through MailReach: whose key is used, what each mailbox is
 * told to be, and that no key or password ever leaves the server. Nothing here
 * touches the network.
 */

const ORG = "0b000000-0000-4000-8000-000000000001";
const ORG2 = "0b000000-0000-4000-8000-000000000002";
const WS = "0a000000-0000-4000-8000-000000000001";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const ADMIN = "0c000000-0000-4000-8000-000000000002";
const MEMBER = "0c000000-0000-4000-8000-000000000003";
const OUTSIDER = "0c000000-0000-4000-8000-000000000099";
const BOX = "0d000000-0000-4000-8000-000000000001";
const BOX_NEW = "0d000000-0000-4000-8000-000000000002";
const BOX_NO_INBOX = "0d000000-0000-4000-8000-000000000003";
const BOX_OTHER_ORG = "0d000000-0000-4000-8000-000000000009";
const API_KEY = "mr_live_0123456789abcdef";
const NOW = new Date("2026-11-20T10:00:00Z");

const mailbox = (id: string, email: string, over: Partial<Mailbox> = {}): Mailbox => ({
  id, organizationId: ORG, workspaceId: WS, email, fromName: "Sam Carter", username: email,
  smtpHost: "smtp.northwind.test", smtpPort: 587, smtpSecure: false, imapHost: "imap.northwind.test", imapPort: 993, ...over,
});

const account = (over: Partial<MrAccount>): MrAccount => ({
  id: 1, email: "sam@northwind.test", createdAt: "2026-11-01T10:00:00Z", alive: true, suspended: false, warmingEnabled: true, score: 87, ...over,
});

function world() {
  const state = {
    ready: true,
    keys: new Map<string, string>(),
    secrets: new Map<string, string>([[BOX, "enc:mailbox-password"], [BOX_NEW, "enc:mailbox-password"], [BOX_NO_INBOX, "enc:mailbox-password"]]),
    boxes: [
      mailbox(BOX, "sam@northwind.test"),
      mailbox(BOX_NEW, "priya@northwind.test"),
      mailbox(BOX_NO_INBOX, "tom@northwind.test", { imapHost: null, imapPort: null }),
      mailbox(BOX_OTHER_ORG, "elena@harbour.test", { organizationId: ORG2 }),
    ],
    remote: [account({})] as MrAccount[],
    stats: { sent: 210, spam: 6 },
    failWith: null as MailReachError | null,
    usedKeys: [] as string[],
    connected: [] as unknown[],
    suspended: [] as Array<[number, boolean]>,
  };
  const roles: Record<string, "owner" | "admin" | "member"> = { [OWNER]: "owner", [ADMIN]: "admin", [MEMBER]: "member" };
  const store: WarmupStore = {
    tablesReady: async () => state.ready,
    orgRole: async (org, user) => (org === ORG ? roles[user] ?? null : null),
    key: async (org) => state.keys.get(org) ?? null,
    saveKey: async (org, encrypted) => void state.keys.set(org, encrypted),
    removeKey: async (org) => void state.keys.delete(org),
    mailboxes: async (org, ws) => state.boxes.filter((b) => b.organizationId === org && (!ws || b.workspaceId === ws)),
    mailbox: async (id) => state.boxes.find((b) => b.id === id) ?? null,
    mailboxSecret: async (id) => state.secrets.get(id) ?? null,
  };
  const service = (apiKey: string): MailReach => {
    state.usedKeys.push(apiKey);
    const guard = () => {
      if (state.failWith) throw state.failWith;
    };
    return {
      accounts: async () => (guard(), state.remote),
      stats: async () => (guard(), state.stats),
      connect: async (input) => {
        guard();
        state.connected.push(input);
        const made = account({ id: 2, email: input.email, createdAt: NOW.toISOString(), score: null });
        state.remote.push(made);
        return made;
      },
      suspend: async (id, suspended) => {
        guard();
        state.suspended.push([id, suspended]);
      },
    };
  };
  const deps: WarmupDeps = {
    store,
    service,
    crypto: { encrypt: async (plain) => "enc:" + plain, decrypt: async (packed) => (packed.startsWith("enc:") ? packed.slice(4) : Promise.reject(new Error("bad"))) },
    now: () => NOW,
  };
  const as = (user: string) => ({
    status: (query: Record<string, string> = { organizationId: ORG }) => route(deps, { method: "GET", action: "status", query, body: {}, user: { id: user } }),
    post: (action: string, body: Record<string, unknown>) => route(deps, { method: "POST", action, query: {}, body, user: { id: user } }),
    del: (action: string, body: Record<string, unknown>) => route(deps, { method: "DELETE", action, query: {}, body, user: { id: user } }),
  });
  const link = () => void state.keys.set(ORG, "enc:" + API_KEY);
  return { state, deps, as, link };
}

describe("warm-up: the key of the warm-up service", () => {
  it("is checked with the service, then kept encrypted for that organisation", async () => {
    const w = world();
    const out = await w.as(OWNER).post("key", { organizationId: ORG, apiKey: `  ${API_KEY} ` });
    expect(out).toEqual({ status: 200, json: { ok: true, inboxes: 1 } });
    expect(w.state.usedKeys).toEqual([API_KEY]);
    expect(w.state.keys.get(ORG)).toBe("enc:" + API_KEY);
    expect(JSON.stringify(out)).not.toContain(API_KEY);
  });

  it("is not kept when the service refuses it or cannot be reached", async () => {
    const w = world();
    w.state.failWith = new MailReachError(401);
    expect(await w.as(OWNER).post("key", { organizationId: ORG, apiKey: API_KEY })).toEqual({ status: 409, json: { error: KEY_REFUSED_MESSAGE } });
    w.state.failWith = new MailReachError(0);
    expect(await w.as(OWNER).post("key", { organizationId: ORG, apiKey: API_KEY })).toEqual({ status: 502, json: { error: UNAVAILABLE_MESSAGE } });
    expect(w.state.keys.size).toBe(0);
    expect(await w.as(OWNER).post("key", { organizationId: ORG, apiKey: "short" })).toEqual({ status: 400, json: { error: KEY_SHAPE_MESSAGE } });
    expect(w.state.usedKeys).toHaveLength(2);
  });

  it("is for the owner and admins of that organisation only", async () => {
    const w = world();
    for (const who of [MEMBER, OUTSIDER]) {
      expect(await w.as(who).post("key", { organizationId: ORG, apiKey: API_KEY })).toEqual({ status: 403, json: { error: OWNER_ONLY_MESSAGE } });
      expect((await w.as(who).del("key", { organizationId: ORG })).status).toBe(403);
    }
    // A member sends campaigns too, so may read where the mailboxes stand; an outsider may not.
    expect((await w.as(MEMBER).status()).status).toBe(200);
    expect(await w.as(OUTSIDER).status()).toEqual({ status: 403, json: { error: MEMBERS_ONLY_MESSAGE } });
    // An owner of one organisation cannot touch another's.
    expect((await w.as(OWNER).post("key", { organizationId: ORG2, apiKey: API_KEY })).status).toBe(403);
    expect((await w.as(OWNER).status({ organizationId: ORG2 })).status).toBe(403);
    expect(w.state.usedKeys).toEqual([]);
  });

  it("can be removed, and says what is missing while it cannot be stored", async () => {
    const w = world();
    w.link();
    expect(await w.as(ADMIN).del("key", { organizationId: ORG })).toEqual({ status: 200, json: { ok: true } });
    expect(w.state.keys.size).toBe(0);
    w.state.ready = false;
    expect(await w.as(OWNER).post("key", { organizationId: ORG, apiKey: API_KEY })).toEqual({ status: 503, json: { error: TABLE_MISSING_MESSAGE } });
    w.state.ready = true;
    w.deps.crypto = null;
    expect(await w.as(OWNER).post("key", { organizationId: ORG, apiKey: API_KEY })).toEqual({ status: 503, json: { error: SECRET_KEY_MISSING_MESSAGE } });
  });
});

describe("warm-up: where each mailbox stands", () => {
  it("is not linked until a key is saved", async () => {
    const w = world();
    expect((await w.as(OWNER).status()).json).toEqual({ linked: false, problem: null, periodDays: 14, mailboxes: {} });
    w.state.ready = false;
    expect(((await w.as(OWNER).status()).json as WarmupStatus).problem).toBe(TABLE_MISSING_MESSAGE);
  });

  it("matches the organisation's mailboxes to the service by address, with its own key", async () => {
    const w = world();
    w.link();
    const out = (await w.as(ADMIN).status({ organizationId: ORG, workspaceId: WS })).json as WarmupStatus;
    expect(w.state.usedKeys).toEqual([API_KEY]);
    expect(out.linked).toBe(true);
    expect(out.problem).toBeNull();
    expect(out.mailboxes[BOX]).toEqual({ state: "warming", score: 87, days: 19, sent: 210, spam: 6, spamPercent: 2.9, ready: true });
    expect(out.mailboxes[BOX_NEW]).toEqual({ state: "not_connected", score: null, days: null, sent: 0, spam: 0, spamPercent: null, ready: false });
    // Another organisation's mailbox is never part of the answer.
    expect(Object.keys(out.mailboxes).sort()).toEqual([BOX, BOX_NEW, BOX_NO_INBOX].sort());
  });

  it("says what is wrong in place of the figures when the service refuses the saved key", async () => {
    const w = world();
    w.link();
    w.state.failWith = new MailReachError(401);
    expect((await w.as(OWNER).status()).json).toEqual({ linked: true, problem: KEY_NO_LONGER_MESSAGE, periodDays: 14, mailboxes: {} });
    w.state.failWith = new MailReachError(500);
    expect(((await w.as(OWNER).status()).json as WarmupStatus).problem).toBe(UNAVAILABLE_MESSAGE);
  });

  it("calls a mailbox ready only once it has warmed long enough with little in spam", () => {
    const stats = { sent: 200, spam: 4 };
    expect(mailboxStatus(account({}), stats, NOW)).toMatchObject({ state: "warming", days: 19, ready: true });
    const young = mailboxStatus(account({ createdAt: "2026-11-15T10:00:00Z" }), stats, NOW);
    expect(young).toMatchObject({ days: 5, ready: false });
    expect(notReadyReason(young)).toBe("Warming for 5 days: 9 more to go.");
    const spammy = mailboxStatus(account({}), { sent: 200, spam: 50 }, NOW);
    expect(spammy).toMatchObject({ spamPercent: 25, ready: false });
    expect(notReadyReason(spammy)).toBe("25% of its warm-up emails still land in spam.");
    const quiet = mailboxStatus(account({}), { sent: 3, spam: 0 }, NOW);
    expect(quiet.ready).toBe(false);
    expect(notReadyReason(quiet)).toBe("Not enough warm-up emails have been sent yet to judge.");
    expect(mailboxStatus(account({ suspended: true }), stats, NOW)).toMatchObject({ state: "paused", ready: false });
    expect(mailboxStatus(account({ warmingEnabled: false }), stats, NOW).state).toBe("off");
    expect(mailboxStatus(account({ alive: false }), stats, NOW).state).toBe("disconnected");
    expect(notReadyReason(mailboxStatus(account({}), stats, NOW))).toBeNull();
    const none: WarmupMailbox = { state: "not_connected", score: null, days: null, sent: 0, spam: 0, spamPercent: null, ready: false };
    expect(notReadyReason(none)).toBe("Warm-up has not been started for this mailbox.");
  });
});

describe("warm-up: starting and pausing it", () => {
  it("adds the mailbox to the service with its own sign-in, never sending the password to the page", async () => {
    const w = world();
    w.link();
    const out = await w.as(OWNER).post("connect", { mailboxId: BOX_NEW });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ mailbox: { state: "warming", score: null, days: 0, sent: 0, spam: 0, spamPercent: null, ready: false } });
    expect(w.state.connected).toEqual([
      {
        email: "priya@northwind.test", firstName: "Sam", lastName: "Carter", provider: "custom", username: "priya@northwind.test", password: "mailbox-password",
        imapHost: "imap.northwind.test", imapPort: 993, smtpHost: "smtp.northwind.test", smtpPort: 587, smtpStartTls: true,
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("mailbox-password");
  });

  it("refuses a mailbox with no inbox settings or no saved password, and anyone else's mailbox", async () => {
    const w = world();
    w.link();
    expect(await w.as(OWNER).post("connect", { mailboxId: BOX_NO_INBOX })).toEqual({ status: 409, json: { error: NO_INBOX_MESSAGE } });
    w.state.secrets.delete(BOX_NEW);
    expect(await w.as(OWNER).post("connect", { mailboxId: BOX_NEW })).toEqual({ status: 409, json: { error: NO_PASSWORD_MESSAGE } });
    expect(await w.as(OWNER).post("connect", { mailboxId: BOX_OTHER_ORG })).toEqual({ status: 404, json: { error: MAILBOX_NOT_FOUND_MESSAGE } });
    expect(await w.as(OUTSIDER).post("connect", { mailboxId: BOX })).toEqual({ status: 404, json: { error: MAILBOX_NOT_FOUND_MESSAGE } });
    expect(await w.as(MEMBER).post("connect", { mailboxId: BOX })).toEqual({ status: 403, json: { error: OWNER_ONLY_MESSAGE } });
    expect(w.state.connected).toEqual([]);
  });

  it("needs a key first", async () => {
    const w = world();
    expect(await w.as(OWNER).post("connect", { mailboxId: BOX_NEW })).toEqual({ status: 409, json: { error: NOT_LINKED_MESSAGE } });
  });

  it("says which sign-in the service could not make, and when there is no seat", async () => {
    const w = world();
    w.link();
    w.state.failWith = new MailReachError(500, { success: false, imap_auth_success: false, smtp_auth_success: true });
    expect((await w.as(OWNER).post("connect", { mailboxId: BOX_NEW })).json).toEqual({ error: signInFailedMessage(false, true) });
    expect(signInFailedMessage(false, true)).toContain("inbox (IMAP)");
    expect(signInFailedMessage(true, false)).toContain("sending server (SMTP)");
    w.state.failWith = new MailReachError(422, { message: "no seat" });
    expect((await w.as(OWNER).post("connect", { mailboxId: BOX_NEW })).json).toEqual({ error: SEATS_MESSAGE });
  });

  it("pauses and resumes a mailbox that is in the service", async () => {
    const w = world();
    w.link();
    expect((await w.as(ADMIN).post("pause", { mailboxId: BOX, paused: true })).json).toMatchObject({ mailbox: { state: "paused", ready: false } });
    expect((await w.as(ADMIN).post("pause", { mailboxId: BOX, paused: false })).json).toMatchObject({ mailbox: { state: "warming" } });
    expect(w.state.suspended).toEqual([[1, true], [1, false]]);
    expect(await w.as(ADMIN).post("pause", { mailboxId: BOX_NEW, paused: true })).toEqual({ status: 409, json: { error: NOT_IN_SERVICE_MESSAGE } });
  });
});

describe("warm-up: talking to the service", () => {
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends the key in the service's own header and reads every page of inboxes", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, email: `Box${i}@Northwind.test`, created_at: "2026-11-01T10:00:00Z", alive: true, suspended: false, warming_enabled: true, score: 80 }));
    const fetchMock = vi.fn(async (url: string) => reply(200, String(url).endsWith("page=0") ? page : [{ id: 99, email: "last@northwind.test", warming_enabled: false, suspended: true, alive: false, score: null }]));
    const accounts = await mailReach(API_KEY, fetchMock as never).accounts();
    expect(accounts).toHaveLength(51);
    expect(accounts[0]).toEqual({ id: 1, email: "box0@northwind.test", createdAt: "2026-11-01T10:00:00Z", alive: true, suspended: false, warmingEnabled: true, score: 80 });
    expect(accounts[50]).toMatchObject({ alive: false, suspended: true, warmingEnabled: false, score: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${MAILREACH_BASE}/accounts?page=0`);
    expect(init.headers["X-Api-Key"]).toBe(`Bearer ${API_KEY}`);
    expect(url).not.toContain(API_KEY);
  });

  it("reads the sent and spam counts, connects an inbox and pauses one", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.includes("/stats")) return reply(200, { total_messages_sent: 140, total_messages_received: 120, total_spam: 3 });
      if (url.endsWith("/imap_auth")) return reply(200, { id: 7, email: "priya@northwind.test", created_at: "2026-11-20T10:00:00Z" });
      return reply(200, {});
    });
    const mr = mailReach(API_KEY, fetchMock as never);
    expect(await mr.stats(7, 14)).toEqual({ sent: 140, spam: 3 });
    expect(calls[0][0]).toBe(`${MAILREACH_BASE}/accounts/7/stats?past_days=14`);
    await mr.connect({ email: "priya@northwind.test", firstName: "Priya", lastName: "Nair", provider: "custom", username: "priya@northwind.test", password: "pw", imapHost: "imap.x.test", imapPort: 993, smtpHost: "smtp.x.test", smtpPort: 465, smtpStartTls: false });
    expect(JSON.parse(String(calls[1][1].body))).toEqual({
      email: "priya@northwind.test", first_name: "Priya", last_name: "Nair", provider: "custom",
      imap_server: "imap.x.test", imap_server_port: 993, imap_server_username: "priya@northwind.test", imap_server_password: "pw",
      smtp_server: "smtp.x.test", smtp_server_port: 465, smtp_server_username: "priya@northwind.test", smtp_server_password: "pw",
      smtp_server_auth_type: "plain", smtp_server_starttls: false,
    });
    await mr.suspend(7, true);
    expect(calls[2][0]).toBe(`${MAILREACH_BASE}/accounts/7/suspend`);
    expect(JSON.parse(String(calls[2][1].body))).toEqual({ suspended: true });
  });

  it("turns a refusal and an unreachable service into an error with its status", async () => {
    await expect(mailReach(API_KEY, (async () => reply(401, { message: "Unauthorized" })) as never).accounts()).rejects.toMatchObject({ status: 401 });
    await expect(mailReach(API_KEY, (async () => { throw new Error("down"); }) as never).accounts()).rejects.toMatchObject({ status: 0 });
    const failed = mailReach(API_KEY, (async () => reply(500, { success: false, imap_auth_success: false })) as never);
    await expect(failed.accounts()).rejects.toMatchObject({ status: 500, detail: { imap_auth_success: false } });
  });
});

describe("warm-up: the way in", () => {
  const SITE = "https://app.example.com";
  type Res = { statusCode: number; body: unknown; status(c: number): Res; json(b: unknown): Res; setHeader(): Res };
  const res = (): Res => {
    const r: Res = { statusCode: 200, body: undefined, status: (c) => ((r.statusCode = c), r), json: (b) => ((r.body = b), r), setHeader: () => r };
    return r;
  };
  const deps = (over: Partial<WarmupHandlerDeps> = {}): WarmupHandlerDeps => ({
    signedIn: vi.fn(async () => ({ id: OWNER })),
    route: vi.fn(async () => ({ status: 200, json: { ok: true } })),
    build: () => ({}) as WarmupDeps,
    ...over,
  });
  const req = (over: Record<string, unknown> = {}) => ({ method: "GET", headers: { origin: SITE }, query: { do: "status", organizationId: ORG }, body: {}, ...over }) as never;
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_SITE_URL = SITE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("is open to our own pages and a signed-in account only", async () => {
    const d = deps();
    const ok = res();
    await warmupHandler(d)(req(), ok as never);
    expect(ok.body).toEqual({ ok: true });
    expect(d.route).toHaveBeenCalledWith(expect.anything(), { method: "GET", action: "status", query: { organizationId: ORG }, body: {}, user: { id: OWNER } });

    const foreign = res();
    await warmupHandler(deps())(req({ headers: { origin: "https://evil.example" } }), foreign as never);
    expect(foreign.statusCode).toBe(403);

    const out = res();
    const signedOut = deps({ signedIn: vi.fn(async (_r, r) => (r.status(401).json({ error: "Please sign in to use this tool." }), null)) as never });
    await warmupHandler(signedOut)(req(), out as never);
    expect(out.statusCode).toBe(401);
    expect(signedOut.route).not.toHaveBeenCalled();
  });
});

describe("migration 189", () => {
  const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/189_email_warmup.sql"), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("adds one table, can be run twice, and gives the browser no access", () => {
    expect([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(["email_warmup_keys"]);
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).toContain("alter table public.email_warmup_keys enable row level security");
    expect(code).toContain("revoke all on public.email_warmup_keys from public, anon, authenticated");
    expect(code).not.toMatch(/create policy/i);
    expect(raw.toLowerCase()).toContain("safe to run more than once");
    for (const col of ["organization_id", "key_encrypted", "updated_by", "updated_at"]) expect(code, col).toMatch(new RegExp(`\\n\\s+${col} `));
    expect(TABLE_MISSING_MESSAGE).toContain("189_email_warmup.sql");
  });
});
