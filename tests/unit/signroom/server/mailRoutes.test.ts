// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingAction, billingDelivery, billingSend } from "../../../../api/_signroom/billing";
import { emailConnectionAction, SERVER_UNREACHABLE_MESSAGE } from "../../../../api/_signroom/emailConnection";
import { StoreError } from "../../../../api/_signroom/errors";
import { mailReady, workspaceMailReady } from "../../../../api/_signroom/jobs";
import { deliveryAddress, MAIL_TOOL, sendMail } from "../../../../api/_signroom/mail";
import { encryptPassword } from "../../../../api/_signroom/mailbox/crypto";
import { TEST_FAILED_MESSAGE } from "../../../../api/_signroom/oauthConnection";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { maintain } from "../../../../api/_signroom/worker";
import { workspaceAction } from "../../../../api/_signroom/workspace";
import { PROVIDER_UNCONFIRMED_MESSAGE, RECONNECT_MESSAGE } from "../../../../api/_signroom/workEmail";
import { FROM, newClient } from "./agreementFixtures";
import { ORG2, WS, WS2 } from "./helpers";
import { asSite, mailboxRow, mailSetup as setup, OAUTH, ORIGIN, OWNER, withOAuth } from "./mailboxFixtures";

/**
 * Which way an email goes out: the workspace's verified Google or Microsoft
 * connection, else its verified SMTP mailbox, else the platform's address
 * through Resend. And what keeps working when the mail key or migration 186
 * is missing: everything, through Resend.
 */
const owner = OWNER;
const MAIL = { to: "pay@bloom.co", subject: "Invoice INV-1", text: "Hello\nthere", purpose: "invoice" };
const INVITE = { ...MAIL, purpose: "invite", agreementId: "a1", participantId: "p1" };
const SECRETS = [OAUTH.secret, OAUTH.access, OAUTH.renewed, OAUTH.refresh, "invalid_grant", "app-password-1"];

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
// No token, secret, password or address in any log line, in every test of this file.
afterEach(() => {
  const text = JSON.stringify(consoleArgs.map((a) => a.map((x) => (x instanceof Error ? `${x.name} ${x.message}` : x))));
  for (const s of [...SECRETS, "pay@bloom.co", "bea@bloom.co", OAUTH.email]) expect(text).not.toContain(s);
  spies.forEach((s) => s.mockRestore());
  restoreSite();
});

const ws = async (store: Store) => (await store.ensureWorkspace(WS, "Acme Studio", owner.id));
const deliveries = async (store: Store) => store.listDeliveries(WS, 10);

/** The rejection, checked to carry no token or secret in its sentence. */
async function refused(p: Promise<unknown>) {
  const e = (await p.then(
    () => null,
    (x: unknown) => x,
  )) as { message: string; status: number } | null;
  expect(e).not.toBeNull();
  for (const s of SECRETS) expect(e!.message).not.toContain(s);
  return e!;
}

/** A Google connection for WS (verified unless told otherwise; optionally a verified SMTP mailbox too), spends recorded. */
async function google(opts: Parameters<typeof withOAuth>[1] & { mailbox?: boolean } = {}) {
  const t = setup(opts.mailbox ? { mailbox: mailboxRow() } : {});
  const o = await withOAuth(t, opts);
  const spent: string[] = [];
  const spend = t.deps.spend!;
  t.deps.spend = async (sb, tool, key, limit, win) => {
    spent.push(`${tool} ${key} ${limit} ${win}`);
    return spend(sb, tool, key, limit, win);
  };
  return { ...t, ...o, spent };
}
const rawOf = (call: { init: RequestInit }) => Buffer.from(JSON.parse(String(call.init.body)).raw, "base64url").toString("utf8");
const bearer = (call: { init: RequestInit }) => (call.init.headers as Record<string, string>).Authorization;

async function issued(t: ReturnType<typeof setup>): Promise<Invoice> {
  const client = await newClient(t.store);
  const draft = (await billingAction(t.store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
  const saved = (await billingAction(t.store, owner, "POST", draft.id, "save", {
    revision: draft.revision, currency: "GBP", issueDate: draft.issueDate, dueDate: draft.dueDate,
    lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }], taxPercent: "0",
  })) as Invoice;
  return (await billingAction(t.store, owner, "POST", saved.id, "issue", { revision: saved.revision })) as Invoice;
}

