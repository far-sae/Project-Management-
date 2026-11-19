// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingAction, billingArtifact, billingSend, sha } from "../../../../api/_signroom/billing";
import { billingGuestAction, billingGuestArtifact } from "../../../../api/_signroom/guest";
import type { MailDeps } from "../../../../api/_signroom/mail";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { companyClient, seededStore, WS } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const ORIGIN = "https://app.example.com";
const EXPIRED = "This invoice or receipt link is expired or unavailable.";
const NO_SESSION = "Verify the invited email to open this financial document.";
const SUBJECT = "Your invoice verification code";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Sent = { text: string; subject: string };
function setup() {
  const store = seededStore(owner);
  const resend: { bodies: Sent[] } = { bodies: [] };
  const deps: MailDeps = {
    store,
    sb: {} as never,
    fetch: (async (_u: string, init: RequestInit) => {
      resend.bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as never,
    resendKey: "re_test",
    from: "documents@app.example.com",
    spend: async () => ({ ok: true }),
    peek: async () => ({ ok: true }),
  };
  return { store, deps, resend };
}

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function issued(store: Store) {
  const client = await companyClient(store, owner);
  const d = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
  const s = (await billingAction(store, owner, "POST", d.id, "save", {
    revision: d.revision,
    currency: "GBP",
    issueDate: d.issueDate,
    dueDate: day(30),
    lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }],
    taxPercent: "0",
  })) as Invoice;
  return (await billingAction(store, owner, "POST", s.id, "issue", { revision: s.revision })) as Invoice;
}
const last = (r: { bodies: Sent[] }) => r.bodies[r.bodies.length - 1].text;
const linkOf = (r: { bodies: Sent[] }) => /#billing=([A-Za-z0-9_-]+)/.exec(last(r))![1];
const codeOf = (r: { bodies: Sent[] }) => /code is (\d{6})\./.exec(last(r))![1];
const wrongCode = (c: string) => (c === "123456" ? "654321" : "123456");

async function linked() {
  const t = setup();
  const invoice = await issued(t.store);
  await billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN);
  return { ...t, invoice, access: linkOf(t.resend) };
}
type Linked = Awaited<ReturnType<typeof linked>>;
const voidIt = (t: Linked) => billingAction(t.store, owner, "POST", t.invoice.id, "void", { revision: t.invoice.revision });

describe("billingGuestAction", () => {
  it("intro returns the company name", async () => {
    const t = await linked();
    const out = await billingGuestAction(t.deps, "intro", { access: t.access });
    expect(out).toMatchObject({ ok: true, sender: t.invoice.branding?.companyName });
  });

  it("refuses an unknown, expired or voided link with 410", async () => {
    const t = await linked();
    await expect(billingGuestAction(t.deps, "intro", { access: "nope" })).rejects.toMatchObject({ status: 410, message: EXPIRED });
    await expect(billingGuestAction(t.deps, "intro", {})).rejects.toMatchObject({ status: 410 });
    const now = Date.now();
    vi.setSystemTime(now + 8 * 86400000);
    await expect(billingGuestAction(t.deps, "intro", { access: t.access })).rejects.toMatchObject({ status: 410 });
    vi.setSystemTime(now);
    await voidIt(t);
    await expect(billingGuestAction(t.deps, "intro", { access: t.access })).rejects.toMatchObject({ status: 410, message: EXPIRED });
  });

  it("emails a 6-digit code, stores only its digest, and verify returns a session", async () => {
    const t = await linked();
    expect(await billingGuestAction(t.deps, "code", { access: t.access })).toEqual({ ok: true });
    expect(t.resend.bodies[t.resend.bodies.length - 1].subject).toBe(SUBJECT);
    const code = codeOf(t.resend);
    const tok = (await t.store.findToken(sha(t.access)))!;
    expect(tok.codeDigest).toBe(sha(code));
    const out = (await billingGuestAction(t.deps, "verify", { access: t.access, code })) as {
      ok: true;
      session: { raw: string; expires: number };
    };
    expect(out.ok).toBe(true);
    expect(out.session.raw.length).toBeGreaterThanOrEqual(43);
    expect(out.session.expires).toBe(Date.now() + 30 * 60000);
    expect(await t.store.findSession(sha(out.session.raw))).toMatchObject({ kind: "billing", invoiceId: t.invoice.id });
    // the code is single use
    await expect(billingGuestAction(t.deps, "verify", { access: t.access, code })).rejects.toThrow("Code expired or attempt limit reached.");
  });

  it("refuses a second code within 60 seconds with 429, and the 4th in an hour", async () => {
    const t = await linked();
    await billingGuestAction(t.deps, "code", { access: t.access });
    await expect(billingGuestAction(t.deps, "code", { access: t.access })).rejects.toMatchObject({
      status: 429,
      message: "Wait one minute before requesting another code.",
    });
    vi.setSystemTime(Date.now() + 61000);
    await billingGuestAction(t.deps, "code", { access: t.access });
    vi.setSystemTime(Date.now() + 61000);
    await billingGuestAction(t.deps, "code", { access: t.access });
    vi.setSystemTime(Date.now() + 61000);
    await expect(billingGuestAction(t.deps, "code", { access: t.access })).rejects.toMatchObject({
      status: 429,
      message: "Too many requests. Please try again later.",
    });
    expect(t.resend.bodies.filter((b) => b.subject === SUBJECT)).toHaveLength(3);
  });

  it("gives 403 for a wrong code and refuses everything after 5 wrong ones", async () => {
    const t = await linked();
    await billingGuestAction(t.deps, "code", { access: t.access });
    const code = codeOf(t.resend);
    expect(await billingGuestAction(t.deps, "verify", { access: t.access, code: wrongCode(code) })).toEqual({
      error: "Incorrect verification code.",
      status: 403,
    });
    for (let n = 0; n < 4; n++) await billingGuestAction(t.deps, "verify", { access: t.access, code: wrongCode(code) });
    await expect(billingGuestAction(t.deps, "verify", { access: t.access, code })).rejects.toMatchObject({
      status: 403,
      message: "Code expired or attempt limit reached.",
    });
  });

  it("refuses verify before any code was requested, and a code older than 10 minutes", async () => {
    const t = await linked();
    await expect(billingGuestAction(t.deps, "verify", { access: t.access, code: "123456" })).rejects.toThrow(
      "Code expired or attempt limit reached.",
    );
    await billingGuestAction(t.deps, "code", { access: t.access });
    const code = codeOf(t.resend);
    vi.setSystemTime(Date.now() + 10 * 60000 + 1000);
    await expect(billingGuestAction(t.deps, "verify", { access: t.access, code })).rejects.toThrow("Code expired or attempt limit reached.");
  });

  it("racing wrong verifies never get more than 5 comparisons", async () => {
    const t = await linked();
    await billingGuestAction(t.deps, "code", { access: t.access });
    const code = codeOf(t.resend);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => billingGuestAction(t.deps, "verify", { access: t.access, code: wrongCode(code) })),
    );
    const compared = results.filter((r) => r.status === "fulfilled").length;
    expect(compared).toBeLessThanOrEqual(5);
  });

  it("leaves no usable code behind when the mail fails", async () => {
    const t = await linked();
    t.deps.fetch = (async () => new Response("{}", { status: 500 })) as never;
    await expect(billingGuestAction(t.deps, "code", { access: t.access })).rejects.toMatchObject({ status: 502 });
    const tok = (await t.store.findToken(sha(t.access)))!;
    expect(tok.codeExpires ?? 0).toBe(0);
    expect(tok.codeSent ?? 0).toBe(0);
  });
});

