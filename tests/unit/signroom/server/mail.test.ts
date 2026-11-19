// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { billingAction, billingDelivery, billingSend } from "../../../../api/_signroom/billing";
import { canSend, displayName, mailFrom, MAIL_TOOL, sendMail } from "../../../../api/_signroom/mail";
import { mailReady } from "../../../../api/_signroom/jobs";
import { currentWorkspace } from "../../../../api/_signroom/context";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import type { SpendResult } from "../../../../api/_signroom/host/rateLimit";
import { FROM, mailSetup as setup } from "./agreementFixtures";
import { companyClient, OWNER, WS } from "./helpers";

/** One sending route: Resend, from SIGNROOM_MAIL_FROM. Every send is in the delivery log. */

const owner = OWNER;
const ORIGIN = "https://app.example.com";
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

async function ws(store: Store) {
  return (await currentWorkspace(store, owner)).workspace;
}
const MAIL = { to: "pay@bloom.co", subject: "Hello", text: "Body", purpose: "invoice" };

describe("mailFrom", () => {
  it("uses SIGNROOM_MAIL_FROM: a plain address, or the address inside Name <address>", () => {
    expect(mailFrom("Documents@Mail.Example.com", "https://app.example.com")).toBe("documents@mail.example.com");
    expect(mailFrom('  "Acme Docs" <docs@acme.test>  ', null)).toBe("docs@acme.test");
  });

  it("defaults to documents@ the site's own domain, without a leading www.", () => {
    expect(mailFrom(undefined, "https://app.example.com")).toBe("documents@app.example.com");
    expect(mailFrom("", "https://www.taskcalendar.example")).toBe("documents@taskcalendar.example");
    expect(mailFrom("   ", "https://app.example.com/")).toBe("documents@app.example.com");
  });

  it("is null when neither gives a usable address, and never falls back from a bad SIGNROOM_MAIL_FROM", () => {
    expect(mailFrom(undefined, null)).toBeNull();
    expect(mailFrom(undefined, "http://localhost:5173")).toBeNull();
    expect(mailFrom(undefined, "not a url")).toBeNull();
    for (const bad of ["not-an-address", "a@b", "two@x.test, three@x.test", "<a@b.test", "a b@x.test", 'x"y@z.test'])
      expect(mailFrom(bad, "https://app.example.com"), bad).toBeNull();
  });
});