describe("the SMTP mailbox route", () => {
  it("sends through a verified mailbox, with the delivery logged as mailbox", async () => {
    const t = setup({ mailbox: mailboxRow() });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "mailbox" });
    expect(t.transport.sent).toHaveLength(1);
    expect(t.transport.sent[0]).toMatchObject({ to: "pay@bloom.co", from: { address: "you@acme.test" }, subject: "Invoice INV-1", text: "Hello\nthere" });
    expect(t.transport.sent[0].html).toContain("Hello<br>there");
    expect(t.transport.connections[0]).toMatchObject({ host: "smtp.gmail.com", address: "142.250.27.108", password: "app-password-1" });
    expect(t.transport.closed).toBe(1);
    expect(t.resend.calls).toHaveLength(0);
    expect((await deliveries(t.store))[0]).toMatchObject({ route: "mailbox", status: "sent" });
  });

  it("uses the workspace's own sending limits (20 a minute, the day read first), not separate mailbox ones", async () => {
    const t = setup({ mailbox: mailboxRow() });
    const calls: string[] = [];
    t.deps.peek = async (_sb, tool, key, limit, win) => (calls.push(`peek ${tool} ${key} ${limit} ${win}`), { ok: true });
    t.deps.spend = async (_sb, tool, key, limit, win) => (calls.push(`spend ${tool} ${key} ${limit} ${win}`), { ok: true });
    await sendMail(t.deps, await ws(t.store), MAIL);
    expect(calls).toEqual([`peek ${MAIL_TOOL} workspace:${WS} 100 1440`, `spend ${MAIL_TOOL} workspace:${WS} 20 1`]);
    t.deps.spend = async () => ({ ok: false, minutesLeft: 1 });
    await expect(sendMail(t.deps, await ws(t.store), MAIL)).rejects.toMatchObject({ status: 429, message: "You can send up to 20 emails a minute. Try again in a minute." });
    expect(t.transport.sent).toHaveLength(1);
  });

  it("an unverified mailbox, or one whose password no longer decrypts, is not a route: Resend sends, and the view says why", async () => {
    const unverified = setup({ mailbox: mailboxRow({ verified_at: null }) });
    expect(await sendMail(unverified.deps, await ws(unverified.store), MAIL)).toEqual({ route: "securovix" });
    const t = setup({ mailbox: mailboxRow({ password_enc: "v1:AAAA:AAAA" }) });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(t.resend.calls).toHaveLength(1);
    expect(await emailConnectionAction(t.deps, owner, "view", {}, ORIGIN)).toMatchObject({ status: "configured", lastError: "Enter your mailbox password again." });
  });

  it("a password bound to another workspace does not open here", async () => {
    const t = setup({ mailbox: { ...mailboxRow({ workspace_id: WS2 }), workspace_id: WS } });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(t.transport.connections).toHaveLength(0);
  });

  it("marks the mailbox unverified and the delivery failed when the login is refused; never falls back mid-send", async () => {
    const t = setup({ mailbox: mailboxRow() });
    t.transport.failSend = Object.assign(new Error("Invalid login app-password-1"), { code: "EAUTH", responseCode: 535 });
    expect(await refused(sendMail(t.deps, await ws(t.store), MAIL))).toMatchObject({ status: 502, message: "Your mailbox refused the password. Check the email connection in Document settings." });
    expect(t.resend.calls).toHaveLength(0);
    expect(t.store.mailboxRows()[0].verified_at).toBeNull();
    expect((await deliveries(t.store))[0]).toMatchObject({ route: "mailbox", status: "failed" });
  });

  it("a server that cannot be reached, or is not public, is a 502 and a failed delivery", async () => {
    const t = setup({ mailbox: mailboxRow() });
    t.deps.lookup = async () => [{ address: "10.0.0.5", family: 4 }];
    expect(await refused(sendMail(t.deps, await ws(t.store), MAIL))).toMatchObject({ status: 502, message: SERVER_UNREACHABLE_MESSAGE });
    expect(t.transport.connections).toHaveLength(0);
    expect((await deliveries(t.store))[0]).toMatchObject({ route: "mailbox", status: "failed" });
  });

  it("another workspace's mailbox is never used for this workspace's mail", async () => {
    const t = setup({ mailbox: mailboxRow({ workspace_id: WS2 }) });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(t.transport.connections).toHaveLength(0);
  });
});

