// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailConnectionAction, OWNER_ONLY_MESSAGE, VERIFY_LIMIT, VERIFY_TOOL } from "../../../../api/_signroom/emailConnection";
import { StoreError } from "../../../../api/_signroom/errors";
import { MAIL_TOOL } from "../../../../api/_signroom/mail";
import { buildTestEmail, displayName, TEST_SUBJECT } from "../../../../api/_signroom/mailbox/content";
import { decryptPassword, KEY_UNAVAILABLE_MESSAGE, readKey } from "../../../../api/_signroom/mailbox/crypto";
import { CODE_EXPIRED_MESSAGE, finishAuthorization } from "../../../../api/_signroom/oauthConnection";
import { OAUTH_CONNECTED_PATH, OAUTH_FAILED_PATH, route } from "../../../../api/_signroom/router";
import { MORE_MISSING_MESSAGE } from "../../../../api/_signroom/setupMessages";
import type { Store } from "../../../../api/_signroom/store";
import { ORG2, withMemberRole, WS, WS2 } from "./helpers";
import { asSite, CALLBACK, KEY, mailboxRow, mailSetup, ORIGIN, OWNER } from "./mailboxFixtures";

/**
 * A workspace's own email connection: one per workspace, for an owner or admin
 * of its organisation only. The SMTP mailbox here; Google and Microsoft in
 * oauthConnection.test.ts.
 */
