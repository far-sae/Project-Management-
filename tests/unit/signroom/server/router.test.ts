// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../../api/_signroom/errors";
import * as guest from "../../../../api/_signroom/guest";
import * as templates from "../../../../api/_signroom/templates";
import * as agreements from "../../../../api/_signroom/agreements";
import * as agreementDocument from "../../../../api/_signroom/agreementDocument";
import * as agreementSend from "../../../../api/_signroom/agreementSend";
import * as signGuest from "../../../../api/_signroom/signGuest";
import * as retention from "../../../../api/_signroom/retention";
import * as clientAccounts from "../../../../api/_signroom/clientAccounts";
import * as worker from "../../../../api/_signroom/worker";
import * as workspace from "../../../../api/_signroom/workspace";
import { route, type RouteDeps } from "../../../../api/_signroom/router";
import { SIGN_IN_MESSAGE } from "../../../../api/_signroom/host/auth";
import { companyClient, seededStore, WS } from "./helpers";

const user = { id: "u1", email: "owner@example.com", workspaceId: WS };
const ORIGIN = "https://app.example.com";

function deps(store = seededStore(user)): RouteDeps {
  return { mail: { store } as never };
}
const req = (method: string, path: string, extra: Record<string, unknown> = {}) =>
  ({
    method,
    path: path.split("/").filter(Boolean),
    query: {},
    body: {},
    user: user as typeof user | null,
    origin: ORIGIN,
    ...extra,
  }) as never;

vi.mock("../../../../api/_signroom/guest", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/guest")>();
  return { ...real, billingGuestAction: vi.fn(real.billingGuestAction) };
});
vi.mock("../../../../api/_signroom/templates", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/templates")>();
  return { ...real, uploadTemplate: vi.fn(real.uploadTemplate), templateBytes: vi.fn(real.templateBytes) };
});

vi.mock("../../../../api/_signroom/agreements", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/agreements")>();
  return {
    ...real,
    listAgreements: vi.fn(real.listAgreements),
    createAgreement: vi.fn(real.createAgreement),
    getAgreement: vi.fn(real.getAgreement),
    agreementAction: vi.fn(real.agreementAction),
    agreementArtifactUrl: vi.fn(real.agreementArtifactUrl),
    listTemplates: vi.fn(real.listTemplates),
  };
});
vi.mock("../../../../api/_signroom/agreementDocument", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/agreementDocument")>();
  return {
    ...real,
    prepareAgreement: vi.fn(real.prepareAgreement),
    uploadUrl: vi.fn(real.uploadUrl),
    finishUpload: vi.fn(real.finishUpload),
  };
});

vi.mock("../../../../api/_signroom/agreementSend", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/agreementSend")>();
  return {
    ...real,
    sendAgreement: vi.fn(real.sendAgreement),
    cancelAgreement: vi.fn(real.cancelAgreement),
    resendInvitations: vi.fn(real.resendInvitations),
    signFirst: vi.fn(real.signFirst),
    releaseFirst: vi.fn(real.releaseFirst),
  };
});

vi.mock("../../../../api/_signroom/signGuest", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/signGuest")>();
  return {
    ...real,
    agreementGuestAction: vi.fn(real.agreementGuestAction),
    agreementGuestArtifactUrl: vi.fn(real.agreementGuestArtifactUrl),
    agreementGuestExport: vi.fn(real.agreementGuestExport),
  };
});

vi.mock("../../../../api/_signroom/retention", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/retention")>();
  return { ...real, exportEvidence: vi.fn(real.exportEvidence), scheduleDeletion: vi.fn(real.scheduleDeletion) };
});

vi.mock("../../../../api/_signroom/clientAccounts", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/clientAccounts")>();
  return { ...real, clientAccount: vi.fn(real.clientAccount) };
});

vi.mock("../../../../api/_signroom/workspace", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/workspace")>();
  return { ...real, workspaceAction: vi.fn(real.workspaceAction) };
});

