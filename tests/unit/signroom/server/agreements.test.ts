// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, type PDFPage } from "pdf-lib";
import {
  agreementAction,
  agreementArtifactUrl,
  ARTIFACT_URL_SECONDS,
  createAgreement,
  getAgreement,
  listAgreements,
  listTemplates,
  publicAgreement,
  TRASHED,
} from "../../../../api/_signroom/agreements";
import { prepareAgreement } from "../../../../api/_signroom/agreementDocument";
import { currentWorkspace } from "../../../../api/_signroom/context";
import type { Agreement, AgreementTemplate, Participant } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { artifactBytes, madeDraft, newClient, OWNER, SR_CONTENT } from "./agreementFixtures";
import { ORG2, seededStore, WS, WS2, type FakeStore } from "./helpers";

const owner = OWNER;
const member = { id: "m1", email: "member@example.com", workspaceId: WS };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==";

/** The same store, where m1 is a member (not an admin) of the workspace's organisation: a Signroom Member. */
function withMember(store: Store): Store {
  (store as FakeStore).addMember(WS, member.id, "Member");
  return store;
}

async function setup() {
  const store = seededStore();
  const ws = (await currentWorkspace(store, owner)).workspace;
  const client = await newClient(store);
  return { store, deps: { store }, ws, client };
}

const save = (store: Store, a: Agreement, patch: Record<string, unknown>, user = owner) =>
  agreementAction(store, user, a.id, "save", { ...a, ...patch }) as Promise<Agreement>;

const sentParticipants = (): Participant[] => [
  { id: randomUUID(), name: "Signer 1", email: "signer-1@example.test", role: "signer", order: 1, progress: "invited", version: 1 },
  { id: randomUUID(), name: "Copy", email: "copy@example.test", role: "copy", order: 2, progress: "waiting", version: 0 },
];

/** A row as if it had been sent: built straight into the store (sending arrives in Task 6). */
async function awaiting(store: Store, wsId: string, clientId: string, over: Partial<Agreement> = {}) {
  const participants = sentParticipants();
  return store.insertAgreement({
    workspaceId: wsId,
    senderId: owner.id,
    clientId,
    type: "NDA",
    title: "Sent NDA",
    status: "Awaiting signatures",
    revision: 4,
    content: SR_CONTENT,
    sourceKind: "authored",
    documentHash: "a".repeat(64),
    pages: [{ width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 }],
    participants,
    fields: [
      { id: randomUUID(), participantId: participants[0].id, kind: "signature", label: "signature", page: 2, x: 0.1, y: 0.1, width: 0.3, height: 0.04, required: true },
    ],
    sequential: false,
    deadline: "",
    reminderDays: 3,
    subject: "",
    message: "",
    sentAt: new Date().toISOString(),
    sendKey: "send-1",
    events: [{ seq: 1, type: "Agreement frozen and sent", actor: owner.email, at: new Date().toISOString(), detail: {} }],
    legalHold: false,
    ...over,
  });
}

/** True when the page's resources hold an image XObject (an empty XObject dictionary does not count). */
function hasImage(page: PDFPage): boolean {
  const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return false;
  return xobjects.keys().some((k) => {
    const o = xobjects.lookup(k);
    return o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  });
}

const sourceBytes = (store: Store, id: string) => artifactBytes(store, owner, id, "source");