const owner = OWNER;
const admin2 = { id: "u2", email: "second@example.com", workspaceId: WS };
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const other = { id: "u9", email: "other@example.com", workspaceId: WS2 };
const SMTP = { provider: "gmail", email: "you@acme.test", password: "abcd efgh ijkl mnop" };
const GOOGLE = { provider: "google", email: "sender@example.test", clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret" };
const PASSWORDS = ["abcdefghijklmnop", "abcd efgh ijkl mnop", "app-password-1", "synthetic-client-secret"];

let logged: ReturnType<typeof vi.spyOn>;
let restoreSite: () => void;
beforeEach(() => {
  restoreSite = asSite();
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  // No password or client secret in any log line, in every test of this file.
  const text = JSON.stringify(logged.mock.calls.map((a) => a.map((x) => (x instanceof Error ? `${x.name} ${x.message}` : x))));
  for (const secret of PASSWORDS) expect(text).not.toContain(secret);
  logged.mockRestore();
  restoreSite();
});

function setup(opts: Parameters<typeof mailSetup>[0] = {}) {
  const t = mailSetup(opts);
  t.store.setOrgMember(WS, admin2.id, "admin");
  withMemberRole(t.store, member.id);
  t.store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
  t.store.setOrgMember(WS2, other.id, "admin");
  return t;
}
const act = (t: ReturnType<typeof setup>, action: Parameters<typeof emailConnectionAction>[2], body: Record<string, unknown> = {}, user = owner) =>
  emailConnectionAction(t.deps, user, action, body, ORIGIN) as Promise<Record<string, unknown>>;

describe("the SMTP mailbox", () => {
  it("a Gmail preset forces smtp.gmail.com:465, verifies, and never returns the password", async () => {
    const t = setup();
    const out = await act(t, "save", { ...SMTP, host: "evil.example.com", port: 587 });
    expect(out.verified).toBe(true);
    expect(typeof out.verifiedAt).toBe("string");
    expect(out.view).toMatchObject({ configured: true, provider: "smtp", status: "verified", mode: "live", email: "you@acme.test", host: "smtp.gmail.com", port: 465, preset: "gmail", available: true });
    expect(t.transport.connections[0]).toMatchObject({ host: "smtp.gmail.com", port: 465, security: "tls", password: "abcdefghijklmnop" });
    const [row] = t.store.mailboxRows();
    expect(row).toMatchObject({ workspace_id: WS, host: "smtp.gmail.com", port: 465 });
    expect(row.password_enc.startsWith("v1:")).toBe(true);
    expect(JSON.stringify(row)).not.toContain("abcdefgh");
    // Bound to this workspace: the same bytes do not open under another workspace's id.
    expect(decryptPassword(readKey(KEY)!, WS, row.password_enc)).toBe("abcdefghijklmnop");
    expect(decryptPassword(readKey(KEY)!, WS2, row.password_enc)).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/password|abcdefgh/i);
  });

  it("a refused login saves the settings unverified, with a plain sentence and no server text", async () => {
    const t = setup();
    t.transport.failVerify = Object.assign(new Error("535 5.7.8 Username and Password not accepted abcdefghijklmnop"), { code: "EAUTH", responseCode: 535 });
    const out = await act(t, "save", SMTP);
    expect(out.verified).toBe(false);
    expect(out.error).toMatch(/^Gmail didn't accept that password/);
    expect(out.view).toMatchObject({ status: "configured", mode: "platform", lastError: out.error });
    expect(JSON.stringify(out)).not.toContain("5.7.8");
  });

  it("view never contains a password and reads verified; with no row it reads none", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const view = await act(t, "view");
    expect(view).toMatchObject({ provider: "smtp", status: "verified", mode: "live", email: "you@acme.test", host: "smtp.gmail.com", port: 465, username: "you@acme.test", preset: "gmail", security: "tls", callbackUri: CALLBACK, smtpKept: false, smtpKeptVerified: false, available: true });
    expect(JSON.stringify(view).toLowerCase()).not.toContain("password");
    expect(JSON.stringify(view)).not.toContain("app-password-1");
    expect(await act(setup(), "view")).toEqual({ configured: false, provider: "smtp", status: "none", mode: "platform", smtpKept: false, smtpKeptVerified: false, callbackUri: CALLBACK, available: true });
  });

  it("a save without a password keeps the stored one only for the same server and user", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const kept = await act(t, "save", { provider: "gmail", email: "you@acme.test" });
    expect(kept.verified).toBe(true);
    expect(t.transport.connections.at(-1)).toMatchObject({ password: "app-password-1" });
    await expect(act(t, "save", { provider: "custom", email: "you@acme.test", host: "smtp.attacker.example.org", port: 465, security: "tls" })).rejects.toMatchObject({ status: 400, message: "Enter your password." });
    expect(t.transport.connections).toHaveLength(1);
  });

  it("verify checks the saved settings again; with nothing saved it says so", async () => {
    const t = setup({ mailbox: mailboxRow({ verified_at: null }) });
    expect(await act(t, "verify")).toMatchObject({ verified: true });
    expect(t.store.mailboxRows()[0].verified_at).toBeTruthy();
    await expect(act(setup(), "verify")).rejects.toMatchObject({ status: 409, message: "Save your email settings first." });
  });

  it("a password that no longer decrypts is not checked: the row is unverified and no attempt is spent", async () => {
    const t = setup({ mailbox: mailboxRow({ password_enc: "v1:AAAA:AAAA" }) });
    const spend = vi.fn(t.deps.spend!);
    t.deps.spend = spend;
    expect(await act(t, "verify")).toEqual({ verified: false, error: "Enter your mailbox password again." });
    expect(spend).not.toHaveBeenCalled();
    expect(t.store.mailboxRows()[0]).toMatchObject({ verified_at: null, last_error: "Enter your mailbox password again." });
  });

  it("test sends one email to the mailbox's own address, on the workspace's sending limits, and refuses when not connected", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const spent: string[] = [];
    const spend = t.deps.spend!;
    t.deps.spend = async (sb, tool, key, limit, win) => {
      spent.push(`${tool} ${key} ${limit} ${win}`);
      return spend(sb, tool, key, limit, win);
    };
    expect(await act(t, "test")).toEqual({ ok: true });
    expect(t.transport.sent).toHaveLength(1);
    expect(t.transport.sent[0]).toMatchObject({ to: "you@acme.test", subject: TEST_SUBJECT, from: { address: "you@acme.test" } });
    expect(t.transport.sent[0].text).not.toMatch(/securovix|signroom/i);
    expect(spent).toEqual([`${MAIL_TOOL} workspace:${WS} 20 1`]);
    expect(t.resend.calls).toHaveLength(0);
    await expect(act(setup(), "test")).rejects.toMatchObject({ status: 409, message: "Connect and verify your mailbox first." });
    await expect(act(setup({ mailbox: mailboxRow({ verified_at: null }) }), "test")).rejects.toMatchObject({ status: 409 });
  });

  it("a test the mailbox refuses unverifies it and logs without the password", async () => {
    const t = setup({ mailbox: mailboxRow() });
    t.transport.failSend = Object.assign(new Error("Invalid login app-password-1"), { code: "EAUTH", responseCode: 535 });
    await expect(act(t, "test")).rejects.toMatchObject({ status: 502, message: "Your mailbox refused the password. Check the email connection in Document settings." });
    expect(t.store.mailboxRows()[0].verified_at).toBeNull();
    expect(logged.mock.calls.length).toBeGreaterThan(0);
  });

  it("refuses a bad save with 400, and a save over the check limit with 429 (10 an hour, per workspace)", async () => {
    const t = setup();
    await expect(act(t, "save", { provider: "nope" })).rejects.toMatchObject({ status: 400, message: "Choose your email provider." });
    const spend = vi.fn(async () => ({ ok: false as const, minutesLeft: 7 }));
    t.deps.spend = spend;
    await expect(act(t, "save", SMTP)).rejects.toMatchObject({ status: 429, message: "You've checked your email settings 10 times this hour. Try again in 7 minutes." });
    expect(spend).toHaveBeenCalledWith(expect.anything(), VERIFY_TOOL, `workspace:${WS}`, VERIFY_LIMIT, 60);
    expect([VERIFY_TOOL, VERIFY_LIMIT]).toEqual(["mailbox-verify", 10]);
    expect(t.store.mailboxRows()).toHaveLength(0);
  });

  it("a server that is not on the public internet is never connected to", async () => {
    const t = setup();
    t.deps.lookup = async () => [{ address: "169.254.169.254", family: 4 }];
    const out = await act(t, "save", { provider: "custom", email: "you@acme.test", password: "pw-123456", host: "smtp.internal-looking.example.org", port: 587, security: "starttls" });
    expect(out).toMatchObject({ verified: false, error: "That email server isn't on the public internet, so we can't connect to it." });
    expect(t.transport.connections).toHaveLength(0);
  });

  it("disconnect removes the row", async () => {
    const t = setup({ mailbox: mailboxRow() });
    expect(await act(t, "disconnect")).toEqual({ ok: true });
    expect(t.store.mailboxRows()).toHaveLength(0);
  });

  it("the test email names the product and the address, and a display name loses what could break a header", () => {
    const mail = buildTestEmail('Acme "Studio" <x>\r\nBcc: evil@example.com', "you@acme.test");
    expect(mail.from).toEqual({ name: "Acme Studio x Bcc: evil@example.com", address: "you@acme.test" });
    expect(mail.subject).toBe("Test email from TaskCalendar");
    expect(mail.text).toContain("sent from you@acme.test");
    expect(mail.html).toContain("<br>");
    expect(mail.attachments).toEqual([]);
    expect(displayName("  ")).toBe("Your supplier");
  });
});

