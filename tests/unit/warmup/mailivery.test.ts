// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MAILIVERY_BASE, mailivery } from "../../../api/_warmup/mailivery";
import { MailReachError, type MailReach, type MrAccount } from "../../../api/_warmup/mailreach";
import { packKey, route, unpackKey, wordsFor, type WarmupDeps } from "../../../api/_warmup/router";
import { notReadyReason, SERVICE_LABEL, type WarmupMailbox, type WarmupStatus } from "../../../api/_warmup/shared/types";
import type { Mailbox, WarmupStore } from "../../../api/_warmup/store";

/**
 * Mailivery as a second warm-up service next to MailReach: how its API is
 * read, and that an organisation's key remembers which service it is for.
 * Nothing here touches the network.
 */

const KEY = "mv_live_0123456789abcdef";
const ORG = "0b000000-0000-4000-8000-000000000001";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const BOX = "0d000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-27T10:00:00Z");

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const campaign = (over: Record<string, unknown> = {}) => ({ id: 83, email: "Sam@Northwind.test", status_code: "active", created_at: "2026-11-01T10:00:00.000000Z", email_per_day: 20, ...over });

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function net(answer: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), method: String(init.method ?? "GET"), headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
    calls.push(call);
    return answer(call);
  });
  return { calls, service: mailivery(KEY, fetchMock as never, () => NOW) };
}