describe("prepare", () => {
  it("SR's content gives 2 pages, a stored %PDF, revision + 1 and the event", async () => {
    const { store, client } = await setup();
    let a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    a = await save(store, a, { content: SR_CONTENT });
    const before = a.revision;
    const p = await prepareAgreement(store, owner, a.id, { revision: a.revision });
    expect(p.pages).toHaveLength(2);
    expect(p.revision).toBe(before + 1);
    expect(p.sourceKind).toBe("authored");
    const blob = await store.getBlob(p.workspaceId, p.documentHash!);
    expect(new TextDecoder().decode(blob.subarray(0, 4))).toBe("%PDF");
    expect(p.events.at(-1)).toMatchObject({ type: "Authored PDF prepared", actor: owner.email, detail: { sourceHash: p.documentHash } });
    expect(p).not.toHaveProperty("rowVersion");
  }, 30000);

  it("every authored page carries the company logo (SR: every authored agreement page includes company branding)", async () => {
    const { store, ws, client } = await setup();
    await store.updateWorkspace(ws.id, { logo: PNG });
    let a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    a = await save(store, a, { content: SR_CONTENT });
    a = await prepareAgreement(store, owner, a.id, { revision: a.revision });
    expect(a.pages).toHaveLength(2);
    const doc = await PDFDocument.load(await sourceBytes(store, a.id));
    expect(doc.getPages().map(hasImage)).toEqual([true, true]);
    expect(a.branding?.logo).toBe(PNG);
  }, 30000);

  it("a stale revision is 409 The draft changed. Reload it.", async () => {
    const { store, client } = await setup();
    let a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    a = await save(store, a, { content: SR_CONTENT });
    await expect(prepareAgreement(store, owner, a.id, { revision: a.revision - 1 })).rejects.toMatchObject({
      status: 409,
      message: "The draft changed. Reload it.",
    });
  });

  it("with fields placed it asks for clearFields, and clearFields empties them", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await expect(prepareAgreement(store, owner, a.id, { revision: a.revision })).rejects.toMatchObject({
      status: 409,
      message: "Replacing the PDF clears field placements. Confirm this first.",
    });
    const p = await prepareAgreement(store, owner, a.id, { revision: a.revision, clearFields: true });
    expect(p.fields).toEqual([]);
  }, 30000);
});

describe("create", () => {
  it("needs a client", async () => {
    const { store } = await setup();
    await expect(createAgreement(store, owner, { type: "NDA" })).rejects.toMatchObject({ status: 400, message: "Create or choose a client first." });
    await expect(createAgreement(store, owner, { clientId: "not-an-id", type: "NDA" })).rejects.toMatchObject({ status: 400 });
  });

  it("four agreement types belong to one client", async () => {
    const { store, client } = await setup();
    for (const type of ["NDA", "Statement of work", "Service agreement", "Engagement letter"])
      await createAgreement(store, owner, { clientId: client.id, type });
    const all = await listAgreements(store, owner);
    expect(all.filter((a) => a.clientId === client.id)).toHaveLength(4);
  });

  it("an unknown type becomes Other agreement; SR's defaults, client signer and Draft created event", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "Lease" });
    expect(a.type).toBe("Other agreement");
    expect(a.title).toBe(`Other agreement — ${client.name}`);
    expect(a).toMatchObject({ status: "Draft", revision: 1, reminderDays: 3, sequential: false, legalHold: false, senderId: owner.id });
    expect(a.participants).toEqual([
      { id: expect.any(String), name: "Bea Bloom", email: "bea@bloom.co", role: "signer", order: 1, progress: "waiting", version: 0 },
    ]);
    expect(a.events).toEqual([
      { seq: 1, type: "Draft created", actor: owner.email, at: expect.any(String), detail: { clientId: client.id, type: "Other agreement" } },
    ]);
  });

  it("refuses the 101st draft", async () => {
    const { store, ws, client } = await setup();
    const count = store.countDrafts;
    store.countDrafts = async (w) => (w === ws.id ? 100 : count(w));
    await expect(createAgreement(store, owner, { clientId: client.id, type: "NDA" })).rejects.toMatchObject({
      status: 400,
      message: "Workspace draft limit reached.",
    });
  });
});