describe("who may see or change it", () => {
  it("every owner or admin of the workspace's organisation shares the one connection", async () => {
    const t = setup();
    await act(t, "save", SMTP);
    expect(await act(t, "view", {}, admin2)).toMatchObject({ provider: "smtp", status: "verified", email: "you@acme.test" });
    expect(await act(t, "disconnect", {}, admin2)).toEqual({ ok: true });
    expect(await act(t, "view")).toMatchObject({ status: "none" });
  });

  it("a Member is refused every action with the one sentence, and nothing is read, stored or sent", async () => {
    const t = setup({ mailbox: mailboxRow() });
    await act(t, "save", GOOGLE);
    const before = JSON.stringify([t.store.mailboxRows(), t.store.oauthRows(), t.store.oauthStates()]);
    const connections = t.transport.connections.length;
    for (const [action, body] of [["view", {}], ["save", SMTP], ["save", GOOGLE], ["disconnect", {}], ["test", {}], ["verify", {}], ["authorize", {}], ["confirm", { code: "123456" }]] as const) {
      await expect(act(t, action, body, member), action).rejects.toMatchObject({ status: 403, message: "Only a workspace owner or admin can change its email connection." });
    }
    expect(OWNER_ONLY_MESSAGE).toBe("Only a workspace owner or admin can change its email connection.");
    expect(JSON.stringify([t.store.mailboxRows(), t.store.oauthRows(), t.store.oauthStates()])).toBe(before);
    expect(t.transport.connections).toHaveLength(connections);
    expect(t.transport.sent).toHaveLength(0);
  });

  it("someone outside the organisation, and no workspace at all, are 403 Choose a workspace.", async () => {
    const t = setup({ mailbox: mailboxRow() });
    for (const user of [{ id: "x1", email: "x@example.com", workspaceId: WS }, { id: owner.id, email: owner.email }, { id: other.id, email: other.email, workspaceId: WS }]) {
      await expect(emailConnectionAction(t.deps, user, "view", {}, ORIGIN)).rejects.toMatchObject({ status: 403, message: "Choose a workspace." });
    }
  });

  it("another workspace has its own connection: it sees none of this one's, and changing its own leaves this one alone", async () => {
    const t = setup({ mailbox: mailboxRow() });
    expect(await act(t, "view", {}, other)).toMatchObject({ status: "none", configured: false });
    const mine = JSON.stringify(t.store.mailboxRows().filter((r) => r.workspace_id === WS));
    await act(t, "save", { ...SMTP, email: "them@other.test" }, other);
    await act(t, "save", GOOGLE, other);
    expect(t.store.mailboxRows().map((r) => r.workspace_id).sort()).toEqual([WS, WS2].sort());
    expect(t.store.oauthRows().map((r) => r.workspaceId)).toEqual([WS2]);
    await act(t, "disconnect", {}, other);
    await act(t, "disconnect", {}, other);
    expect(JSON.stringify(t.store.mailboxRows())).toBe(mine);
    expect(await act(t, "view")).toMatchObject({ provider: "smtp", status: "verified", email: "you@acme.test" });
  });
});