describe("the Google and Microsoft route", () => {
  it("an invoice goes through one Gmail call, from the connection's address, on the workspace's limits, with the invoice on its delivery row", async () => {
    const t = await google();
    const invoice = await issued(t);
    await billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN);
    expect(t.sends()).toHaveLength(1);
    expect(t.sends()[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(bearer(t.sends()[0])).toBe("Bearer " + OAUTH.access);
    expect(t.tokenCalls()).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
    expect(t.transport.connections).toHaveLength(0);
    const [d] = await deliveries(t.store);
    expect(d).toMatchObject({ route: "mailbox", status: "sent", invoiceId: invoice.id });
    const raw = rawOf(t.sends()[0]);
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <sender@example\.test>\r\n/);
    expect(raw).toContain("To: bea@bloom.co\r\n");
    expect(raw).toContain(`Message-ID: <${d.id}@example.test>\r\n`);
    expect(raw).not.toMatch(/securovix/i);
    expect(t.spent.filter((s) => s.startsWith(MAIL_TOOL))).toEqual([`${MAIL_TOOL} workspace:${WS} 20 1`]);
    expect(t.spent.some((s) => s.startsWith("mailbox-email"))).toBe(false);
    expect(await billingDelivery(t.deps, owner)).toEqual({ mode: "live", sender: OAUTH.email, ready: true });
  });

  it("Microsoft sends through Graph", async () => {
    const t = await google({ provider: "microsoft" });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "mailbox" });
    expect(t.sends()[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(String(t.sends()[0].init.body)).message.toRecipients).toEqual([{ emailAddress: { address: "pay@bloom.co" } }]);
  });

  it("a verified Google connection is used before a verified SMTP mailbox", async () => {
    const t = await google({ mailbox: true });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "mailbox" });
    expect(t.sends()).toHaveLength(1);
    expect(t.transport.sent).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
    expect(await billingDelivery(t.deps, owner)).toMatchObject({ mode: "live", sender: OAUTH.email });
  });

  it("replies go to the workspace's reply-to, or to the connection's address when it has none", async () => {
    const t = await google();
    await ws(t.store);
    await sendMail(t.deps, await t.store.updateWorkspace(WS, { replyTo: "accounts@acme.test" }), MAIL);
    expect(rawOf(t.sends()[0])).toContain("Reply-To: accounts@acme.test\r\n");
    await sendMail(t.deps, await t.store.updateWorkspace(WS, { replyTo: "" }), MAIL);
    expect(rawOf(t.sends()[1])).toContain("Reply-To: sender@example.test\r\n");
  });

  it("renews a token expiring in 30 seconds first, keeping the stored refresh token", async () => {
    const t = await google({ expiresIn: 30 });
    await sendMail(t.deps, await ws(t.store), MAIL);
    expect(t.tokenCalls()).toHaveLength(1);
    const call = t.tokenCalls()[0];
    expect(call.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(call.init.body));
    expect([form.get("grant_type"), form.get("refresh_token")]).toEqual(["refresh_token", OAUTH.refresh]);
    const after = await t.stored();
    expect(after).toMatchObject({ id: t.row.id, revision: t.row.revision, status: "verified" });
    expect(t.secretsOf(after)).toMatchObject({ accessToken: OAUTH.renewed, refreshToken: OAUTH.refresh, clientSecret: OAUTH.secret });
    expect(bearer(t.sends()[0])).toBe("Bearer " + OAUTH.renewed);
  });

  it("a refused renewal marks the connection reconnect and refuses every send, with no Resend or SMTP send", async () => {
    const t = await google({ expiresIn: 30, mailbox: true });
    t.provider.refresh = { status: 400, body: { error: "invalid_grant" } };
    const w = await ws(t.store);
    const sending = vi.fn(async () => undefined);
    expect(await refused(sendMail(t.deps, w, MAIL, { sending }))).toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(sending).not.toHaveBeenCalled();
    expect(await t.stored()).toMatchObject({ status: "reconnect", lastError: RECONNECT_MESSAGE });
    // The next send is refused the same way, without asking the provider again.
    expect(await refused(sendMail(t.deps, w, MAIL))).toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect(t.tokenCalls()).toHaveLength(1);
    // An agreement email's refusal is a failed delivery row with that sentence; the invoice emails wrote none.
    await refused(sendMail(t.deps, w, INVITE));
    const rows = await deliveries(t.store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agreementId: "a1", route: "mailbox", status: "failed", error: RECONNECT_MESSAGE });
    expect(t.sends()).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
    expect(t.transport.sent).toHaveLength(0);
    // The panel reads it as needing a new sign-in.
    expect(await emailConnectionAction(t.deps, owner, "view", {}, ORIGIN)).toMatchObject({ status: "configured", mode: "platform", lastError: RECONNECT_MESSAGE });
    expect(await billingDelivery(t.deps, owner)).toEqual({ mode: "live", sender: OAUTH.email, ready: true });
  });

  it.each([
    ["answers 503", { status: 503, body: {} }],
    ["cannot be reached", "throw"],
  ] as const)("a token endpoint that %s changes nothing and is a 502", async (_label, answer) => {
    const t = await google({ expiresIn: 30 });
    t.provider.refresh = answer as never;
    const before = JSON.stringify(t.store.oauthRows());
    expect(await refused(sendMail(t.deps, await ws(t.store), MAIL))).toMatchObject({ status: 502, message: SERVER_UNREACHABLE_MESSAGE });
    expect(JSON.stringify(t.store.oauthRows())).toBe(before);
    expect(t.sends()).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
  });

  it("secrets that no longer decrypt mean reconnect and 409", async () => {
    const t = await google();
    await t.store.updateEmailOAuth(WS, { id: t.row.id, revision: t.row.revision }, { secretsEnc: encryptPassword(t.deps.key!, WS, "{}") });
    expect(await refused(sendMail(t.deps, await ws(t.store), MAIL))).toMatchObject({ status: 409, message: RECONNECT_MESSAGE });
    expect((await t.stored()).status).toBe("reconnect");
    expect(t.provider.calls).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
  });

  it("a renewal racing a new save keeps the new configuration's secrets", async () => {
    const t = await google({ expiresIn: 30 });
    t.provider.onToken = async () => {
      t.provider.onToken = undefined;
      await emailConnectionAction(t.deps, owner, "save", { provider: "google", email: OAUTH.email, clientId: "new-client-id", clientSecret: "new-synthetic-secret" }, ORIGIN);
    };
    expect((await refused(sendMail(t.deps, await ws(t.store), MAIL))).status).toBe(409);
    const now = await t.stored();
    expect(now).toMatchObject({ clientId: "new-client-id", revision: 2, status: "configured" });
    expect(t.secretsOf(now)).toEqual({ clientSecret: "new-synthetic-secret" });
    expect(t.sends()).toHaveLength(0);
    expect(t.resend.calls).toHaveLength(0);
  });

  it.each(["configured", "authenticated"] as const)("status %s is not a route: Resend sends", async (status) => {
    const t = await google({ status });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(t.resend.calls).toHaveLength(1);
    expect(t.provider.calls).toHaveLength(0);
    expect(await billingDelivery(t.deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: true });
  });

  it("an unverified connection falls through to a verified SMTP mailbox", async () => {
    const t = await google({ status: "authenticated", mailbox: true });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "mailbox" });
    expect(t.transport.sent).toHaveLength(1);
    expect(t.provider.calls).toHaveLength(0);
    expect(await billingDelivery(t.deps, owner)).toMatchObject({ mode: "live", sender: "you@acme.test" });
  });

  it.each([true, false])("a never-verified connection whose renewal is refused in the test goes back to configured and never blocks mail (SMTP mailbox: %s)", async (mailbox) => {
    const t = await google({ status: "authenticated", expiresIn: 30, mailbox });
    t.provider.refresh = { status: 400, body: { error: "invalid_grant" } };
    await expect(emailConnectionAction(t.deps, owner, "test", {}, ORIGIN)).rejects.toMatchObject({ status: 502, message: TEST_FAILED_MESSAGE });
    expect(await t.stored()).toMatchObject({ status: "configured", lastError: RECONNECT_MESSAGE });
    const w = await ws(t.store);
    const providerCalls = t.provider.calls.length;
    for (const m of [MAIL, INVITE]) await sendMail(t.deps, w, m);
    expect(t.provider.calls).toHaveLength(providerCalls);
    const rows = await deliveries(t.store);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(rows.every((r) => r.route === (mailbox ? "mailbox" : "securovix"))).toBe(true);
    expect(mailbox ? t.transport.sent : t.resend.calls).toHaveLength(2);
  });

  it.each([
    ["Gmail answering 500", 500],
    ["Gmail timing out", "throw"],
  ] as const)("%s is a 502 that asks to check Sent mail, and the delivery is failed", async (_label, send) => {
    const t = await google();
    t.provider.send = send;
    expect(await refused(sendMail(t.deps, await ws(t.store), MAIL))).toMatchObject({ status: 502, message: PROVIDER_UNCONFIRMED_MESSAGE });
    expect(t.resend.calls).toHaveLength(0);
    expect((await deliveries(t.store))[0]).toMatchObject({ route: "mailbox", status: "failed", error: PROVIDER_UNCONFIRMED_MESSAGE });
  });

  it("the sending hook is told the route, after the limits and before the send", async () => {
    const t = await google();
    const order: string[] = [];
    const spend = t.deps.spend!;
    t.deps.spend = async (...a) => (order.push("limit"), spend(...a));
    await sendMail(t.deps, await ws(t.store), MAIL, { sending: async (route) => void order.push(`hook ${route} sends:${t.sends().length}`) });
    expect(order).toEqual(["limit", "hook mailbox sends:0"]);
    expect(t.sends()).toHaveLength(1);
  });

  it("another workspace's connection is never used for this workspace's mail, and its own mail uses its own", async () => {
    const t = setup();
    t.store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
    t.store.setOrgMember(WS2, "u9", "admin");
    const theirs = await withOAuth(t, { workspaceId: WS2 });
    expect(await sendMail(t.deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(theirs.sends()).toHaveLength(0);
    const w2 = await t.store.ensureWorkspace(WS2, "Other Studio", "u9");
    expect(await sendMail(t.deps, w2, MAIL)).toEqual({ route: "mailbox" });
    expect(theirs.sends()).toHaveLength(1);
    expect(await deliveryAddress(t.deps, WS)).toBeNull();
    expect(await deliveryAddress(t.deps, WS2)).toBe(OAUTH.email);
  });
});