vi.mock("../../../../api/_signroom/worker", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/worker")>();
  return { ...real, runOps: vi.fn(real.runOps) };
});

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

describe("signroom router: malformed ids", () => {
  // A store that, like Postgres, fails on an id that is not a UUID.
  function strict() {
    const store = seededStore(user);
    const guard = (id: string) => {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("invalid input syntax for type uuid");
    };
    return {
      ...store,
      getInvoice: async (w: string, id: string) => (guard(id), store.getInvoice(w, id)),
      getClient: async (w: string, id: string) => (guard(id), store.getClient(w, id)),
      getAgreement: async (w: string, id: string) => (guard(id), store.getAgreement(w, id)),
      getAgreementTemplate: async (w: string, id: string) => (guard(id), store.getAgreementTemplate(w, id)),
    } as typeof store;
  }

  it("answers 404 with the usual sentences, not a 500", async () => {
    const d = deps(strict());
    expect(await route(d, req("GET", "billing/not-an-id"))).toMatchObject({ status: 404, json: { error: "Invoice not found." } });
    expect(await route(d, req("POST", "billing/not-an-id/send"))).toMatchObject({ status: 404 });
    expect(await route(d, req("PATCH", "clients/not-an-id", { body: { name: "x" } }))).toMatchObject({ status: 404, json: { error: "Client not found." } });
    expect(await route(d, req("DELETE", "clients/not-an-id"))).toMatchObject({ status: 404, json: { error: "Client not found." } });
    expect(await route(d, req("GET", "agreements/not-an-id"))).toEqual({ status: 404, json: { error: "Agreement not found." } });
    expect(await route(d, req("POST", "agreements/not-an-id/save"))).toEqual({ status: 404, json: { error: "Agreement not found." } });
    expect(await route(d, req("GET", "agreements/not-an-id/artifact-url"))).toEqual({ status: 404, json: { error: "Agreement not found." } });
    expect(await route(d, req("POST", "billing", { body: { clientId: "not-an-id" } }))).toMatchObject({
      status: 400,
      json: { error: "Choose an existing client." },
    });
  });
});

describe("signroom router: downloads", () => {
  it("names a receipt by its own number and an invoice by the invoice number", async () => {
    const d = deps();
    const c = await companyClient(d.mail.store, user, "Bloom", "a@b.co");
    const i = (await route(d, req("POST", "billing", { body: { clientId: c.id } }))).json as { id: string; revision: number; issueDate: string; dueDate: string; number: string };
    const saved = (
      await route(d, req("POST", `billing/${i.id}/save`, { body: { revision: i.revision, currency: "GBP", issueDate: i.issueDate, dueDate: i.dueDate, lines: [{ description: "Work", quantity: "1", rate: "100.00" }], taxPercent: "0" } }))
    ).json as { revision: number };
    const issued = (await route(d, req("POST", `billing/${i.id}/issue`, { body: { revision: saved.revision } }))).json as { revision: number };
    const paid = (await route(d, req("POST", `billing/${i.id}/payment`, { body: { revision: issued.revision, amount: "40.00", paidOn: "2026-01-01" } }))).json as {
      payments: { id: string; receiptNumber: string }[];
    };
    const inv = await route(d, req("GET", `billing/${i.id}/artifact`));
    expect(inv.pdf?.filename).toBe(`${i.number}.pdf`);
    const rec = await route(d, req("GET", `billing/${i.id}/artifact`, { query: { payment: paid.payments[0].id } }));
    expect(rec.pdf?.filename).toBe(`${paid.payments[0].receiptNumber}.pdf`);
    expect(paid.payments[0].receiptNumber).not.toBe(i.number);
  });
});