describe("the SMTP mailbox next to Google or Microsoft", () => {
  it("saving Google keeps the SMTP mailbox; saving SMTP again removes the Google row", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const smtpRow = JSON.stringify(t.store.mailboxRows());
    const saved = await act(t, "save", GOOGLE);
    expect(saved.verified).toBe(false);
    expect(saved.view).toMatchObject({ provider: "google", status: "configured", mode: "platform", smtpKept: true, smtpKeptVerified: true, hasClientSecret: true, clientId: "synthetic-client-id", tenant: "" });
    expect(JSON.stringify(t.store.mailboxRows())).toBe(smtpRow);
    expect(await act(t, "view")).toMatchObject({ provider: "google", smtpKept: true, callbackUri: CALLBACK });
    await act(t, "authorize");
    expect(t.store.oauthStates()).toHaveLength(1);

    const back = await act(t, "save", SMTP);
    expect(back.verified).toBe(true);
    expect(back.view).toMatchObject({ provider: "smtp", status: "verified", smtpKept: false });
    expect(t.store.oauthRows()).toHaveLength(0);
    expect(t.store.oauthStates()).toHaveLength(0);
  });

  it("a refused SMTP save leaves the Google row in place", async () => {
    const t = setup();
    await act(t, "save", GOOGLE);
    await expect(act(t, "save", { provider: "nope" })).rejects.toMatchObject({ status: 400 });
    expect(t.store.oauthRows()).toHaveLength(1);
  });

  it("disconnect with both removes only the Google row and pending sign-ins; the SMTP mailbox is the route again", async () => {
    const t = setup({ mailbox: mailboxRow() });
    await act(t, "save", GOOGLE);
    await act(t, "authorize");
    await act(t, "disconnect");
    expect(t.store.oauthRows()).toHaveLength(0);
    expect(t.store.oauthStates()).toHaveLength(0);
    expect(t.store.mailboxRows()).toHaveLength(1);
    expect(await act(t, "view")).toMatchObject({ provider: "smtp", status: "verified", smtpKept: false });
    await act(t, "disconnect");
    expect(t.store.mailboxRows()).toHaveLength(0);
    expect(await act(t, "view")).toMatchObject({ status: "none" });
  });

  it("smtpKeptVerified says whether the kept SMTP mailbox can send (verified, with the mail key)", async () => {
    const unverified = setup({ mailbox: mailboxRow({ verified_at: null }) });
    await act(unverified, "save", GOOGLE);
    expect(await act(unverified, "view")).toMatchObject({ smtpKept: true, smtpKeptVerified: false });
    const none = setup();
    await act(none, "save", { ...GOOGLE, provider: "microsoft", tenant: "contoso.onmicrosoft.com" });
    expect(await act(none, "view")).toMatchObject({ provider: "microsoft", tenant: "contoso.onmicrosoft.com", smtpKept: false, smtpKeptVerified: false });
  });

  it("view carries the callback URI for both kinds, and none for a foreign origin", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const view = (origin: string) => emailConnectionAction(t.deps, owner, "view", {}, origin);
    expect(await view("https://evil.example")).toMatchObject({ callbackUri: "" });
    expect(await emailConnectionAction(t.deps, owner, "view")).toMatchObject({ callbackUri: "" });
    await act(t, "save", GOOGLE);
    expect(await view(ORIGIN)).toMatchObject({ provider: "google", callbackUri: CALLBACK });
    expect(await view("https://evil.example")).toMatchObject({ provider: "google", callbackUri: "" });
    expect(await view("http://localhost:5173")).toMatchObject({ callbackUri: "http://localhost:5173/api/signroom/email-connection/callback" });
  });

  it("confirm with no Google or Microsoft row is refused; verify with one is not found; test goes to the provider's test", async () => {
    const t = setup({ mailbox: mailboxRow() });
    await expect(act(t, "confirm", { code: "123456" })).rejects.toMatchObject({ status: 400, message: CODE_EXPIRED_MESSAGE });
    await act(t, "save", GOOGLE);
    await expect(act(t, "verify")).rejects.toMatchObject({ status: 404, message: "Email connection action not found." });
    await expect(act(t, "test")).rejects.toMatchObject({ status: 400, message: "Complete provider sign-in before testing." });
    expect(t.transport.connections).toHaveLength(0);
    expect(t.transport.sent).toHaveLength(0);
  });
});