describe("sendMail limits (per workspace)", () => {
  const verdictCounts = (limitBy: Map<string, number>, day: { n: number; limit?: number }) => ({
    spend: async (_sb: unknown, tool: string, key: string, limit: number): Promise<SpendResult> => {
      const k = tool + key;
      const n = (limitBy.get(k) ?? 0) + 1;
      limitBy.set(k, n);
      return n <= limit ? { ok: true } : { ok: false, minutesLeft: 1 };
    },
    peek: async (_sb: unknown, _tool: string, _key: string, limit: number): Promise<SpendResult> => {
      day.limit = limit;
      return day.n < limit ? { ok: true } : { ok: false, minutesLeft: 600 };
    },
  });

  it("refuses the 21st send in a minute, and writes no delivery row for it", async () => {
    const t = setup();
    const seen = new Map<string, number>();
    Object.assign(t.deps, verdictCounts(seen, { n: 0 }));
    const w = await ws(t.store);
    for (let n = 0; n < 20; n++) await sendMail(t.deps, w, MAIL);
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 429, message: "You can send up to 20 emails a minute. Try again in a minute." });
    expect(t.resend.calls).toHaveLength(20);
    expect(await t.store.listDeliveries(w.id, 50)).toHaveLength(20);
    // One bucket per workspace, whoever in it sends.
    expect(MAIL_TOOL).toBe("signroom-mail");
    expect([...seen.keys()]).toEqual([`signroom-mailworkspace:${WS}`]);
  });

  it("an agreement email refused for a limit is a failed delivery row; an invoice email still writes none (Ruling A5)", async () => {
    const t = setup();
    Object.assign(t.deps, verdictCounts(new Map(), { n: 0 }));
    const w = await ws(t.store);
    for (let n = 0; n < 20; n++) await sendMail(t.deps, w, MAIL);
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 429 });
    expect(await t.store.listDeliveries(w.id, 50)).toHaveLength(20);
    const agreementMail = { ...MAIL, purpose: "invite", agreementId: "a1", participantId: "p1" };
    await expect(sendMail(t.deps, w, agreementMail)).rejects.toMatchObject({ status: 429 });
    expect(t.resend.calls).toHaveLength(20);
    const [row] = await t.store.listAgreementDeliveries("a1");
    expect(row).toMatchObject({
      agreementId: "a1",
      participantId: "p1",
      purpose: "invite",
      route: "securovix",
      status: "failed",
      error: "You can send up to 20 emails a minute. Try again in a minute.",
    });
    expect(row).not.toHaveProperty("invoiceId");
  });

  it("an agreement email with no route at all is a failed delivery with the 503 sentence", async () => {
    const t = setup({ resendKey: undefined });
    const w = await ws(t.store);
    await expect(sendMail(t.deps, w, { ...MAIL, purpose: "notice", agreementId: "a1" })).rejects.toMatchObject({ status: 503 });
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 503 });
    const rows = await t.store.listDeliveries(w.id, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agreementId: "a1", status: "failed", route: "securovix", error: "This tool is busy right now. Please try again in a minute." });
  });

  it("refuses the 301st send in a day for an established workspace (300 a day)", async () => {
    const t = setup();
    const day: { n: number; limit?: number } = { n: 300 };
    Object.assign(t.deps, verdictCounts(new Map(), day));
    const w = await t.store.updateWorkspace((await ws(t.store)).id, { created: new Date(Date.now() - 30 * 86400000).toISOString() });
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 429, message: "You can send up to 300 emails a day. Try again tomorrow." });
    expect(day.limit).toBe(300);
    expect(t.resend.calls).toHaveLength(0);
  });

  it("refuses the 101st send in a day for a workspace that started using Signroom 3 days ago (100 a day)", async () => {
    const t = setup();
    const day: { n: number; limit?: number } = { n: 100 };
    Object.assign(t.deps, verdictCounts(new Map(), day));
    const w = await t.store.updateWorkspace((await ws(t.store)).id, { created: new Date(Date.now() - 3 * 86400000).toISOString() });
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({
      status: 429,
      message: "New workspaces can send 100 emails a day for their first week. Try again tomorrow.",
    });
    expect(day.limit).toBe(100);
    expect(t.resend.calls).toHaveLength(0);
  });

  it("a limit store that cannot answer refuses the send (503), sending nothing", async () => {
    const t = setup();
    t.deps.peek = async (): Promise<SpendResult> => ({ ok: false, minutesLeft: 1, unavailable: true });
    const w = await ws(t.store);
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 503 });
    expect(t.resend.calls).toHaveLength(0);
  });
});

describe("sendMail", () => {
  it("goes through Resend from the configured address, with the delivery id as the idempotency key", async () => {
    const t = setup();
    const w = await t.store.updateWorkspace((await ws(t.store)).id, { senderName: 'Acme "Studio" <Ltd>', replyTo: "hello@acme.test" });
    expect(await sendMail(t.deps, w, MAIL)).toEqual({ route: "securovix" });
    expect(t.resend.calls).toHaveLength(1);
    const { url, init } = t.resend.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    // The workspace's name with quotes and brackets removed, then the product, then our own address.
    expect(body.from).toBe(`"Acme Studio Ltd via TaskCalendar" <${FROM}>`);
    expect(body.reply_to).toBe("hello@acme.test");
    expect(body.to).toEqual(["pay@bloom.co"]);
    expect(body).toMatchObject({ subject: "Hello", text: "Body" });
    expect(body.html).toContain("Body");
    expect(JSON.stringify(body)).not.toMatch(/securovix/i);
    const [d] = await t.store.listDeliveries(w.id, 5);
    expect(headers["Idempotency-Key"]).toBe(d.id);
    expect(d).toMatchObject({ route: "securovix", status: "sent", recipient: "pay@bloom.co", subject: "Hello", purpose: "invoice" });
  });

  it("escapes the text in the HTML part and keeps its line breaks", async () => {
    const t = setup();
    const w = await ws(t.store);
    await sendMail(t.deps, w, { ...MAIL, text: "Line <one> & \"two\"\nNext" });
    const body = JSON.parse(String(t.resend.calls[0].init.body));
    expect(body.html).toContain("Line &lt;one&gt; &amp; &quot;two&quot;<br>Next");
    expect(body.text).toBe('Line <one> & "two"\nNext');
  });

  it("gives 503 without RESEND_API_KEY, and without a from address, sending nothing", async () => {
    for (const t of [setup({ resendKey: undefined }), setup({ resendKey: "" }), setup({ from: undefined })]) {
      const w = await ws(t.store);
      await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 503 });
      expect(t.resend.calls).toHaveLength(0);
      expect(canSend(t.deps)).toBe(false);
      expect(mailReady(t.deps)).toBe(false);
    }
  });

  it("records a Resend refusal as failed, with a sentence that names no address", async () => {
    const t = setup();
    t.resend.status = 422;
    const w = await ws(t.store);
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 502, message: "We couldn't send this email. Please try again in a few minutes." });
    const [d] = await t.store.listDeliveries(w.id, 5);
    expect(d).toMatchObject({ status: "failed", error: "We couldn't send this email. Please try again in a few minutes." });
  });

  it("records an unreachable Resend as failed, logging only the error's name", async () => {
    const t = setup();
    t.deps.fetch = (async () => {
      throw new TypeError("fetch failed for pay@bloom.co");
    }) as never;
    const w = await ws(t.store);
    await expect(sendMail(t.deps, w, MAIL)).rejects.toMatchObject({ status: 502 });
    expect((await t.store.listDeliveries(w.id, 5))[0].status).toBe("failed");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("pay@bloom.co");
  });

  it("mailReady needs the route, the job key and the evidence key", () => {
    expect(mailReady(setup().deps)).toBe(true);
    expect(mailReady(setup({ jobKey: null }).deps)).toBe(false);
    expect(mailReady(setup({ evidenceKey: null }).deps)).toBe(false);
  });

  it("displayName cleans a company name for the From header", () => {
    expect(displayName('  A "B" <C>\\ \r\n D  ')).toBe("A B C D");
    expect(displayName("")).toBe("Your supplier");
    expect(Array.from(displayName("x".repeat(200)))).toHaveLength(80);
  });
});