describe("signroom router", () => {
  it("every route but billing-guest needs a user", async () => {
    for (const [m, p] of [["GET", "clients"], ["GET", "session"], ["GET", "billing"], ["GET", "agreements"], ["POST", "clients/from-company"], ["POST", "workspaces/branding"]]) {
      const r = await route(deps(), req(m, p, { user: null }));
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: SIGN_IN_MESSAGE });
    }
  });

  it("billing-guest/intro works without a user (an unknown link is the link's own 410)", async () => {
    const r = await route(deps(), req("POST", "billing-guest/intro", { user: null, body: { access: "nope" } }));
    expect(r.status).toBe(410);
  });

  it("an unknown path or method is 404 Not found.", async () => {
    for (const [m, p] of [["GET", "nothing"], ["GET", ""], ["DELETE", "session"], ["GET", "billing/x/explode"], ["POST", "billing/x/preview"]]) {
      const r = await route(deps(), req(m, p));
      expect(r).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });

  it("GET session and GET clients reach their modules", async () => {
    const s = await route(deps(), req("GET", "session"));
    expect(s.status).toBe(200);
    expect((s.json as { user: { id: string } }).user.id).toBe("u1");
    const c = await route(deps(), req("GET", "clients", { query: { includeDeleted: "1" } }));
    expect(c).toEqual({ status: 200, json: [] });
  });

  it("includeDeleted is a real boolean: only 1 or true", async () => {
    const store = seededStore(user);
    const spy = vi.spyOn(store, "listClients");
    const d = deps(store);
    for (const [v, want] of [["1", true], ["true", true], ["0", false], ["false", false], ["yes", false], [undefined, false]] as const) {
      await route(d, req("GET", "clients", { query: v === undefined ? {} : { includeDeleted: v } }));
      expect(spy).toHaveBeenLastCalledWith(expect.any(String), want);
    }
  });

  it("billing/delivery matches before billing/:id", async () => {
    const r = await route(deps(), req("GET", "billing/delivery"));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mode: "securovix" });
  });

  it("an AppError keeps its status and sentence", async () => {
    const store = seededStore(user);
    store.workspaceAccess = async () => {
      throw new AppError("Already done.", 409);
    };
    const r = await route(deps(store), req("GET", "clients"));
    expect(r).toEqual({ status: 409, json: { error: "Already done." } });
  });

  it("any other error is a plain 500, logging only the error name", async () => {
    const store = seededStore(user);
    store.workspaceAccess = async () => {
      throw new TypeError("secret owner@example.com detail");
    };
    const r = await route(deps(store), req("GET", "clients"));
    expect(r).toEqual({ status: 500, json: { error: "Something went wrong. Please try again." } });
    const seen = JSON.stringify(logged.mock.calls);
    expect(seen).toContain("TypeError");
    expect(seen).not.toContain("secret");
    expect(seen).not.toContain("owner@example.com");
  });

  it("a wrong code is its 403 sentence; a right code sets the guest session and keeps it out of the JSON", async () => {
    const spy = vi.mocked(guest.billingGuestAction);
    spy.mockResolvedValueOnce({ error: "Incorrect verification code.", status: 403 });
    const bad = await route(deps(), req("POST", "billing-guest/verify", { user: null }));
    expect(bad).toEqual({ status: 403, json: { error: "Incorrect verification code." } });
    spy.mockResolvedValueOnce({ ok: true, session: { raw: "RAW", expires: 123 } });
    const ok = await route(deps(), req("POST", "billing-guest/verify", { user: null }));
    expect(ok.status).toBe(200);
    expect(ok.setGuestSession).toEqual({ raw: "RAW", expires: 123 });
    expect(JSON.stringify(ok.json)).not.toContain("RAW");
  });

  it("billing-guest/artifact without a session is its 401", async () => {
    const r = await route(deps(), req("GET", "billing-guest/artifact", { user: null }));
    expect(r.status).toBe(401);
  });
});