describe("who may see", () => {
  it("another workspace's user gets 404", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    // An admin of another organisation, working in their own workspace, never finds it...
    store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
    store.setOrgMember(WS2, "u2", "admin");
    const other = { id: "u2", email: "other@example.com", workspaceId: WS2 };
    await expect(getAgreement(store, other, a.id)).rejects.toMatchObject({ status: 404, message: "Agreement not found." });
    // ...and cannot name this workspace instead.
    await expect(getAgreement(store, { ...other, workspaceId: WS }, a.id)).rejects.toMatchObject({ status: 403, message: "Choose a workspace." });
    await expect(getAgreement(store, owner, "not-an-id")).rejects.toMatchObject({ status: 404 });
  });

  it("a Member who is not the sender gets 404 everywhere and an empty list; the Owner sees a Member's agreement", async () => {
    const { store, client } = await setup();
    const ms = withMember(store);
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    const nf = { status: 404, message: "Agreement not found." };
    await expect(getAgreement(ms, member, a.id)).rejects.toMatchObject(nf);
    for (const action of ["save", "archive", "trash"] as const)
      await expect(agreementAction(ms, member, a.id, action, { ...a })).rejects.toMatchObject(nf);
    await expect(agreementArtifactUrl(ms, member, a.id, "source")).rejects.toMatchObject(nf);
    expect(await listAgreements(ms, member)).toEqual([]);

    const mine = await createAgreement(ms, member, { clientId: client.id, type: "NDA" });
    expect(mine.senderId).toBe(member.id);
    expect((await listAgreements(ms, member)).map((x) => x.id)).toEqual([mine.id]);
    expect((await getAgreement(ms, owner, mine.id)).id).toBe(mine.id);
    expect(await listAgreements(ms, owner)).toHaveLength(2);
  });
});

describe("save", () => {
  it("a stale revision is 409", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id, { type: "Service agreement", recipients: 2, allFields: true });
    await expect(save(store, a, { revision: a.revision - 1 })).rejects.toMatchObject({
      status: 409,
      message: "This draft changed in another tab. Reload it before saving.",
    });
  }, 30000);

  it("a content change with fields placed needs clearFields; clearFields empties fields and the document", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await expect(save(store, a, { content: SR_CONTENT + "\nMore." })).rejects.toMatchObject({
      status: 409,
      message: "Changing document text clears field placements. Confirm this before saving.",
    });
    const s = await save(store, a, { content: SR_CONTENT + "\nMore.", clearFields: true });
    expect(s.fields).toEqual([]);
    expect(s.documentHash).toBeUndefined();
    expect(s.pages).toEqual([]);
    expect(s.revision).toBe(a.revision + 1);
  }, 30000);

  it("refuses 13 recipients", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    const participants = Array.from({ length: 13 }, (_, i) => ({ name: "S" + i, email: `s${i}@example.test`, role: "signer" }));
    await expect(save(store, a, { participants })).rejects.toMatchObject({ status: 400, message: "Use at most 12 recipients." });
  });

  it("refuses a field on page 3 of a 2-page document", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const fields = [{ ...a.fields[0], page: 3 }];
    await expect(save(store, a, { fields })).rejects.toMatchObject({ status: 400, message: "A field has invalid placement or recipient." });
  }, 30000);

  it("keeps known participant ids, renumbers order and resets progress", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    const s = await save(store, a, {
      participants: [
        { name: "New", email: "NEW@Example.test", role: "copy" },
        { ...a.participants[0], progress: "signed", version: 9 },
      ],
      senderFirst: true,
      reminderDays: 99,
    });
    expect(s.participants[0]).toMatchObject({ name: "New", email: "new@example.test", role: "copy", order: 1, progress: "waiting", version: 0 });
    expect(s.participants[1]).toMatchObject({ id: a.participants[0].id, order: 2, progress: "waiting", version: 0 });
    expect(s).toMatchObject({ senderFirst: true, sequential: true, reminderDays: 30 });
  });

  it("refuses a sent agreement", async () => {
    const { store, ws, client } = await setup();
    const a = await awaiting(store, ws.id, client.id);
    await expect(agreementAction(store, owner, a.id, "save", { revision: a.revision })).rejects.toMatchObject({
      status: 409,
      message: "This agreement is frozen. Duplicate it to change terms.",
    });
  });
});

