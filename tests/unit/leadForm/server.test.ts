// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PER_FORM_DAY, PER_SENDER, route, splitName, type LeadFormDeps } from "../../../api/_leadForm/router";
import { EMAIL_MESSAGE, embedCode, FORM_GONE_MESSAGE, NAME_MESSAGE, TOO_LONG_MESSAGE, TOO_MANY_MESSAGE } from "../../../api/_leadForm/shared/types";
import type { LeadFormStore, NewLead, StoredForm } from "../../../api/_leadForm/store";
import { leadFormHandler, MAX_BODY_BYTES, senderHashOf, type LeadFormHandlerDeps } from "../../../api/lead-form";

/**
 * The public web form: what a visitor can see and send, what becomes a lead,
 * and what stops it being abused. Nothing here touches the network.
 */

const ORG = "0b000000-0000-4000-8000-000000000001";
const WS = "0a000000-0000-4000-8000-000000000001";
const FORM = "0f000000-0000-4000-8000-000000000001";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const ADMIN = "0c000000-0000-4000-8000-000000000002";
const SALES = "0c000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-11-21T10:00:00Z");

const form = (over: Partial<StoredForm> = {}): StoredForm => ({
  id: FORM, organizationId: ORG, workspaceId: WS, name: "Contact us", enabled: true, askPhone: true, askCompany: true, askMessage: true,
  heading: "Talk to us", intro: "We answer within a day.", buttonLabel: "Send", thankYou: "Thank you. We will be in touch soon.", source: "Website form", ownerId: SALES, ...over,
});

function world(over: Partial<StoredForm> = {}) {
  const state = {
    form: form(over) as StoredForm | null,
    now: NOW,
    leads: [] as Array<NewLead & { id: string }>,
    companies: [] as Array<{ id: string; name: string }>,
    notes: [] as Array<{ leadId: string; kind: string; description: string }>,
    submissions: [] as Array<{ sender: string; result: string; contactId: string | null; at: string }>,
    notices: [] as Array<{ to: string[]; title: string; message: string; link: string }>,
    existing: new Map<string, { id: string; ownerId: string | null }>(),
  };
  const store: LeadFormStore = {
    form: async (id) => (state.form && id === state.form.id ? state.form : null),
    sentBySender: async (_f, sender, since) => state.submissions.filter((s) => s.sender === sender && s.at >= since).length,
    sentToForm: async (_f, since) => state.submissions.filter((s) => s.at >= since).length,
    recordSubmission: async (_f, sender, result, contactId) => void state.submissions.push({ sender, result, contactId, at: state.now.toISOString() }),
    leadByEmail: async (_ws, email) => state.existing.get(email) ?? state.leads.filter((l) => l.email === email).map((l) => ({ id: l.id, ownerId: l.ownerId }))[0] ?? null,
    companyByName: async (_o, _w, name) => {
      const found = state.companies.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      const made = { id: `company-${state.companies.length + 1}`, name };
      state.companies.push(made);
      return made.id;
    },
    insertLead: async (lead) => {
      const id = `lead-${state.leads.length + 1}`;
      state.leads.push({ ...lead, id });
      return id;
    },
    note: async (lead, kind, description) => void state.notes.push({ leadId: lead.id, kind, description }),
    admins: async () => [OWNER, ADMIN],
    notify: async (to, title, message, link) => void state.notices.push({ to, title, message, link }),
  };
  const deps: LeadFormDeps = { store, now: () => state.now };
  const send = (body: Record<string, unknown>, sender = "visitor-1") => route(deps, { method: "POST", formId: FORM, body, senderHash: sender });
  const show = (id = FORM) => route(deps, { method: "GET", formId: id, body: {}, senderHash: "visitor-1" });
  return { state, deps, send, show };
}

const ELENA = { name: "  Elena   Maria Rossi ", email: " Elena@Northwind.Example ", phone: "020 7946 0958", company: "Northwind Studio", message: "We need a new website.\r\nCan you call on Friday?" };