describe("without SIGNROOM_MAIL_KEY: mail keeps going out through Resend", () => {
  it("a verified mailbox or connection is not looked up at all, and nothing claims to be live", async () => {
    const t = setup({ mailbox: mailboxRow(), key: null });
    await withOAuth(t);
    const read = vi.fn();
    const store: Store = { ...t.store, getEmailOAuth: async (id) => (read(), t.store.getEmailOAuth(id)), getMailbox: async (id) => (read(), t.store.getMailbox(id)) };
    const deps = { ...t.deps, store };
    expect(await sendMail(deps, await ws(t.store), MAIL)).toEqual({ route: "securovix" });
    expect(read).not.toHaveBeenCalled();
    expect(t.resend.calls).toHaveLength(1);
    expect(t.transport.sent).toHaveLength(0);
    expect(await deliveryAddress(deps, WS)).toBeNull();
    expect(await billingDelivery(deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: true });
    expect((await t.store.getEmailOAuth(WS))!.status).toBe("verified");
  });
});

describe("before migration 186 is run: everything that worked keeps working", () => {
  /** 184 alone, with the mail key already set in Vercel: the three tables are not there. */
  function without186(t: ReturnType<typeof setup>) {
    const gone = (table: string) => async () => {
      throw new StoreError(`Could not find the table 'public.${table}' in the schema cache`);
    };
    const store: Store = { ...t.store, getMailbox: gone("sr_mailboxes"), markMailbox: gone("sr_mailboxes"), getEmailOAuth: gone("sr_email_oauth"), purgeOAuthStates: gone("sr_email_oauth_states") };
    return { ...t.deps, store };
  }

  it("invoice and agreement emails go out through Resend", async () => {
    const t = setup();
    const deps = without186(t);
    const invoice = await issued(t);
    await billingSend(deps, owner, invoice.id, "send", {}, ORIGIN);
    expect(await sendMail(deps, await ws(t.store), INVITE)).toEqual({ route: "securovix" });
    expect(t.resend.calls).toHaveLength(2);
    expect((await deliveries(t.store)).map((d) => [d.route, d.status])).toEqual([["securovix", "sent"], ["securovix", "sent"]]);
  });

  it("billing/delivery, email-settings and agreement readiness answer as before", async () => {
    const t = setup();
    const deps = without186(t);
    expect(await billingDelivery(deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: true });
    expect(await workspaceAction(deps.store, owner, "email-settings", { senderName: "Acme", senderEmail: "a@acme.test", replyTo: "a@acme.test" }, deps)).toEqual({
      ok: true, mode: "securovix", ready: true, senderName: "Acme", senderEmail: "a@acme.test", replyTo: "a@acme.test",
    });
    expect(await workspaceMailReady(deps, WS)).toBe(true);
    expect(await workspaceMailReady({ ...deps, resendKey: undefined }, WS)).toBe(false);
  });

  it("the scheduled run's clean-up stays quiet about the missing table, and still reports any other failure by name", async () => {
    const t = setup();
    await maintain(without186(t));
    expect(consoleArgs).toEqual([]);
    const broken: Store = { ...t.store, purgeOAuthStates: async () => { throw new StoreError("connection reset"); } };
    await maintain({ ...t.deps, store: broken });
    expect(consoleArgs).toEqual([["[signroom] maintenance failed", "StoreError"]]);
  });

  it("any other failure reading the connection stops the send instead of quietly changing the sender", async () => {
    const t = setup();
    const store: Store = { ...t.store, getEmailOAuth: async () => { throw new StoreError("connection reset"); } };
    await expect(sendMail({ ...t.deps, store }, await ws(t.store), MAIL)).rejects.toBeInstanceOf(StoreError);
    expect(t.resend.calls).toHaveLength(0);
  });
});