describe("signroom router: letterhead templates", () => {
  it("POST workspaces/branding-template hands the raw file to the upload and returns its JSON", async () => {
    const up = vi.spyOn(templates, "uploadTemplate").mockResolvedValue({ workspaceId: "w1", hash: "h1", name: "a.pdf" });
    const bytes = new Uint8Array([1, 2, 3]);
    const r = await route(deps(), req("POST", "workspaces/branding-template", { raw: { bytes, name: "a.pdf" } }));
    expect(r).toEqual({ status: 200, json: { workspaceId: "w1", hash: "h1", name: "a.pdf" } });
    expect(up).toHaveBeenCalledWith(expect.anything(), user, { bytes, name: "a.pdf" });
    up.mockRestore();
  });

  it("POST without a raw file is the size sentence, 400", async () => {
    const r = await route(deps(), req("POST", "workspaces/branding-template"));
    expect(r).toEqual({ status: 400, json: { error: "Choose a single-page PDF up to 4 MB." } });
  });

  it("GET workspaces/branding-template?hash= is an inline letterhead.pdf", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const get = vi.spyOn(templates, "templateBytes").mockResolvedValue(bytes);
    const r = await route(deps(), req("GET", "workspaces/branding-template", { query: { hash: "h1" } }));
    expect(r).toEqual({ status: 200, pdf: { bytes, filename: "letterhead.pdf", inline: true } });
    expect(get).toHaveBeenCalledWith(expect.anything(), user, "h1");
    get.mockRestore();
  });

  it("PUT on that path is a 404", async () => {
    const r = await route(deps(), req("PUT", "workspaces/branding-template"));
    expect(r.status).toBe(404);
  });
});

describe("signroom router: design preview", () => {
  it("POST workspaces/branding-preview is an inline branding-preview.pdf", async () => {
    const r = await route(deps(), req("POST", "workspaces/branding-preview", { body: { companyName: "Bloom Ltd" } }));
    expect(r.status).toBe(200);
    expect(r.pdf?.inline).toBe(true);
    expect(r.pdf?.filename).toBe("branding-preview.pdf");
    expect(Buffer.from(r.pdf!.bytes.slice(0, 4)).toString()).toBe("%PDF");
  });

  it("draws a receipt or an invoice when asked, and an agreement for anything else", async () => {
    const receipt = await route(deps(), req("POST", "workspaces/branding-preview", { body: { companyName: "Bloom Ltd", previewKind: "receipt" } }));
    const other = await route(deps(), req("POST", "workspaces/branding-preview", { body: { companyName: "Bloom Ltd", previewKind: "agreement" } }));
    const invoice = await route(deps(), req("POST", "workspaces/branding-preview", { body: { companyName: "Bloom Ltd", previewKind: "invoice" } }));
    const text = async (b: Uint8Array) => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: new Uint8Array(b), useSystemFonts: false }).promise;
      const c = await (await doc.getPage(1)).getTextContent();
      return c.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    };
    expect(await text(receipt.pdf!.bytes)).toContain("RCT-2026-00005");
    expect(await text(invoice.pdf!.bytes)).toContain("INV-2026-00005");
    expect(await text(other.pdf!.bytes)).toContain("A clear, consistent company document");
  });

  it("is a 404 for any other method", async () => {
    expect((await route(deps(), req("GET", "workspaces/branding-preview"))).status).toBe(404);
  });

  it("POST workspaces/<action> reaches workspaceAction with the store, the user, the action, the body and the mail deps", async () => {
    const d = deps();
    const act = vi.mocked(workspace.workspaceAction);
    for (const action of ["settings", "email-settings", "branding"]) {
      act.mockResolvedValueOnce({ ok: action } as never);
      expect(await route(d, req("POST", `workspaces/${action}`, { body: { name: "Co" } }))).toEqual({ status: 200, json: { ok: action } });
      expect(act).toHaveBeenLastCalledWith(d.mail.store, user, action, { name: "Co" }, d.mail);
    }
    act.mockClear();
    for (const [m, p] of [["GET", "workspaces/settings"], ["POST", "workspaces/members"], ["POST", "workspaces/invite"], ["POST", "workspaces/settings/x"], ["POST", "workspaces"]])
      expect(await route(d, req(m, p)), `${m} ${p}`).toEqual({ status: 404, json: { error: "Not found." } });
    expect(act).not.toHaveBeenCalled();
  });

  it("is owner only", async () => {
    const store = seededStore(user);
    store.addMember(WS, "m1", "Member");
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    expect((await route(deps(store), req("POST", "workspaces/branding-preview", { user: member, body: { companyName: "x" } }))).status).toBe(403);
  });
});

