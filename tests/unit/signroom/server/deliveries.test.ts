// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { billingAction, billingSend } from "../../../../api/_signroom/billing";
import { DELIVERY_LOG_LIMIT } from "../../../../api/_signroom/deliveries";
import { route } from "../../../../api/_signroom/router";
import type { MailDeps } from "../../../../api/_signroom/mail";
import type { Agreement, Invoice } from "../../../../api/_signroom/shared/types";
import { supabaseStore } from "../../../../api/_signroom/store";
import { madeDraft, mailSetup, newClient, ORIGIN, OWNER, sent } from "./agreementFixtures";
import { ORG2, withMemberRole, WS, WS2 } from "./helpers";

/** The email log of one document: GET billing/:id/deliveries and GET agreements/:id/deliveries. */
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
type User = typeof OWNER;
type Line = { id: string; recipient: string; subject: string; purpose: string; route?: string; status: string; error?: string; created: string };

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

const call = (deps: MailDeps, user: User | null, path: string, method = "GET") =>
  route({ mail: deps }, { method, path: path.split("/"), query: {}, body: {}, user, origin: ORIGIN });
const lines = async (deps: MailDeps, user: User, path: string) => ((await call(deps, user, path)).json as { deliveries: Line[] }).deliveries;

async function setup() {
  const m = mailSetup();
  withMemberRole(m.store, member.id);
  m.store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Other Studio" });
  m.store.setOrgMember(WS2, other.id, "admin");
  const client = await newClient(m.store);
  return { ...m, client };
}

async function issuedInvoice(deps: MailDeps, clientId: string, user: User = OWNER): Promise<Invoice> {
  const draft = (await billingAction(deps.store, user, "POST", undefined, undefined, { clientId })) as Invoice;
  const saved = (await billingAction(deps.store, user, "POST", draft.id, "save", {
    revision: draft.revision, currency: "GBP", issueDate: draft.issueDate, dueDate: draft.dueDate,
    lines: [{ description: "Consulting", quantity: "1", rate: "100.00" }], taxPercent: "0",
  })) as Invoice;
  return (await billingAction(deps.store, user, "POST", saved.id, "issue", { revision: saved.revision })) as Invoice;
}

describe("GET billing/:id/deliveries", () => {
  it("an invoice email stores the invoice on its delivery row, and the log shows it without ids of other things", async () => {
    const t = await setup();
    const inv = await issuedInvoice(t.deps, t.client.id);
    await billingSend(t.deps, OWNER, inv.id, "send", {}, ORIGIN);
    const stored = (t.store.dump() as { deliveries: { invoiceId?: string }[] }).deliveries;
    expect(stored.map((d) => d.invoiceId)).toEqual([inv.id]);
    const out = await call(t.deps, OWNER, `billing/${inv.id}/deliveries`);
    expect(out.status).toBe(200);
    const [line] = (out.json as { deliveries: Line[] }).deliveries;
    expect(Object.keys(line).sort()).toEqual(["created", "id", "purpose", "recipient", "route", "status", "subject"]);
    expect(line).toMatchObject({ recipient: t.client.email, purpose: "invoice", route: "securovix", status: "sent" });
  });

  it("is newest first and carries a failed send's error", async () => {
    const t = await setup();
    const inv = await issuedInvoice(t.deps, t.client.id);
    await billingSend(t.deps, OWNER, inv.id, "send", {}, ORIGIN);
    t.resend.status = 500;
    await expect(billingSend(t.deps, OWNER, inv.id, "send", {}, ORIGIN)).rejects.toMatchObject({ status: 502 });
    const got = await lines(t.deps, OWNER, `billing/${inv.id}/deliveries`);
    expect(got.map((d) => d.status)).toEqual(["failed", "sent"]);
    expect(got[0].error).toBe("We couldn't send this email. Please try again in a few minutes.");
    expect("error" in got[1]).toBe(false);
  });

  it("lists only this invoice's emails", async () => {
    const t = await setup();
    const a = await issuedInvoice(t.deps, t.client.id);
    const b = await issuedInvoice(t.deps, t.client.id);
    await billingSend(t.deps, OWNER, a.id, "send", {}, ORIGIN);
    expect(await lines(t.deps, OWNER, `billing/${b.id}/deliveries`)).toEqual([]);
    expect(await lines(t.deps, OWNER, `billing/${a.id}/deliveries`)).toHaveLength(1);
  });

  it("gives at most 100", async () => {
    const t = await setup();
    const inv = await issuedInvoice(t.deps, t.client.id);
    for (let n = 0; n < DELIVERY_LOG_LIMIT + 5; n++)
      await t.store.insertDelivery({ workspaceId: WS, invoiceId: inv.id, recipient: "pay@bloom.co", subject: `S${n}`, purpose: "invoice", route: "securovix", status: "sent" });
    const got = await lines(t.deps, OWNER, `billing/${inv.id}/deliveries`);
    expect(DELIVERY_LOG_LIMIT).toBe(100);
    expect(got).toHaveLength(100);
    expect(got[0].subject).toBe("S104");
  });

  it("only for someone who may open the invoice: a Member sees their own, not the Owner's; another workspace and a bad id are 404", async () => {
    const t = await setup();
    const owners = await issuedInvoice(t.deps, t.client.id);
    const members = await issuedInvoice(t.deps, t.client.id, member);
    const notFound = { status: 404, json: { error: "Invoice not found." } };
    expect(await call(t.deps, member, `billing/${owners.id}/deliveries`)).toEqual(notFound);
    expect((await call(t.deps, member, `billing/${members.id}/deliveries`)).status).toBe(200);
    expect((await call(t.deps, OWNER, `billing/${members.id}/deliveries`)).status).toBe(200);
    expect(await call(t.deps, other, `billing/${owners.id}/deliveries`)).toEqual(notFound);
    expect(await call(t.deps, OWNER, "billing/not-an-id/deliveries")).toEqual(notFound);
    expect((await call(t.deps, null, `billing/${owners.id}/deliveries`)).status).toBe(401);
    expect((await call(t.deps, OWNER, `billing/${owners.id}/deliveries`, "POST")).status).toBe(404);
  });
});