describe("sendMail's sending hook", () => {
  it("is called once, with the route, after the limits and before the Resend call", async () => {
    const t = setup();
    const w = await ws(t.store);
    const seen: [string, number][] = [];
    await sendMail(t.deps, w, MAIL, {
      sending: async (route) => {
        seen.push([route, t.resend.calls.length]);
      },
    });
    expect(seen).toEqual([["securovix", 0]]);
    expect(t.resend.calls).toHaveLength(1);
  });

  it("is never called when a limit refuses", async () => {
    const t = setup();
    t.deps.spend = async (): Promise<SpendResult> => ({ ok: false, minutesLeft: 1 });
    const w = await ws(t.store);
    const sending = vi.fn(async () => undefined);
    await expect(sendMail(t.deps, w, MAIL, { sending })).rejects.toMatchObject({ status: 429 });
    expect(sending).not.toHaveBeenCalled();
  });

  it("sends nothing, and writes no delivery, when it throws", async () => {
    const t = setup();
    const w = await ws(t.store);
    const stop = new Error("held elsewhere");
    await expect(
      sendMail(t.deps, w, { ...MAIL, purpose: "invite", agreementId: "a1" }, {
        sending: async () => {
          throw stop;
        },
      }),
    ).rejects.toBe(stop);
    expect(t.resend.calls).toHaveLength(0);
    expect(await t.store.listDeliveries(w.id, 10)).toHaveLength(0);
  });
});

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
  return { draft: d, invoice: (await billingAction(store, owner, "POST", s.id, "issue", { revision: s.revision })) as Invoice };
}