describe("without SIGNROOM_MAIL_KEY", () => {
  it("the view still opens and says the feature is not available; nothing is live", async () => {
    const t = setup({ mailbox: mailboxRow(), key: null });
    expect(await act(t, "view")).toMatchObject({ provider: "smtp", status: "verified", mode: "platform", available: false, smtpKeptVerified: false });
    const g = setup({ mailbox: mailboxRow() });
    await act(g, "save", GOOGLE);
    g.deps.key = null;
    expect(await act(g, "view")).toMatchObject({ provider: "google", hasClientSecret: false, mode: "platform", available: false, smtpKept: true, smtpKeptVerified: false });
  });

  it("changing or using a connection answers 503 with the sentence that names the setting, and nothing is stored or sent", async () => {
    const t = setup({ mailbox: mailboxRow(), key: null });
    const before = JSON.stringify(t.store.mailboxRows());
    const refusal = { status: 503, message: "Sending from your own mailbox is not set up yet: SIGNROOM_MAIL_KEY is missing in Vercel's environment variables." };
    expect(KEY_UNAVAILABLE_MESSAGE).toBe(refusal.message);
    for (const [action, body] of [["save", SMTP], ["save", GOOGLE], ["verify", {}], ["test", {}]] as const) await expect(act(t, action, body), action).rejects.toMatchObject(refusal);
    const g = setup();
    await act(g, "save", GOOGLE);
    g.deps.key = null;
    await expect(act(g, "authorize")).rejects.toMatchObject(refusal);
    await expect(act(g, "test")).rejects.toMatchObject(refusal);
    expect(g.store.oauthStates()).toHaveLength(0);
    expect(JSON.stringify(t.store.mailboxRows())).toBe(before);
    expect(t.transport.connections).toHaveLength(0);
    // Disconnect needs no key: a connection can always be removed.
    expect(await act(t, "disconnect")).toEqual({ ok: true });
  });
});