describe("signroom router: agreements", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  const stub = { id: ID, title: "T" };

  it("GET agreements lists, POST agreements creates, GET templates lists templates", async () => {
    const d = deps();
    expect(await route(d, req("GET", "agreements"))).toEqual({ status: 200, json: [] });
    expect(vi.mocked(agreements.listAgreements)).toHaveBeenLastCalledWith(expect.anything(), user, {});
    expect(await route(d, req("GET", "templates"))).toEqual({ status: 200, json: [] });
    expect(vi.mocked(agreements.listTemplates)).toHaveBeenLastCalledWith(expect.anything(), user);
    const c = await companyClient(d.mail.store, user, "Bloom", "a@b.co");
    const created = await route(d, req("POST", "agreements", { body: { clientId: c.id, type: "NDA" } }));
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ clientId: c.id, type: "NDA", status: "Draft" });
    const got = await route(d, req("GET", `agreements/${(created.json as { id: string }).id}`));
    expect(got).toMatchObject({ status: 200, json: { id: (created.json as { id: string }).id, deliveries: [] } });
    expect((await route(d, req("GET", "agreements"))).json).toHaveLength(1);
  });

  it("GET agreements/:id/artifact-url is JSON { url, filename }; kind defaults to source; download=1 asks for an attachment", async () => {
    const spy = vi.mocked(agreements.agreementArtifactUrl);
    const link = { url: "https://storage.test/x", filename: "final.pdf" };
    spy.mockResolvedValueOnce(link);
    const r = await route(deps(), req("GET", `agreements/${ID}/artifact-url`, { query: { kind: "final" } }));
    expect(r).toEqual({ status: 200, json: link });
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), user, ID, "final", false);
    spy.mockResolvedValueOnce(link);
    await route(deps(), req("GET", `agreements/${ID}/artifact-url`, { query: { download: "1" } }));
    expect(spy).toHaveBeenLastCalledWith(expect.anything(), user, ID, "source", true);
  });

  it("artifact-url keeps the module's sentences: unknown kind 404, not ready 409", async () => {
    const d = deps();
    const c = await companyClient(d.mail.store, user, "Bloom", "a@b.co");
    const a = (await route(d, req("POST", "agreements", { body: { clientId: c.id, type: "NDA" } }))).json as { id: string };
    expect(await route(d, req("GET", `agreements/${a.id}/artifact-url`, { query: { kind: "manifest" } }))).toEqual({
      status: 404,
      json: { error: "Unknown artifact." },
    });
    expect(await route(d, req("GET", `agreements/${a.id}/artifact-url`))).toEqual({ status: 409, json: { error: "This file is not ready." } });
  });

  it("each POST action reaches its function with the body", async () => {
    const act = vi.mocked(agreements.agreementAction);
    const prep = vi.mocked(agreementDocument.prepareAgreement);
    for (const action of ["save", "archive", "unarchive", "trash", "restore", "duplicate", "template", "hold"]) {
      act.mockResolvedValueOnce(stub as never);
      const r = await route(deps(), req("POST", `agreements/${ID}/${action}`, { body: { revision: 3 } }));
      expect(r).toEqual({ status: 200, json: stub });
      expect(act).toHaveBeenLastCalledWith(expect.anything(), user, ID, action, { revision: 3 });
    }
    prep.mockResolvedValueOnce(stub as never);
    expect(await route(deps(), req("POST", `agreements/${ID}/prepare`, { body: { revision: 3 } }))).toEqual({ status: 200, json: stub });
    expect(prep).toHaveBeenLastCalledWith(expect.anything(), user, ID, { revision: 3 });
  });

  it("POST upload-url and upload reach their functions with the mail deps and the body", async () => {
    const d = deps();
    const ticket = { uploadId: ID, path: "w/quarantine/x.pdf", token: "t" };
    vi.mocked(agreementDocument.uploadUrl).mockResolvedValueOnce(ticket);
    const body = { name: "a.pdf", size: 10, revision: 3 };
    expect(await route(d, req("POST", `agreements/${ID}/upload-url`, { body }))).toEqual({ status: 200, json: ticket });
    expect(vi.mocked(agreementDocument.uploadUrl)).toHaveBeenLastCalledWith(d.mail, user, ID, body);
    vi.mocked(agreementDocument.finishUpload).mockResolvedValueOnce(stub as never);
    const finish = { uploadId: ID, revision: 3 };
    expect(await route(d, req("POST", `agreements/${ID}/upload`, { body: finish }))).toEqual({ status: 200, json: stub });
    expect(vi.mocked(agreementDocument.finishUpload)).toHaveBeenLastCalledWith(d.mail, user, ID, finish);
    for (const p of ["upload-url", "upload"]) {
      expect(await route(d, req("GET", `agreements/${ID}/${p}`))).toEqual({ status: 404, json: { error: "Not found." } });
      expect(await route(d, req("POST", `agreements/${ID}/${p}/x`))).toEqual({ status: 404, json: { error: "Not found." } });
    }
    expect(await route(d, req("POST", `agreements/not-an-id/upload-url`, { body }))).toEqual({ status: 404, json: { error: "Agreement not found." } });
  });

  it("POST send, cancel and resend reach their functions with the mail deps; send and resend get the origin", async () => {
    const d = deps();
    const send = vi.mocked(agreementSend.sendAgreement);
    const cancel = vi.mocked(agreementSend.cancelAgreement);
    const resend = vi.mocked(agreementSend.resendInvitations);
    const b = { revision: 3, eligible: true, idempotencyKey: "k" };
    send.mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/send`, { body: b }))).toEqual({ status: 200, json: stub });
    expect(send).toHaveBeenLastCalledWith(d.mail, user, ID, b, ORIGIN);
    cancel.mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/cancel`, { body: { reason: "r" } }))).toEqual({ status: 200, json: stub });
    expect(cancel).toHaveBeenLastCalledWith(d.mail, user, ID, { reason: "r" });
    resend.mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/resend`))).toEqual({ status: 200, json: stub });
    expect(resend).toHaveBeenLastCalledWith(d.mail, user, ID, ORIGIN);
    for (const p of ["send", "cancel", "resend"]) {
      expect(await route(d, req("GET", `agreements/${ID}/${p}`))).toEqual({ status: 404, json: { error: "Not found." } });
      expect(await route(d, req("POST", `agreements/${ID}/${p}/x`))).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });

  it("POST sign-first gets the mail deps and the body; release-first gets the origin", async () => {
    const d = deps();
    const signFirst = vi.mocked(agreementSend.signFirst);
    const releaseFirst = vi.mocked(agreementSend.releaseFirst);
    const b = { signature: "S", values: {}, consent: true, consentVersion: "v", sourceHash: "h" };
    signFirst.mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/sign-first`, { body: b }))).toEqual({ status: 200, json: stub });
    expect(signFirst).toHaveBeenLastCalledWith(d.mail, user, ID, b);
    releaseFirst.mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/release-first`, { body: { x: 1 } }))).toEqual({ status: 200, json: stub });
    expect(releaseFirst).toHaveBeenLastCalledWith(d.mail, user, ID, ORIGIN);
    for (const p of ["sign-first", "release-first"]) {
      expect(await route(d, req("GET", `agreements/${ID}/${p}`))).toEqual({ status: 404, json: { error: "Not found." } });
      expect(await route(d, req("POST", `agreements/${ID}/${p}/x`))).toEqual({ status: 404, json: { error: "Not found." } });
    }
    expect(await route(d, req("POST", `agreements/${ID}/sign-first`, { user: null }))).toEqual({
      status: 401,
      json: { error: SIGN_IN_MESSAGE },
    });
  });

  it("POST export and delete reach their functions with the store, the user and the id", async () => {
    const d = deps();
    const link = { url: "https://storage.test/x", filename: `signroom-evidence-${ID}.zip`, agreement: stub };
    vi.mocked(retention.exportEvidence).mockResolvedValueOnce(link as never);
    expect(await route(d, req("POST", `agreements/${ID}/export`, { body: { x: 1 } }))).toEqual({ status: 200, json: link });
    expect(vi.mocked(retention.exportEvidence)).toHaveBeenLastCalledWith(d.mail.store, user, ID);
    vi.mocked(retention.scheduleDeletion).mockResolvedValueOnce(stub as never);
    expect(await route(d, req("POST", `agreements/${ID}/delete`, { body: { x: 1 } }))).toEqual({ status: 200, json: stub });
    expect(vi.mocked(retention.scheduleDeletion)).toHaveBeenLastCalledWith(d.mail.store, user, ID);
    expect(await route(d, req("POST", `agreements/${ID}/delete`, { user: null }))).toEqual({ status: 401, json: { error: SIGN_IN_MESSAGE } });
  });

  it("unknown actions and methods are 404 Not found., including 3B's", async () => {
    for (const [m, p] of [
      ["GET", `agreements/${ID}/ai-draft`],
      ["POST", `agreements/${ID}/ai-draft`],
      ["GET", `agreements/${ID}/export`],
      ["GET", `agreements/${ID}/delete`],
      ["POST", `agreements/${ID}/export/x`],
      ["POST", `agreements/${ID}/explode`],
      ["GET", `agreements/${ID}/save`],
      ["POST", `agreements/${ID}/artifact`],
      ["GET", `agreements/${ID}/artifact`],
      ["POST", `agreements/${ID}/artifact-url`],
      ["POST", `agreements/${ID}`],
      ["DELETE", "agreements"],
      ["POST", "templates"],
      ["GET", `agreements/${ID}/artifact/x`],
    ]) {
      expect(await route(deps(), req(m, p))).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });

  it("an agreement the user cannot see is the module's 404 sentence", async () => {
    const r = await route(deps(), req("GET", `agreements/${ID}`));
    expect(r).toEqual({ status: 404, json: { error: "Agreement not found." } });
  });
});

describe("signroom router: agreement guests", () => {
  const link = { url: "https://storage.test/x", filename: "final.pdf" };

  it("each POST guest/<action> reaches agreementGuestAction with the body, the sr_sign session and the origin, without a user", async () => {
    const spy = vi.mocked(signGuest.agreementGuestAction);
    for (const action of ["intro", "code", "verify", "recover", "document", "sign", "decline"]) {
      spy.mockResolvedValueOnce({ json: { ok: true, action } });
      const r = await route(deps(), req("POST", `guest/${action}`, { user: null, body: { access: "A" }, signSession: "SESS" }));
      expect(r).toEqual({ status: 200, json: { ok: true, action } });
      expect(spy).toHaveBeenLastCalledWith(expect.anything(), action, { access: "A" }, "SESS", ORIGIN);
    }
  });

  it("verify's session becomes setSignSession and stays out of the JSON", async () => {
    vi.mocked(signGuest.agreementGuestAction).mockResolvedValueOnce({ json: { ok: true }, session: { raw: "RAW", expires: 123 } });
    const r = await route(deps(), req("POST", "guest/verify", { user: null }));
    expect(r).toEqual({ status: 200, json: { ok: true }, setSignSession: { raw: "RAW", expires: 123 } });
    expect(r.setGuestSession).toBeUndefined();
  });

  it("GET guest/artifact-url passes the kind (source by default); GET guest/export reaches its function", async () => {
    const url = vi.mocked(signGuest.agreementGuestArtifactUrl);
    url.mockResolvedValueOnce(link);
    expect(await route(deps(), req("GET", "guest/artifact-url", { user: null, query: { kind: "final" }, signSession: "SESS" }))).toEqual({
      status: 200,
      json: link,
    });
    expect(url).toHaveBeenLastCalledWith(expect.anything(), "SESS", "final");
    url.mockResolvedValueOnce(link);
    await route(deps(), req("GET", "guest/artifact-url", { user: null, signSession: "SESS" }));
    expect(url).toHaveBeenLastCalledWith(expect.anything(), "SESS", "source");
    const exp = vi.mocked(signGuest.agreementGuestExport);
    exp.mockResolvedValueOnce({ url: "https://storage.test/z", filename: "signroom-evidence-1.zip" });
    expect(await route(deps(), req("GET", "guest/export", { user: null, signSession: "SESS" }))).toEqual({
      status: 200,
      json: { url: "https://storage.test/z", filename: "signroom-evidence-1.zip" },
    });
    expect(exp).toHaveBeenLastCalledWith(expect.anything(), "SESS");
  });

  it("anything else under guest/ is 404", async () => {
    for (const [m, p] of [["POST", "guest/unknown"], ["GET", "guest/intro"], ["POST", "guest/export"], ["POST", "guest/artifact-url"], ["GET", "guest"], ["POST", "guest/sign/x"]]) {
      expect(await route(deps(), req(m, p, { user: null }))).toEqual({ status: 404, json: { error: "Not found." } });
    }
  });

  it("guest/artifact-url without a session is the module's 401", async () => {
    const r = await route(deps(), req("GET", "guest/artifact-url", { user: null }));
    expect(r).toEqual({ status: 401, json: { error: "Verify your invited email to continue." } });
  });
});

describe("signroom router: the scheduled run", () => {
  it("ops/run without cron is 404, signed in or not, and runs nothing", async () => {
    const run = vi.mocked(worker.runOps);
    run.mockClear();
    for (const extra of [{}, { user: null }, { cron: false }]) {
      expect(await route(deps(), req("POST", "ops/run", extra))).toEqual({ status: 404, json: { error: "Not found." } });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("POST ops/run with cron calls runOps with the mail deps and answers its result", async () => {
    const run = vi.mocked(worker.runOps);
    run.mockClear();
    const d = deps();
    expect(await route(d, req("POST", "ops/run", { user: null, cron: true }))).toEqual({ status: 200, json: { processed: 0 } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith(d.mail);
  });

  it("any other ops path or method is 404, even with cron", async () => {
    const run = vi.mocked(worker.runOps);
    run.mockClear();
    for (const [m, p] of [["GET", "ops/run"], ["POST", "ops/jobs"], ["POST", "ops"], ["POST", "ops/run/x"], ["GET", "ops/jobs"]]) {
      expect(await route(deps(), req(m, p, { user: null, cron: true }))).toEqual({ status: 404, json: { error: "Not found." } });
    }
    expect(run).not.toHaveBeenCalled();
  });
});

describe("signroom router: client-accounts", () => {
  const C = "11111111-2222-4333-8444-555555555555";

  it("GET client-accounts/<id> passes from and to; n 1 is 404; signed out is 401", async () => {
    const d = deps();
    vi.mocked(clientAccounts.clientAccount).mockResolvedValueOnce({ canManage: true } as never);
    expect(await route(d, req("GET", `client-accounts/${C}`, { query: { from: "2026-01-01", to: "2026-02-01" } }))).toEqual({ status: 200, json: { canManage: true } });
    expect(vi.mocked(clientAccounts.clientAccount)).toHaveBeenLastCalledWith(d.mail.store, user, C, "GET", {}, "2026-01-01", "2026-02-01");
    expect(await route(d, req("GET", "client-accounts"))).toEqual({ status: 404, json: { error: "Not found." } });
    expect(await route(d, req("GET", `client-accounts/${C}`, { user: null }))).toEqual({ status: 401, json: { error: SIGN_IN_MESSAGE } });
  });
});