describe("Mailivery: reading its API", () => {
  it("lists every mailbox, page by page, with the key as a Bearer token", async () => {
    const first = Array.from({ length: 100 }, (_, i) => campaign({ id: i + 1, email: `box${i}@northwind.test` }));
    const n = net(({ url }) =>
      url.endsWith("&page=1")
        ? reply(200, { success: true, data: first, meta: { current_page: 1, last_page: 2 } })
        : reply(200, { success: true, data: [campaign({ id: 500, email: "Last@Northwind.test", status_code: "paused" }), campaign({ id: 501, email: "broken@northwind.test", status_code: "connection-problem" })], meta: { current_page: 2, last_page: 2 } }),
    );
    const all = await n.service.accounts();
    expect(all).toHaveLength(102);
    expect(all[0]).toEqual({ id: 1, email: "box0@northwind.test", createdAt: "2026-11-01T10:00:00.000000Z", alive: true, suspended: false, warmingEnabled: true, score: null });
    expect(all[100]).toMatchObject({ id: 500, email: "last@northwind.test", suspended: true, alive: true });
    expect(all[101]).toMatchObject({ alive: false });
    expect(n.calls.map((c) => c.url)).toEqual([`${MAILIVERY_BASE}/campaigns?per_page=100&page=1`, `${MAILIVERY_BASE}/campaigns?per_page=100&page=2`]);
    expect(n.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(n.calls[0].headers.Accept).toBe("application/json");
    expect(n.calls[0].headers["X-Request-ID"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(n.calls[0].url).not.toContain(KEY);
  });

  it("adds up the warm-up emails and the ones in spam for the days asked for, with the health score", async () => {
    const n = net(({ url }) => {
      if (url.endsWith("/get-metrics")) {
        return reply(200, {
          success: true,
          data: {
            // Too old to count for 14 days.
            "2026-11-01": { "Warm Up": { Total: 500, "landed In": { inbox: 100, spam: 400 } }, Replies: { Total: 3 } },
            "2026-11-20": { "Warm Up": { Total: 20, "landed In": { inbox: 17, spam: 3 } }, Replies: { Total: 6, "landed In": { inbox: 6 } } },
            // The other spelling the service uses, and a day with nothing in it.
            "2026-11-26": { "Warm Up": { total: 30, "Landed In": { inbox: 29, spam: 1 } }, Replies: { total: null, "landed in": null } },
            "2026-11-27": { "Warm Up": { Total: null, "landed In": null } },
            "not a date": { "Warm Up": { Total: 999, "landed In": { spam: 999 } } },
          },
        });
      }
      return reply(200, { success: true, data: { health_score: 96, health_score_status: "Ready" } });
    });
    expect(await n.service.stats(83, 14)).toEqual({ sent: 50, spam: 4, score: 96 });
    expect(n.calls.map((c) => `${c.method} ${c.url.replace(MAILIVERY_BASE, "")}`).sort()).toEqual(["PATCH /campaigns/83/get-health-score-points", "PATCH /campaigns/83/get-metrics"]);
  });

  it("still gives the figures when there is no score yet, and the score when the figures cannot be read", async () => {
    const young = net(({ url }) => (url.endsWith("/get-metrics") ? reply(200, { data: { "2026-11-26": { "Warm Up": { Total: 4, "landed In": { spam: 0 } } } } }) : reply(200, { data: { health_score: null, health_score_status: "Warming up" } })));
    expect(await young.service.stats(83, 14)).toEqual({ sent: 4, spam: 0, score: null });
    const half = net(({ url }) => (url.endsWith("/get-metrics") ? reply(500, {}) : reply(200, { data: { health_score: 71 } })));
    expect(await half.service.stats(83, 14)).toEqual({ sent: 0, spam: 0, score: 71 });
  });

  it("pauses and resumes, and takes 'already paused' and 'already started' as done", async () => {
    const n = net(({ url }) => (url.endsWith("/pause-warmup") ? reply(400, { success: false, code: "CAMPAIGN_ALREADY_PAUSED" }) : reply(400, { success: false, code: "CAMPAIGN_ALREADY_STARTED" })));
    await n.service.suspend(83, true);
    await n.service.suspend(83, false);
    expect(n.calls.map((c) => `${c.method} ${c.url.replace(MAILIVERY_BASE, "")}`)).toEqual(["PATCH /campaigns/83/pause-warmup", "PATCH /campaigns/83/resume-warmup"]);
    const down = net(() => reply(503, { code: "CAMPAIGN_WARMUP_NOT_PAUSED" }));
    await expect(down.service.suspend(83, true)).rejects.toMatchObject({ status: 503 });
  });

  it("adds a mailbox with its own sign-in as a form, then starts its warm-up", async () => {
    const n = net(({ url }) => (url.endsWith("/campaigns/smtp") ? reply(200, { success: true, code: "CAMPAIGN_CREATED", data: campaign({ id: 91, email: "priya@northwind.test" }) }) : reply(200, { success: true, code: "CAMPAIGN_WARMUP_STARTED", data: [] })));
    const made = await n.service.connect({ email: "priya@northwind.test", firstName: "Priya", lastName: "Nair", provider: "custom", username: "priya@northwind.test", password: "the-password", imapHost: "imap.ionos.co.uk", imapPort: 993, smtpHost: "smtp.ionos.co.uk", smtpPort: 587, smtpStartTls: true });
    expect(made).toMatchObject({ id: 91, email: "priya@northwind.test", alive: true });
    const form = n.calls[0].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(Object.fromEntries(form.entries())).toMatchObject({
      email: "priya@northwind.test", first_name: "Priya", last_name: "Nair",
      smtp_host: "smtp.ionos.co.uk", smtp_port: "587", smtp_username: "priya@northwind.test", smtp_password: "the-password",
      imap_host: "imap.ionos.co.uk", imap_port: "993", imap_username: "priya@northwind.test", imap_password: "the-password", imap_email: "priya@northwind.test",
      with_rampup: "1",
    });
    // The form's own content type (with its boundary) is left to the sender; a fixed one would break it.
    expect(n.calls[0].headers["Content-Type"]).toBeUndefined();
    expect(n.calls[1].url).toBe(`${MAILIVERY_BASE}/campaigns/91/start-warmup`);
  });

  it("says which thing went wrong when a mailbox cannot be added", async () => {
    const taken = net(({ url }) => (url.endsWith("/campaigns/smtp") ? reply(400, { code: "VALIDATION_ERROR", error: { email: ["The email has already been taken."] } }) : reply(200, { data: [campaign({ id: 83, email: "sam@northwind.test" })], meta: { current_page: 1, last_page: 1 } })));
    // Already in Mailivery: that is the mailbox we wanted, not a failure.
    expect(await taken.service.connect({ email: "sam@northwind.test", firstName: "Sam", lastName: "-", provider: "custom", username: "sam@northwind.test", password: "p", imapHost: "i", imapPort: 993, smtpHost: "s", smtpPort: 587, smtpStartTls: true })).toMatchObject({ id: 83 });
    const wrong = net(({ url }) => (url.endsWith("/campaigns/smtp") ? reply(200, { data: campaign({ id: 92 }) }) : reply(400, { code: "VALIDATION_CREDENTIALS_ERROR", errors: { credentials: ["Smtp or Imap credentials are not valid"] } })));
    await expect(wrong.service.connect({ email: "x@northwind.test", firstName: "X", lastName: "-", provider: "custom", username: "x@northwind.test", password: "p", imapHost: "i", imapPort: 993, smtpHost: "s", smtpPort: 587, smtpStartTls: true }))
      .rejects.toMatchObject({ status: 400, detail: { imap_auth_success: false, smtp_auth_success: false } });
  });

  it("turns a refused key and an unreachable service into an error with its status, never with the key in it", async () => {
    const refused = net(() => reply(401, { message: "Unauthorized" }));
    const e = await refused.service.accounts().catch((x) => x);
    expect(e).toBeInstanceOf(MailReachError);
    expect(e.status).toBe(401);
    expect(JSON.stringify(e) + String(e.message)).not.toContain(KEY);
    const gone = mailivery(KEY, (async () => { throw new TypeError("fetch failed"); }) as never);
    await expect(gone.accounts()).rejects.toMatchObject({ status: 0 });
  });
});

describe("Mailivery: an organisation's key remembers its service", () => {
  it("keeps a MailReach key as it always was, and marks a Mailivery key", () => {
    expect(packKey("mailreach", "mr_live_abc")).toBe("mr_live_abc");
    expect(packKey("mailivery", KEY)).toBe(`mailivery|${KEY}`);
    expect(unpackKey("mr_live_abc")).toEqual({ service: "mailreach", key: "mr_live_abc" });
    expect(unpackKey(`mailivery|${KEY}`)).toEqual({ service: "mailivery", key: KEY });
  });

  function world() {
    const keys = new Map<string, string>();
    const used: Array<[string, string]> = [];
    const box: Mailbox = { id: BOX, organizationId: ORG, workspaceId: null, email: "sam@northwind.test", fromName: "Sam Carter", username: "sam@northwind.test", smtpHost: "smtp.ionos.co.uk", smtpPort: 587, smtpSecure: false, imapHost: "imap.ionos.co.uk", imapPort: 993 };
    const remote: MrAccount = { id: 83, email: "sam@northwind.test", createdAt: "2026-10-01T10:00:00Z", alive: true, suspended: false, warmingEnabled: true, score: null };
    const fail = { with: null as MailReachError | null };
    const store: WarmupStore = {
      tablesReady: async () => true,
      orgRole: async (org, user) => (org === ORG && user === OWNER ? "owner" : null),
      key: async (org) => keys.get(org) ?? null,
      saveKey: async (org, encrypted) => void keys.set(org, encrypted),
      removeKey: async (org) => void keys.delete(org),
      mailboxes: async () => [box],
      mailbox: async (id) => (id === BOX ? box : null),
      mailboxSecret: async () => "enc:p",
    };
    const service = (apiKey: string, name?: string): MailReach => {
      used.push([String(name), apiKey]);
      const guard = () => { if (fail.with) throw fail.with; };
      return { accounts: async () => (guard(), [remote]), stats: async () => ({ sent: 120, spam: 3, score: 96 }), connect: async () => remote, suspend: async () => undefined };
    };
    const deps: WarmupDeps = { store, service, crypto: { encrypt: async (p) => "enc:" + p, decrypt: async (p) => p.slice(4) }, now: () => NOW };
    const post = (body: Record<string, unknown>) => route(deps, { method: "POST", action: "key", query: {}, body, user: { id: OWNER } });
    const status = async () => (await route(deps, { method: "GET", action: "status", query: { organizationId: ORG }, body: {}, user: { id: OWNER } })).json as WarmupStatus;
    return { keys, used, fail, post, status };
  }

  it("checks a Mailivery key with Mailivery, keeps it, and then reads the figures from Mailivery", async () => {
    const w = world();
    expect(await w.post({ organizationId: ORG, apiKey: KEY, service: "mailivery" })).toEqual({ status: 200, json: { ok: true, inboxes: 1 } });
    expect(w.used).toEqual([["mailivery", KEY]]);
    expect(w.keys.get(ORG)).toBe(`enc:mailivery|${KEY}`);
    const s = await w.status();
    expect(s).toMatchObject({ linked: true, problem: null, service: "mailivery" });
    // The score comes with the figures in Mailivery, not with the list of mailboxes.
    expect(s.mailboxes[BOX]).toMatchObject({ state: "warming", score: 96, sent: 120, spam: 3, spamPercent: 2.5, ready: true });
    expect(w.used[1]).toEqual(["mailivery", KEY]);
  });

  it("still takes a key with no service named as a MailReach key, and refuses a service it does not know", async () => {
    const w = world();
    await w.post({ organizationId: ORG, apiKey: "mr_live_0123456789" });
    expect(w.used).toEqual([["mailreach", "mr_live_0123456789"]]);
    expect((await w.status()).service).toBe("mailreach");
    expect((await w.post({ organizationId: ORG, apiKey: KEY, service: "someone-else" })).status).toBe(400);
  });

  it("names Mailivery, and where its key is found, in what the person reads", async () => {
    const w = world();
    w.fail.with = new MailReachError(401);
    const refused = await w.post({ organizationId: ORG, apiKey: KEY, service: "mailivery" });
    expect(refused).toEqual({ status: 409, json: { error: "Mailivery did not accept this key. Copy it again in Mailivery from Settings, Team Settings, API Access." } });
    expect(w.keys.size).toBe(0);
    w.keys.set(ORG, `enc:mailivery|${KEY}`);
    expect((await w.status()).problem).toBe("Mailivery no longer accepts the saved key. Add the current one in Email, Settings.");
    w.fail.with = new MailReachError(0);
    expect((await w.status()).problem).toBe("Mailivery could not be reached. Please try again in a minute.");
    expect(wordsFor("mailreach").keyRefused).toBe("MailReach did not accept this key. Copy it again from the Settings tab of your MailReach project.");
  });

  it("says the service's own name where a mailbox is switched off there", () => {
    const off: WarmupMailbox = { state: "off", score: null, days: 20, sent: 0, spam: 0, spamPercent: null, ready: false };
    expect(notReadyReason(off)).toBe("Warm-up is switched off for this mailbox in MailReach.");
    expect(notReadyReason(off, "mailivery")).toBe("Warm-up is switched off for this mailbox in Mailivery.");
    expect(SERVICE_LABEL).toEqual({ mailreach: "MailReach", mailivery: "Mailivery" });
  });
});