describe("GET agreements/:id/deliveries", () => {
  it("lists the agreement's emails newest first, for its sender and for an Owner", async () => {
    const t = await setup();
    const a: Agreement = await sent(t.deps, await madeDraft(t.deps, t.client.id));
    const got = await lines(t.deps, OWNER, `agreements/${a.id}/deliveries`);
    expect(got.length).toBeGreaterThan(0);
    for (const d of got) {
      expect(Object.keys(d).every((k) => ["id", "recipient", "subject", "purpose", "route", "status", "error", "created"].includes(k))).toBe(true);
      expect(d.route).toBe("securovix");
    }
    expect(got.some((d) => d.purpose === "invite")).toBe(true);
    const times = got.map((d) => d.created);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("a Member who is not the sender, another workspace and a bad id are the agreement's own 404", async () => {
    const t = await setup();
    const a = await sent(t.deps, await madeDraft(t.deps, t.client.id));
    const notFound = { status: 404, json: { error: "Agreement not found." } };
    expect(await call(t.deps, member, `agreements/${a.id}/deliveries`)).toEqual(notFound);
    expect(await call(t.deps, other, `agreements/${a.id}/deliveries`)).toEqual(notFound);
    expect(await call(t.deps, OWNER, "agreements/not-an-id/deliveries")).toEqual(notFound);
    expect((await call(t.deps, OWNER, `agreements/${a.id}/deliveries`, "POST")).status).toBe(404);
  });

  it("an agreement in the bin still shows its log", async () => {
    const t = await setup();
    const draft = await madeDraft(t.deps, t.client.id);
    await call(t.deps, OWNER, `agreements/${draft.id}/trash`, "POST");
    expect((await call(t.deps, OWNER, `agreements/${draft.id}/deliveries`)).status).toBe(200);
  });
});

describe("supabaseStore.listDocumentDeliveries", () => {
  function recordingSb(rows: unknown[]) {
    const ops: unknown[][] = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = (...a: unknown[]) => (ops.push([m, ...a]), b);
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
    return { sb: { from: (table: string) => (ops.push(["from", table]), b) } as unknown as SupabaseClient, ops };
  }
  const row = { id: "d1", workspace_id: "w1", invoice_id: "i1", recipient: "a@b.co", subject: "S", purpose: "invoice", route: "mailbox", status: "sent", error: null, created_at: "2026-11-19T10:00:00Z" };

  it("reads one invoice's rows inside the workspace, newest first, capped", async () => {
    const { sb, ops } = recordingSb([row]);
    const got = await supabaseStore(sb).listDocumentDeliveries("w1", { invoiceId: "i1" }, 100);
    expect(got).toEqual([{ id: "d1", workspaceId: "w1", invoiceId: "i1", recipient: "a@b.co", subject: "S", purpose: "invoice", route: "mailbox", status: "sent", created: "2026-11-19T10:00:00Z" }]);
    expect(ops).toEqual([["from", "sr_deliveries"], ["select", "*"], ["eq", "workspace_id", "w1"], ["eq", "invoice_id", "i1"], ["order", "created_at", { ascending: false }], ["limit", 100]]);
  });

  it("reads one agreement's rows by agreement_id", async () => {
    const { sb, ops } = recordingSb([]);
    await supabaseStore(sb).listDocumentDeliveries("w1", { agreementId: "a1" }, 100);
    expect(ops).toContainEqual(["eq", "agreement_id", "a1"]);
    expect(ops).toContainEqual(["eq", "workspace_id", "w1"]);
  });
});