describe("archive and trash", () => {
  it("archive twice adds one event and the source is unchanged; unarchive", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const bytes = await sourceBytes(store, a.id);
    const one = (await agreementAction(store, owner, a.id, "archive", {})) as Agreement;
    const two = (await agreementAction(store, owner, a.id, "archive", {})) as Agreement;
    expect(two.events).toHaveLength(a.events.length + 1);
    expect(two.events.at(-1)?.type).toBe("Document archived");
    expect(two.archivedAt).toBe(one.archivedAt);
    expect(await sourceBytes(store, a.id)).toEqual(bytes);
    const un = (await agreementAction(store, owner, a.id, "unarchive", {})) as Agreement;
    expect(un.archivedAt).toBeUndefined();
    expect(un.events.at(-1)?.type).toBe("Document unarchived");
  }, 30000);

  it("trash blocks save; restore gives a Draft with the same source", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const bytes = await sourceBytes(store, a.id);
    const t = (await agreementAction(store, owner, a.id, "trash", {})) as Agreement;
    expect(t.trashedAt).toBeTruthy();
    expect(t.events.at(-1)?.type).toBe("Document moved to recoverable Trash");
    await expect(save(store, a, {})).rejects.toMatchObject({ status: 409, message: TRASHED });
    await expect(agreementAction(store, owner, a.id, "archive", {})).rejects.toMatchObject({ status: 409, message: TRASHED });
    expect((await getAgreement(store, owner, a.id)).trashedAt).toBeTruthy();
    expect(await sourceBytes(store, a.id)).toEqual(bytes);
    const r = (await agreementAction(store, owner, a.id, "restore", {})) as Agreement;
    expect(r.status).toBe("Draft");
    expect(r.trashedAt).toBeUndefined();
    expect(r.events.at(-1)?.type).toBe("Document restored from Trash");
    expect(await sourceBytes(store, a.id)).toEqual(bytes);
  }, 30000);

  it("an agreement awaiting signatures cannot be trashed", async () => {
    const { store, ws, client } = await setup();
    const a = await awaiting(store, ws.id, client.id);
    await expect(agreementAction(store, owner, a.id, "trash", {})).rejects.toMatchObject({
      status: 409,
      message: "Cancel or complete the signing process before moving this document to Trash.",
    });
  });

  it("legal hold blocks trash; a Member cannot hold", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    const h = (await agreementAction(store, owner, a.id, "hold", { hold: true, reason: "Synthetic legal hold" })) as Agreement;
    expect(h.legalHold).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ type: "Legal hold applied", detail: { reason: "Synthetic legal hold" } });
    await expect(agreementAction(store, owner, a.id, "trash", {})).rejects.toMatchObject({
      status: 409,
      message: "This document is on legal hold and cannot be moved to Trash.",
    });
    const off = (await agreementAction(store, owner, a.id, "hold", { hold: false })) as Agreement;
    expect(off.events.at(-1)?.type).toBe("Legal hold released");

    const ms = withMember(store);
    const mine = await createAgreement(ms, member, { clientId: client.id, type: "NDA" });
    await expect(agreementAction(ms, member, mine.id, "hold", { hold: true })).rejects.toMatchObject({ status: 403 });
  });
});

describe("templates", () => {
  it("template, then create from it; a second save is version 2; the list has five keys", async () => {
    const { store, deps, client } = await setup();
    const draft = await madeDraft(deps, client.id, { type: "Statement of work", recipients: 2, allFields: true });
    const name = "TEST reusable SOW";
    const template = (await agreementAction(store, owner, draft.id, "template", { name })) as AgreementTemplate;
    expect(template).toMatchObject({ name, version: 1, roles: ["Client", "Company representative"] });
    const applied = await createAgreement(store, owner, { clientId: client.id, type: "Statement of work", templateId: template.id });
    expect(applied.templateVersionId).toBe(template.id);
    expect(applied.fields).toHaveLength(draft.fields.length);
    expect(applied.participants[0].id).not.toBe(draft.participants[0].id);
    expect(applied.participants[0].email).not.toBe(draft.participants[0].email);
    expect(applied.documentHash).toBe(draft.documentHash);
    expect(applied.pages).toEqual(draft.pages);
    for (const f of applied.fields) expect(applied.participants.map((p) => p.id)).toContain(f.participantId);

    const v2 = (await agreementAction(store, owner, draft.id, "template", { name })) as AgreementTemplate;
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(template.id);

    const list = await listTemplates(store, owner);
    expect(list).toHaveLength(2);
    for (const t of list) expect(Object.keys(t).sort()).toEqual(["created", "id", "name", "type", "version"]);
  }, 30000);

  it("an unknown template is 404; a sent agreement cannot be a template", async () => {
    const { store, ws, client } = await setup();
    await expect(createAgreement(store, owner, { clientId: client.id, type: "NDA", templateId: randomUUID() })).rejects.toMatchObject({
      status: 404,
      message: "Template not found.",
    });
    const a = await awaiting(store, ws.id, client.id);
    await expect(agreementAction(store, owner, a.id, "template", {})).rejects.toMatchObject({ status: 400, message: "Save templates from a draft." });
  });

  it("replaces {{client_name}} in the template text", async () => {
    const { store, client } = await setup();
    let a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    a = await save(store, a, { content: "Between us and {{client_name}}." });
    const t = (await agreementAction(store, owner, a.id, "template", { name: "Named" })) as AgreementTemplate;
    const applied = await createAgreement(store, owner, { clientId: client.id, type: "NDA", templateId: t.id });
    expect(applied.content).toBe(`Between us and ${client.name}.`);
  });
});