describe("billingGuestArtifact", () => {
  async function session(t: Linked) {
    await billingGuestAction(t.deps, "code", { access: t.access });
    const out = (await billingGuestAction(t.deps, "verify", { access: t.access, code: codeOf(t.resend) })) as { session: { raw: string } };
    return out.session.raw;
  }

  it("gives 401 with no or an unknown session", async () => {
    const t = await linked();
    await expect(billingGuestArtifact(t.deps, undefined)).rejects.toMatchObject({ status: 401, message: NO_SESSION });
    await expect(billingGuestArtifact(t.deps, "nope")).rejects.toMatchObject({ status: 401 });
  });

  it("returns the invoice PDF named by its number", async () => {
    const t = await linked();
    const out = await billingGuestArtifact(t.deps, await session(t));
    expect(out.filename).toBe(`${t.invoice.number}.pdf`);
    expect(Buffer.from(out.bytes)).toEqual(Buffer.from(await billingArtifact(t.store, owner, t.invoice.id)));
  });

  it("returns the receipt's bytes when the link is for a receipt", async () => {
    const t = setup();
    const invoice = await issued(t.store);
    const paid = (await billingAction(t.store, owner, "POST", invoice.id, "payment", {
      revision: invoice.revision,
      amount: "40.00",
      paidOn: day(0),
    })) as Invoice;
    const pid = paid.payments[0].id;
    await billingSend(t.deps, owner, paid.id, "send-receipt", { paymentId: pid }, ORIGIN);
    const access = linkOf(t.resend);
    await billingGuestAction(t.deps, "code", { access });
    const v = (await billingGuestAction(t.deps, "verify", { access, code: codeOf(t.resend) })) as { session: { raw: string } };
    const out = await billingGuestArtifact(t.deps, v.session.raw);
    expect(Buffer.from(out.bytes)).toEqual(Buffer.from(await billingArtifact(t.store, owner, paid.id, pid)));
  });

  it("gives 401 once the session expires or the invoice is voided", async () => {
    const t = await linked();
    const raw = await session(t);
    const now = Date.now();
    vi.setSystemTime(now + 31 * 60000);
    await expect(billingGuestArtifact(t.deps, raw)).rejects.toMatchObject({ status: 401, message: NO_SESSION });
    vi.setSystemTime(now);
    await voidIt(t);
    await expect(billingGuestArtifact(t.deps, raw)).rejects.toMatchObject({ status: 401, message: NO_SESSION });
  });
});