describe("the scheduled run removes sign-ins past their ten minutes", () => {
  it("only where own mailboxes are switched on", async () => {
    const state = { digest: "a".repeat(64), browserDigest: "b".repeat(64), workspaceId: WS, userId: "u1", connectionId: "c1", revision: 1, verifierEnc: "v1:x", redirectUri: "https://app.example.com/cb", expires: Date.now() - 1 };
    const t = setup();
    await t.store.insertOAuthState(state);
    await maintain(t.deps);
    expect(t.store.oauthStates()).toHaveLength(0);
    const off = setup({ key: null });
    const purge = vi.fn();
    await maintain({ ...off.deps, store: { ...off.store, purgeOAuthStates: purge } });
    expect(purge).not.toHaveBeenCalled();
  });
});

describe("what the screens are told", () => {
  it("billing/delivery reports the address mail will really go from", async () => {
    expect(await billingDelivery(setup().deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: true });
    expect(await billingDelivery(setup({ resendKey: undefined }).deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: false });
    expect(await billingDelivery(setup({ mailbox: mailboxRow(), resendKey: undefined }).deps, owner)).toEqual({ mode: "live", sender: "you@acme.test", ready: true });
    expect(await billingDelivery(setup({ mailbox: mailboxRow({ verified_at: null }) }).deps, owner)).toMatchObject({ mode: "securovix", sender: FROM });
  });

  it("workspaces/email-settings says live once the workspace has a verified mailbox of its own", async () => {
    const body = { senderName: "Acme", senderEmail: "a@acme.test", replyTo: "a@acme.test" };
    const plain = setup();
    expect(await workspaceAction(plain.store, owner, "email-settings", body, plain.deps)).toMatchObject({ ok: true, mode: "securovix", ready: true });
    const live = setup({ mailbox: mailboxRow(), resendKey: undefined });
    expect(await workspaceAction(live.store, owner, "email-settings", body, live.deps)).toMatchObject({ ok: true, mode: "live", ready: true });
    const g = await google({ status: "authenticated" });
    expect(await workspaceAction(g.store, owner, "email-settings", body, g.deps)).toMatchObject({ mode: "securovix" });
    const noKey = setup({ mailbox: mailboxRow(), key: null });
    expect(await workspaceAction(noKey.store, owner, "email-settings", body, noKey.deps)).toMatchObject({ mode: "securovix", ready: true });
    expect(await workspaceAction(plain.store, owner, "email-settings", body)).toMatchObject({ mode: "securovix", ready: false });
  });

  it("agreement email is ready through a verified connection without RESEND_API_KEY; an unverified one or a missing key is not enough", async () => {
    const t = setup({ resendKey: undefined });
    expect(await workspaceMailReady(t.deps, WS)).toBe(false);
    expect(mailReady(t.deps)).toBe(false);
    await withOAuth(t);
    expect(await workspaceMailReady(t.deps, WS)).toBe(true);
    expect(await workspaceMailReady({ ...t.deps, key: null }, WS)).toBe(false);
    const u = setup({ resendKey: undefined });
    await withOAuth(u, { status: "authenticated" });
    expect(await workspaceMailReady(u.deps, WS)).toBe(false);
    const v = setup({ resendKey: undefined, mailbox: mailboxRow() });
    expect(await workspaceMailReady(v.deps, WS)).toBe(true);
    const n = setup({ resendKey: undefined, jobKey: null });
    await withOAuth(n);
    expect(await workspaceMailReady(n.deps, WS)).toBe(false);
  });
});