describe("before migration 186 is run", () => {
  /** 184 alone: none of the three tables is there. */
  function without186(store: Store): Store {
    const gone = (table: string) => async () => {
      throw new StoreError(`Could not find the table 'public.${table}' in the schema cache`);
    };
    return {
      ...store,
      getMailbox: gone("sr_mailboxes"), upsertMailbox: gone("sr_mailboxes"), markMailbox: gone("sr_mailboxes"), deleteMailbox: gone("sr_mailboxes"),
      getEmailOAuth: gone("sr_email_oauth"), replaceEmailOAuth: gone("sr_email_oauth"), updateEmailOAuth: gone("sr_email_oauth"), deleteEmailOAuth: gone("sr_email_oauth"),
      insertOAuthState: gone("sr_email_oauth_states"), takeOAuthState: gone("sr_email_oauth_states"), purgeOAuthStates: gone("sr_email_oauth_states"),
    };
  }

  it("every action answers 503 with the sentence that names the file", async () => {
    const t = setup();
    const deps = { ...t.deps, store: without186(t.store) };
    for (const [action, body] of [["view", {}], ["save", SMTP], ["save", GOOGLE], ["verify", {}], ["test", {}], ["disconnect", {}], ["authorize", {}], ["confirm", { code: "123456" }]] as const) {
      await expect(emailConnectionAction(deps, owner, action, body, ORIGIN), action).rejects.toMatchObject({ status: 503, message: MORE_MISSING_MESSAGE });
    }
    expect(t.transport.connections).toHaveLength(0);
  });

  it("any other database failure is the busy sentence, logged by name without its text", async () => {
    const t = setup();
    const store: Store = { ...t.store, getEmailOAuth: async () => { throw new StoreError("connection reset secret-detail"); } };
    await expect(emailConnectionAction({ ...t.deps, store }, owner, "view", {}, ORIGIN)).rejects.toMatchObject({ status: 503, message: "This tool is busy right now. Please try again in a minute." });
    expect(logged.mock.calls).toEqual([["[signroom-mailbox] database", "StoreError"]]);
  });
});