describe("duplicate", () => {
  it("a sent agreement becomes a fresh draft", async () => {
    const { store, ws, client } = await setup();
    const a = await awaiting(store, ws.id, client.id);
    const copy = (await agreementAction(store, owner, a.id, "duplicate", {})) as Agreement;
    expect(copy.id).not.toBe(a.id);
    expect(copy).toMatchObject({ status: "Draft", revision: 1, title: "Sent NDA (copy)", legalHold: false, senderFirst: false });
    expect(copy.events.map((e) => e.type)).toEqual(["Duplicated to a new draft"]);
    expect(copy.events[0].detail).toEqual({ originalId: a.id });
    expect(copy.sentAt).toBeUndefined();
    expect(copy.sendKey).toBeUndefined();
    expect(copy.frozen).toBeUndefined();
    expect(copy.participants).toHaveLength(2);
    for (const [i, p] of copy.participants.entries()) {
      expect(p.id).not.toBe(a.participants[i].id);
      expect(p.progress).toBe("waiting");
      expect(p.version).toBe(0);
    }
    expect(copy.fields[0].participantId).toBe(copy.participants[0].id);
    expect(copy.fields[0].id).not.toBe(a.fields[0].id);
    expect((await getAgreement(store, owner, a.id)).status).toBe("Awaiting signatures");
  });
});

describe("list", () => {
  it("returns summaries without content, events, frozen or signature data", async () => {
    const { store, ws, client } = await setup();
    const parts = sentParticipants();
    parts[0] = { ...parts[0], progress: "signed", signature: "Signer 1", drawing: "data:image/png;base64,AAAA", values: { f1: "x" } };
    await awaiting(store, ws.id, client.id, { participants: parts, frozen: undefined });
    const [item] = await listAgreements(store, owner);
    expect(item).not.toHaveProperty("content");
    expect(item).not.toHaveProperty("events");
    expect(item).not.toHaveProperty("frozen");
    expect(item).not.toHaveProperty("rowVersion");
    for (const p of item.participants) {
      expect(p).not.toHaveProperty("signature");
      expect(p).not.toHaveProperty("drawing");
      expect(p).not.toHaveProperty("values");
    }
    expect(item.participants[0].progress).toBe("signed");
  });
});

describe("expiry", () => {
  it("an agreement past its deadline is Expired on get, with its sign tokens revoked", async () => {
    const { store, ws, client } = await setup();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const a = await awaiting(store, ws.id, client.id, { deadline: yesterday });
    for (const p of a.participants)
      await store.insertSignToken({
        digest: randomUUID(),
        purpose: "sign",
        workspaceId: ws.id,
        agreementId: a.id,
        participantId: p.id,
        email: p.email,
        version: 1,
        expires: Date.now() + 86400000,
        revoked: false,
      });
    const got = await getAgreement(store, owner, a.id);
    expect(got.status).toBe("Expired");
    expect(got.events.at(-1)).toMatchObject({ type: "Agreement expired", actor: "system", seq: 2 });
    const tokens = await store.listSignTokens(a.id);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t) => t.revoked)).toBe(true);
  });

  it("a deadline of today has not passed", async () => {
    const { store, ws, client } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    const a = await awaiting(store, ws.id, client.id, { deadline: today });
    expect((await getAgreement(store, owner, a.id)).status).toBe("Awaiting signatures");
  });
});