describe("billingSend", () => {
  it("refuses a Draft", async () => {
    const t = setup();
    const client = await companyClient(t.store, owner);
    const draft = (await billingAction(t.store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
    await expect(billingSend(t.deps, owner, draft.id, "send", {}, ORIGIN)).rejects.toThrow("Issue the invoice before sending it.");
  });

  it("emails a link to the invoice page that never contains the raw code, stores only its digest, and stamps sentAt", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    const out = await billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN + "/");
    expect(out.sentAt).toBeTruthy();
    const sent = JSON.parse(String(t.resend.calls[0].init.body));
    const m = /https:\/\/app\.example\.com\/invoice#billing=([A-Za-z0-9_-]+)/.exec(sent.text);
    expect(m).toBeTruthy();
    expect(sent.text).not.toContain("/documents");
    const raw = m![1];
    const tok = await t.store.findToken(createHash("sha256").update(raw).digest("hex"));
    expect(tok).toMatchObject({ invoiceId: invoice.id, artifactHash: invoice.invoiceHash, email: "pay@bloom.co" });
    expect(await t.store.findToken(raw)).toBeNull();
    expect(JSON.stringify(t.store.dump())).not.toContain(raw);
    expect(sent.subject).toBe(`Invoice ${invoice.number}`);
  });

  it("sends a receipt with the receipt's hash", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    const paid = (await billingAction(t.store, owner, "POST", invoice.id, "payment", {
      revision: invoice.revision,
      amount: "40.00",
      paidOn: day(0),
    })) as Invoice;
    await billingSend(t.deps, owner, paid.id, "send-receipt", { paymentId: paid.payments[0].id }, ORIGIN);
    const sent = JSON.parse(String(t.resend.calls[0].init.body));
    expect(sent.subject).toBe(`Receipt ${paid.payments[0].receiptNumber}`);
    await expect(billingSend(t.deps, owner, paid.id, "send-receipt", { paymentId: "nope" }, ORIGIN)).rejects.toThrow("Receipt not found.");
  });

  it("emails a moved invoice and a moved receipt, binding each link to the document's own hash", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    const { id: _i, payments: _p, events: _e, ...rest } = invoice;
    const moved = await t.store.insertInvoice({ ...rest, number: "OLD-1", invoiceHash: undefined }, { at: new Date().toISOString(), type: "Moved", actor: "system" });
    await t.store.recordPayment(
      moved.id, moved.revision,
      { id: "pay-1", amountMinor: 4000, paidOn: day(0), reference: "", method: "Bank", receiptNumber: "OLD-1-R01", receiptHash: "", recordedAt: new Date().toISOString() },
      "Part paid", { at: new Date().toISOString(), type: "Moved", actor: "system" },
    );
    const rawOf = (n: number) => /#billing=([A-Za-z0-9_-]+)/.exec(JSON.parse(String(t.resend.calls[n].init.body)).text)![1];
    const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");

    await billingSend(t.deps, owner, moved.id, "send", {}, ORIGIN);
    const after = (await t.store.getInvoice(moved.workspaceId, moved.id))!;
    expect(after.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await t.store.findToken(digest(rawOf(0))))?.artifactHash).toBe(after.invoiceHash);

    await billingSend(t.deps, owner, moved.id, "send-receipt", { paymentId: "pay-1" }, ORIGIN);
    const again = (await t.store.getInvoice(moved.workspaceId, moved.id))!;
    const receiptHash = again.payments[0].receiptHash;
    expect(receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receiptHash).not.toBe(again.invoiceHash);
    expect((await t.store.findToken(digest(rawOf(1))))?.artifactHash).toBe(receiptHash);
  });

  it("refuses the 6th send in an hour", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    for (let n = 0; n < 5; n++) await billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN);
    await expect(billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN)).rejects.toMatchObject({ status: 429 });
    expect(t.resend.calls).toHaveLength(5);
  });

  it("revokes the link when the email cannot be sent at all", async () => {
    const t = setup({ resendKey: undefined });
    const { invoice } = await issued(t.store);
    await expect(billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN)).rejects.toMatchObject({ status: 503 });
    const tokens = (t.store.dump() as { tokens: { revoked: boolean }[] }).tokens;
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revoked).toBe(true);
    expect((await t.store.getInvoice(WS, invoice.id))!.sentAt).toBeUndefined();
  });
});

describe("failures in the bookkeeping", () => {
  it("keeps the send and its link valid when the delivery write fails after the email went out", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    t.store.finishDelivery = async () => {
      throw new Error("down");
    };
    const out = await billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN);
    expect(out.sentAt).toBeTruthy();
    const raw = /billing=([A-Za-z0-9_-]+)/.exec(JSON.parse(String(t.resend.calls[0].init.body)).text)![1];
    const tok = await t.store.findToken(createHash("sha256").update(raw).digest("hex"));
    expect(tok?.revoked).toBe(false);
  });

  it("reports the real error, and revokes the token, when the send fails and the failed write also fails", async () => {
    const t = setup();
    const { invoice } = await issued(t.store);
    t.resend.status = 422;
    t.store.finishDelivery = async () => {
      throw new Error("down");
    };
    await expect(billingSend(t.deps, owner, invoice.id, "send", {}, ORIGIN)).rejects.toMatchObject({ status: 502 });
    const raw = /billing=([A-Za-z0-9_-]+)/.exec(JSON.parse(String(t.resend.calls[0].init.body)).text)![1];
    const tok = await t.store.findToken(createHash("sha256").update(raw).digest("hex"));
    expect(tok?.revoked).toBe(true);
  });
});

describe("billingDelivery", () => {
  it("reports the one route, its from address, and whether it is configured", async () => {
    const t = setup();
    expect(await billingDelivery(t.deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: true });
    const off = setup({ resendKey: undefined });
    expect(await billingDelivery(off.deps, owner)).toEqual({ mode: "securovix", sender: FROM, ready: false });
    const none = setup({ from: undefined });
    expect(await billingDelivery(none.deps, owner)).toEqual({ mode: "securovix", sender: "", ready: false });
  });

  it("is refused without a workspace the caller may use", async () => {
    const t = setup();
    await expect(billingDelivery(t.deps, { id: "u9", email: "x@example.com", workspaceId: WS })).rejects.toMatchObject({ status: 403 });
  });
});