describe("web form: what a visitor is shown", () => {
  it("hands out the form's wording and questions, and nothing about who owns it", async () => {
    const w = world();
    const out = await w.show();
    expect(out).toEqual({
      status: 200,
      json: { heading: "Talk to us", intro: "We answer within a day.", askPhone: true, askCompany: true, askMessage: true, buttonLabel: "Send", thankYou: "Thank you. We will be in touch soon." },
    });
    expect(JSON.stringify(out)).not.toContain(ORG);
    expect(JSON.stringify(out)).not.toContain(SALES);
  });

  it("gives the same answer for a form that is switched off, unknown or not an id", async () => {
    const gone = { status: 404, json: { error: FORM_GONE_MESSAGE } };
    expect(await world({ enabled: false }).show()).toEqual(gone);
    expect(await world().show("0f000000-0000-4000-8000-000000000099")).toEqual(gone);
    expect(await world().show("'; drop table")).toEqual(gone);
    expect(await world({ enabled: false }).send(ELENA)).toEqual(gone);
  });
});

describe("web form: a submission becomes a lead", () => {
  it("adds the lead to the form's workspace, with its company, its source and its owner", async () => {
    const w = world();
    expect(await w.send(ELENA)).toEqual({ status: 200, json: { ok: true, thankYou: "Thank you. We will be in touch soon." } });
    expect(w.state.leads).toEqual([
      { id: "lead-1", organizationId: ORG, workspaceId: WS, ownerId: SALES, firstName: "Elena", lastName: "Maria Rossi", email: "elena@northwind.example", phone: "020 7946 0958", companyId: "company-1", source: "Website form" },
    ]);
    expect(w.state.companies).toEqual([{ id: "company-1", name: "Northwind Studio" }]);
    expect(w.state.notes).toEqual([
      { leadId: "lead-1", kind: "contact_created", description: "Came in through the form “Contact us”." },
      { leadId: "lead-1", kind: "note", description: "Wrote in the form:\nWe need a new website.\nCan you call on Friday?" },
    ]);
    expect(w.state.submissions).toMatchObject([{ result: "lead", contactId: "lead-1" }]);
    // The person the lead is given to hears about it.
    expect(w.state.notices).toEqual([{ to: [SALES], title: "New lead from your form", message: "Elena Maria Rossi (elena@northwind.example) filled in “Contact us”.", link: "/crm/contacts/lead-1" }]);
  });

  it("tells the owner and admins when the form gives its leads to nobody", async () => {
    const w = world({ ownerId: null });
    await w.send(ELENA);
    expect(w.state.leads[0].ownerId).toBeNull();
    expect(w.state.notices[0].to).toEqual([OWNER, ADMIN]);
  });

  it("keeps only the answers the form asks for", async () => {
    const w = world({ askPhone: false, askCompany: false, askMessage: false });
    await w.send(ELENA);
    expect(w.state.leads[0]).toMatchObject({ phone: null, companyId: null });
    expect(w.state.companies).toEqual([]);
    expect(w.state.notes.map((n) => n.kind)).toEqual(["contact_created"]);
  });

  it("does not add the same person twice: it writes on the lead that is already there", async () => {
    const w = world();
    w.state.existing.set("elena@northwind.example", { id: "lead-old", ownerId: OWNER });
    expect((await w.send(ELENA)).status).toBe(200);
    expect(w.state.leads).toEqual([]);
    expect(w.state.notes).toEqual([{ leadId: "lead-old", kind: "note", description: "Sent the form “Contact us” again:\nWe need a new website.\nCan you call on Friday?" }]);
    expect(w.state.submissions).toMatchObject([{ result: "again", contactId: "lead-old" }]);
    // The lead's own owner is told, not the form's.
    expect(w.state.notices).toMatchObject([{ to: [OWNER], title: "Elena Maria Rossi wrote again", link: "/crm/contacts/lead-old" }]);
  });

  it("splits a name into first and last", () => {
    expect(splitName("Elena Maria Rossi")).toEqual({ firstName: "Elena", lastName: "Maria Rossi" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
  });
});

describe("web form: what stops it being abused", () => {
  it("asks for a name and a real email address, and refuses answers that are too long", async () => {
    const w = world();
    expect(await w.send({ ...ELENA, name: "   " })).toEqual({ status: 400, json: { error: NAME_MESSAGE } });
    for (const email of ["", "elena", "elena@northwind", "a b@c.de", `${"x".repeat(200)}@northwind.example`]) {
      expect(await w.send({ ...ELENA, email }), email).toEqual({ status: 400, json: { error: EMAIL_MESSAGE } });
    }
    expect(await w.send({ ...ELENA, message: "x".repeat(2001) })).toEqual({ status: 400, json: { error: TOO_LONG_MESSAGE } });
    expect(await w.send({ ...ELENA, name: "x".repeat(121) })).toEqual({ status: 400, json: { error: TOO_LONG_MESSAGE } });
    expect(w.state.leads).toEqual([]);
    expect(w.state.submissions).toEqual([]);
  });

  it("tells a robot all went well and keeps nothing", async () => {
    const w = world();
    expect(await w.send({ ...ELENA, website: "https://spam.example" })).toEqual({ status: 200, json: { ok: true, thankYou: "Thank you. We will be in touch soon." } });
    expect(w.state.leads).toEqual([]);
    expect(w.state.notices).toEqual([]);
    expect(w.state.submissions).toEqual([]);
  });

  it("lets one sender send a form only a few times in ten minutes", async () => {
    const w = world();
    for (let i = 0; i < PER_SENDER; i += 1) expect((await w.send({ ...ELENA, email: `person${i}@northwind.example` })).status).toBe(200);
    expect(await w.send({ ...ELENA, email: "one-more@northwind.example" })).toEqual({ status: 429, json: { error: TOO_MANY_MESSAGE } });
    expect(w.state.leads).toHaveLength(PER_SENDER);
    // Somebody else is not held back by it, and the sender may write again later.
    expect((await w.send({ ...ELENA, email: "other@harbour.example" }, "visitor-2")).status).toBe(200);
    w.state.now = new Date(NOW.getTime() + 11 * 60_000);
    expect((await w.send({ ...ELENA, email: "later@northwind.example" })).status).toBe(200);
  });

  it("stops a form that is being flooded from many places at once", async () => {
    const w = world();
    for (let i = 0; i < PER_FORM_DAY; i += 1) w.state.submissions.push({ sender: `robot-${i}`, result: "lead", contactId: null, at: NOW.toISOString() });
    expect(await w.send(ELENA, "a-new-sender")).toEqual({ status: 429, json: { error: TOO_MANY_MESSAGE } });
    expect(w.state.leads).toEqual([]);
  });

  it("answers nothing but showing and sending", async () => {
    const w = world();
    expect((await route(w.deps, { method: "DELETE", formId: FORM, body: {}, senderHash: "x" })).status).toBe(405);
  });
});

describe("web form: the way in", () => {
  type Res = { statusCode: number; body: unknown; headers: Record<string, string>; ended: boolean; status(c: number): Res; json(b: unknown): Res; setHeader(k: string, v: string): Res; end(): Res };
  const res = (): Res => {
    const r: Res = { statusCode: 200, body: undefined, headers: {}, ended: false, status: (c) => ((r.statusCode = c), r), json: (b) => ((r.body = b), r), setHeader: (k, v) => ((r.headers[k.toLowerCase()] = v), r), end: () => ((r.ended = true), r) };
    return r;
  };
  const deps = (over: Partial<LeadFormHandlerDeps> = {}): LeadFormHandlerDeps => ({ route: vi.fn(async () => ({ status: 200, json: { ok: true } })), build: () => ({}) as LeadFormDeps, ...over });
  const req = (over: Record<string, unknown> = {}) => ({ method: "POST", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", origin: "https://their-website.example" }, query: { id: FORM }, body: { name: "Elena" }, ...over }) as never;

  it("answers any website, needs no sign-in, and never keeps the visitor's address", async () => {
    const d = deps();
    const out = res();
    await leadFormHandler(d)(req(), out as never);
    expect(out.body).toEqual({ ok: true });
    expect(out.headers["access-control-allow-origin"]).toBe("*");
    expect(out.headers["cache-control"]).toBe("no-store");
    const sent = (d.route as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(sent).toMatchObject({ method: "POST", formId: FORM, body: { name: "Elena" } });
    expect(sent.senderHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain("203.0.113.7");
    // The same visitor gets a different fingerprint on another form.
    expect(senderHashOf(req(), FORM)).toBe(sent.senderHash);
    expect(senderHashOf(req(), "another-form")).not.toBe(sent.senderHash);
  });

  it("reads a plain HTML form as well as JSON, and answers the browser's permission check", async () => {
    const d = deps();
    await leadFormHandler(d)(req({ body: "name=Elena+Rossi&email=elena%40northwind.example" }), res() as never);
    expect((d.route as ReturnType<typeof vi.fn>).mock.calls[0][1].body).toEqual({ name: "Elena Rossi", email: "elena@northwind.example" });
    const check = res();
    await leadFormHandler(deps())(req({ method: "OPTIONS" }), check as never);
    expect([check.statusCode, check.ended]).toEqual([204, true]);
  });

  it("refuses an oversized body and says nothing useful when the server breaks", async () => {
    const big = res();
    const d = deps();
    await leadFormHandler(d)(req({ headers: { "content-length": String(MAX_BODY_BYTES + 1) } }), big as never);
    expect(big.statusCode).toBe(413);
    expect(d.route).not.toHaveBeenCalled();
    const broken = res();
    await leadFormHandler(deps({ route: vi.fn(async () => { throw new Error("relation crm_contacts: elena@northwind.example"); }) }))(req(), broken as never);
    expect(broken.statusCode).toBe(500);
    expect(JSON.stringify(broken.body)).not.toContain("elena");
  });
});

describe("web form: the code to paste", () => {
  it("is an iframe of the form's own page", () => {
    expect(embedCode("https://app.example.com", FORM)).toBe(
      `<iframe src="https://app.example.com/f/${FORM}" title="Contact form" style="width:100%;max-width:560px;height:640px;border:0" loading="lazy"></iframe>`,
    );
  });
});

describe("migration 192", () => {
  const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/192_crm_lead_forms.sql"), "utf8");
  const code = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const flat = code.replace(/\s+/g, " ");

  it("adds its two tables, can be run twice, and keeps the public out", () => {
    expect([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(["crm_lead_forms", "crm_lead_form_submissions"]);
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect((flat.match(/drop policy if exists/g) ?? []).length).toBe((flat.match(/create policy/g) ?? []).length);
    expect(flat).toContain("revoke all on public.crm_lead_forms from public, anon");
    expect(flat).toContain("revoke all on public.crm_lead_form_submissions from public, anon, authenticated");
    expect(raw.toLowerCase()).toContain("safe to run more than once");
  });

  it("gives the forms the CRM's own access rule and the submissions none", () => {
    expect(flat).toContain("using (public.can_access_crm_scope(organization_id, workspace_id))");
    expect(flat).toContain("and not public.is_org_viewer(organization_id)");
    expect(flat).not.toMatch(/create policy "[^"]*" on public\.crm_lead_form_submissions/);
  });

  it("has a column for everything the server reads and writes", () => {
    const store = readFileSync(resolve(process.cwd(), "api/_leadForm/store.ts"), "utf8");
    for (const col of ["organization_id", "workspace_id", "name", "enabled", "ask_phone", "ask_company", "ask_message", "heading", "intro", "button_label", "thank_you", "source", "owner_id", "form_id", "contact_id", "sender_hash", "result"]) {
      expect(code, col).toMatch(new RegExp(`\\n\\s+${col} `));
      expect(store, col).toContain(col);
    }
  });
});