describe("artifact", () => {
  it("only source, final and completion; a draft with no document is not ready", async () => {
    const { store, client } = await setup();
    const a = await createAgreement(store, owner, { clientId: client.id, type: "NDA" });
    await expect(agreementArtifactUrl(store, owner, a.id, "manifest")).rejects.toMatchObject({ status: 404, message: "Unknown artifact." });
    await expect(agreementArtifactUrl(store, owner, a.id, "source")).rejects.toMatchObject({ status: 409, message: "This file is not ready." });
    await expect(agreementArtifactUrl(store, owner, a.id, "final")).rejects.toMatchObject({ status: 409, message: "This file is not ready." });
    await expect(agreementArtifactUrl(store, owner, a.id, "completion")).rejects.toMatchObject({ status: 409, message: "This file is not ready." });
  });

  it("the source is a 60-second signed link to <workspace>/<documentHash>, named source.pdf", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const signed = vi.spyOn(store, "signedBlobUrl");
    const out = await agreementArtifactUrl(store, owner, a.id, "source");
    expect(out.filename).toBe("source.pdf");
    expect(signed).toHaveBeenLastCalledWith(a.workspaceId, a.documentHash, ARTIFACT_URL_SECONDS, undefined);
    expect(ARTIFACT_URL_SECONDS).toBe(60);
    expect(out.url).toBe(await signed.mock.results[0].value);
    expect(new TextDecoder().decode((await artifactBytes(store, owner, a.id)).subarray(0, 4))).toBe("%PDF");
  }, 30000);

  it("a download link names the file; viewing passes no name", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const signed = vi.spyOn(store, "signedBlobUrl");
    await agreementArtifactUrl(store, owner, a.id, "source", true);
    expect(signed).toHaveBeenLastCalledWith(a.workspaceId, a.documentHash, 60, "source.pdf");
  }, 30000);

  it("the source prefers the sender-signed copy, then the frozen source", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const row = (await store.getAgreement(a.workspaceId, a.id))!;
    const frozenHash = await store.putBlob(a.workspaceId, new TextEncoder().encode("%PDF-frozen"));
    const signedCopy = await store.putBlob(a.workspaceId, new TextEncoder().encode("%PDF-signed"));
    const frozen = { ...(row.frozen ?? {}), sourceHash: frozenHash } as NonNullable<typeof row.frozen>;
    const get = vi.spyOn(store, "getAgreement");
    const signed = vi.spyOn(store, "signedBlobUrl");
    get.mockResolvedValue({ ...row, frozen });
    await agreementArtifactUrl(store, owner, a.id, "source");
    expect(signed).toHaveBeenLastCalledWith(a.workspaceId, frozenHash, 60, undefined);
    get.mockResolvedValue({ ...row, frozen, senderSignedHash: signedCopy });
    await agreementArtifactUrl(store, owner, a.id, "source");
    expect(signed).toHaveBeenLastCalledWith(a.workspaceId, signedCopy, 60, undefined);
  }, 30000);

  it("final and completion are refused until the agreement is completed", async () => {
    const { store, deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const row = (await store.getAgreement(a.workspaceId, a.id))!;
    const final = await store.putBlob(a.workspaceId, new TextEncoder().encode("%PDF-final"));
    const get = vi.spyOn(store, "getAgreement");
    get.mockResolvedValue({ ...row, artifacts: { final } });
    await expect(agreementArtifactUrl(store, owner, a.id, "final")).rejects.toMatchObject({ status: 409, message: "Completion files are not ready." });
    get.mockResolvedValue({ ...row, status: "Completed", artifacts: { final } });
    const signed = vi.spyOn(store, "signedBlobUrl");
    expect(await agreementArtifactUrl(store, owner, a.id, "final", true)).toMatchObject({ filename: "final.pdf" });
    expect(signed).toHaveBeenLastCalledWith(a.workspaceId, final, 60, "final.pdf");
  }, 30000);

  it("getAgreement carries this agreement's deliveries", async () => {
    const { store, ws, client } = await setup();
    const a = await awaiting(store, ws.id, client.id);
    const d = await store.insertDelivery({
      workspaceId: ws.id,
      agreementId: a.id,
      participantId: a.participants[0].id,
      recipient: a.participants[0].email,
      subject: "Please sign",
      purpose: "invite",
      route: "securovix",
      status: "sending",
    });
    await store.finishDelivery(d.id, "failed", "x");
    const got = await getAgreement(store, owner, a.id);
    expect(got.deliveries).toEqual([{ id: d.id, participantId: a.participants[0].id, state: "failed", at: d.created }]);
  });

  it("publicAgreement keeps only each participant's latest delivery (a held or retried email shows its last state)", () => {
    const row = { workspaceId: "w1", agreementId: "a1", recipient: "x@y.z", subject: "s", purpose: "invite", route: "securovix" as const };
    const a = { id: "a1", rowVersion: 1 } as unknown as Parameters<typeof publicAgreement>[0];
    const out = publicAgreement(a, [
      { ...row, id: "new1", participantId: "p1", status: "failed", created: "2026-11-17T10:00:02.000Z" },
      { ...row, id: "old1", participantId: "p1", status: "sent", created: "2026-11-17T10:00:01.000Z" },
      { ...row, id: "p2a", participantId: "p2", status: "failed", created: "2026-11-17T10:00:00.000Z" },
      { ...row, id: "p2b", participantId: "p2", status: "sent", created: "2026-11-17T10:00:00.000Z" },
      { ...row, id: "other", agreementId: "a2", participantId: "p1", status: "sent", created: "2026-11-17T10:00:09.000Z" },
    ]);
    // The latest by time; on a tie, the later one in the store's (oldest first) order.
    expect(out.deliveries!.map((d) => [d.participantId, d.id, d.state])).toEqual([
      ["p2", "p2b", "sent"],
      ["p1", "new1", "failed"],
    ]);
  });

  it("publicAgreement leaves code emails and notices out of a participant's delivery line", () => {
    const row = { workspaceId: "w1", agreementId: "a1", recipient: "x@y.z", subject: "s", route: "securovix" as const };
    const a = { id: "a1", rowVersion: 1 } as unknown as Parameters<typeof publicAgreement>[0];
    const out = publicAgreement(a, [
      // p1: the invitation went out; a later failed code email must not show "failed".
      { ...row, id: "inv1", participantId: "p1", purpose: "invite", status: "sent", created: "2026-11-17T10:00:00.000Z" },
      { ...row, id: "otp1", participantId: "p1", purpose: "otp", status: "failed", created: "2026-11-17T10:00:05.000Z" },
      // p2: a held reminder stays visible behind a later sent code email and a notice.
      { ...row, id: "rem2", participantId: "p2", purpose: "reminder", status: "failed", created: "2026-11-17T10:00:01.000Z" },
      { ...row, id: "otp2", participantId: "p2", purpose: "otp", status: "sent", created: "2026-11-17T10:00:06.000Z" },
      { ...row, id: "not2", participantId: "p2", purpose: "notice", status: "sent", created: "2026-11-17T10:00:07.000Z" },
      // p3: the completion link counts.
      { ...row, id: "com3", participantId: "p3", purpose: "completion", status: "sent", created: "2026-11-17T10:00:08.000Z" },
      // The sender's notice has no participant and is left out too.
      { ...row, id: "sender", purpose: "notice", status: "sent", created: "2026-11-17T10:00:09.000Z" },
    ]);
    expect(out.deliveries!.map((d) => [d.participantId, d.id, d.state])).toEqual([
      ["p1", "inv1", "sent"],
      ["p2", "rem2", "failed"],
      ["p3", "com3", "sent"],
    ]);
  });
});