describe("the routes", () => {
  const call = (t: ReturnType<typeof setup>, method: string, path: string, body: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    route({ mail: t.deps }, { method, path: path.split("/"), query: {}, body, user: owner as typeof owner | null, origin: ORIGIN, ...extra });

  it("GET email-connection is the view; POST save, verify, test and disconnect answer as the actions do", async () => {
    const t = setup();
    expect(await call(t, "GET", "email-connection")).toMatchObject({ status: 200, json: { status: "none", callbackUri: CALLBACK } });
    const saved = await call(t, "POST", "email-connection/save", SMTP);
    expect(saved).toMatchObject({ status: 200, json: { verified: true, view: { provider: "smtp", status: "verified" } } });
    expect(await call(t, "POST", "email-connection/verify")).toMatchObject({ status: 200, json: { verified: true } });
    expect(await call(t, "POST", "email-connection/test")).toEqual({ status: 200, json: { ok: true } });
    expect(await call(t, "POST", "email-connection/disconnect")).toEqual({ status: 200, json: { ok: true } });
    for (const out of [saved]) expect(JSON.stringify(out)).not.toMatch(/abcdefgh|password/i);
  });

  it("authorize gives the page the provider's address only; the browser secret goes to the cookie", async () => {
    const t = setup();
    await call(t, "POST", "email-connection/save", GOOGLE);
    const out = await call(t, "POST", "email-connection/authorize");
    expect(out.status).toBe(200);
    expect(Object.keys(out.json as object)).toEqual(["url"]);
    expect(typeof out.setOAuthBrowser).toBe("string");
    expect(JSON.stringify(out.json)).not.toContain(out.setOAuthBrowser);
    expect((out.json as { url: string }).url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect((out.json as { url: string }).url).not.toContain("synthetic-client-secret");
  });

  it("a Member, a signed-out caller and unknown paths", async () => {
    const t = setup();
    expect(await call(t, "GET", "email-connection", {}, { user: member })).toEqual({ status: 403, json: { error: OWNER_ONLY_MESSAGE } });
    expect((await call(t, "GET", "email-connection", {}, { user: null })).status).toBe(401);
    expect((await call(t, "POST", "email-connection/save", SMTP, { user: null })).status).toBe(401);
    for (const [method, path] of [["POST", "email-connection"], ["GET", "email-connection/save"], ["POST", "email-connection/explode"], ["POST", "email-connection/view"], ["POST", "email-connection/callback"], ["GET", "email-connection/callback/x"], ["DELETE", "email-connection"]]) {
      expect(await call(t, method, path), `${method} ${path}`).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });

  it("the provider's redirect needs no sign-in: the cookie is the proof, and it always answers a 303", async () => {
    const t = setup();
    await call(t, "POST", "email-connection/save", GOOGLE);
    const started = await call(t, "POST", "email-connection/authorize");
    const state = new URL((started.json as { url: string }).url).searchParams.get("state")!;
    t.deps.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("/token")) return new Response(JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }));
      return new Response(JSON.stringify({ email: "sender@example.test" }));
    }) as never;
    const callback = (query: Record<string, string>, oauthBrowser?: string) =>
      route({ mail: t.deps }, { method: "GET", path: ["email-connection", "callback"], query, body: {}, user: null, origin: ORIGIN, ...(oauthBrowser ? { oauthBrowser } : {}) });

    // No cookie, the wrong cookie, a provider error: the same redirect, and nothing changes.
    const failed = { status: 303, redirect: OAUTH_FAILED_PATH, clearOAuthBrowser: true };
    expect(await callback({ state, code: "c1-synthetic-authorization-code" })).toEqual(failed);
    expect(await callback({ state, code: "c1-synthetic-authorization-code" }, "another-browser")).toEqual(failed);
    expect(await callback({ state, error: "access_denied" }, started.setOAuthBrowser)).toEqual(failed);
    expect(t.store.oauthRows()[0].status).toBe("configured");

    expect(await callback({ state, code: "c1-synthetic-authorization-code" }, started.setOAuthBrowser)).toEqual({ status: 303, redirect: OAUTH_CONNECTED_PATH, clearOAuthBrowser: true });
    expect(t.store.oauthRows()[0].status).toBe("authenticated");
    expect([OAUTH_CONNECTED_PATH, OAUTH_FAILED_PATH]).toEqual(["/crm/document-settings?emailConnection=connected", "/crm/document-settings?emailConnection=error"]);
    // Used once.
    expect(await callback({ state, code: "c1-synthetic-authorization-code" }, started.setOAuthBrowser)).toEqual(failed);
    // The log names a status or an error name only.
    for (const args of logged.mock.calls) expect(JSON.stringify(args)).not.toMatch(/c1-synthetic|at-1|rt-1/);
    await expect(finishAuthorization(t.deps, {})).rejects.toMatchObject({ status: 400 });
  });
});
