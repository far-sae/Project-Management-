// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction, getAgreement } from "../../../../api/_signroom/agreements";
import { releaseFirst, resendInvitations, signFirst } from "../../../../api/_signroom/agreementSend";
import { sha } from "../../../../api/_signroom/billing";
import { currentWorkspace } from "../../../../api/_signroom/context";
import { acceptSignature } from "../../../../api/_signroom/signing";
import { CONSENT, type Agreement, type Field, type Participant } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";
import { UNAVAILABLE_MESSAGE } from "../../../../api/_signroom/host/rateLimit";
import { artifactBytes, madeDraft, mailSetup, newClient, ORIGIN, OWNER, sent, type Resend } from "./agreementFixtures";
import { WS, withMemberRole } from "./helpers";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let out = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out.replace(/\s+/g, " ");
}

type Sent = { to: string[]; subject: string; text: string };
const mails = (resend: Resend): Sent[] => resend.calls.map((c) => JSON.parse(String(c.init.body)) as Sent);

const save = (store: Store, a: Agreement, patch: Record<string, unknown>) =>
  agreementAction(store, OWNER, a.id, "save", { ...a, ...patch }) as Promise<Agreement>;

/**
 * Port of SR client-management.integration.ts 709–766: the owner as signer 1, a
 * counterparty as signer 2, sign-first, a signature field each on page 2, sent.
 */
async function signFirstSent() {
  const m = mailSetup();
  const ws = (await currentWorkspace(m.store, OWNER)).workspace;
  const client = await newClient(m.store);
  let a = await madeDraft(m.deps, client.id, { recipients: 2 });
  a = await save(m.store, a, {
    senderFirst: true,
    participants: [
      { ...a.participants[0], name: "Synthetic Owner", email: OWNER.email },
      { ...a.participants[1], name: "Synthetic Counterparty", email: "counterparty@example.test" },
    ],
  });
  a = await sent(m.deps, a);
  return { ...m, ws, client, a };
}

const consented = (a: Agreement, extra: Record<string, unknown> = {}) => ({
  signature: "Synthetic first signature",
  values: {},
  sourceHash: a.frozen!.sourceHash,
  consent: true,
  consentVersion: CONSENT.version,
  ...extra,
});

describe("sender-first: after send", () => {
  it("is pending the sender's release, with no sign token and no delivery", async () => {
    const { deps, a, resend } = await signFirstSent();
    expect(a.senderReleasePending).toBe(true);
    expect(a.sequential).toBe(true);
    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
    expect(await deps.store.listAgreementDeliveries(a.id)).toEqual([]);
    expect(resend.calls).toHaveLength(0);
  });

  it("before the first signature: release-first, resend and Trash are 409", async () => {
    const { deps, a } = await signFirstSent();
    await expect(releaseFirst(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "Sign the document first before sending it to the other company.",
    });
    await expect(resendInvitations(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "Use the sign-first workflow and explicitly release the document before sending invitations.",
    });
    await expect(agreementAction(deps.store, OWNER, a.id, "trash", {})).rejects.toMatchObject({ status: 409 });
    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
  });
});

describe("signFirst", () => {
  it("without consent: 400, and nothing changes (SR 'Authenticated first signing still requires explicit electronic consent')", async () => {
    const { deps, a } = await signFirstSent();
    const before = await getAgreement(deps.store, OWNER, a.id);
    await expect(
      signFirst(deps, OWNER, a.id, { signature: "Synthetic first signature", values: {}, sourceHash: a.frozen!.sourceHash }),
    ).rejects.toMatchObject({ status: 400, message: "Review the current document and give explicit consent." });
    expect(await getAgreement(deps.store, OWNER, a.id)).toEqual(before);
  });

  it("with consent: signed, the sender-signed PDF stored, four events in one write, still no sign token", async () => {
    const { deps, a, resend } = await signFirstSent();
    const before = await deps.store.getAgreement(a.workspaceId, a.id);
    const out = await signFirst(deps, OWNER, a.id, consented(a));
    expect(out.senderSignedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.participants[0]).toMatchObject({
      progress: "signed",
      signature: "Synthetic first signature",
      verification: "verified account session",
      version: 1,
    });
    expect(out.participants[1].progress).toBe("waiting");
    expect(out.senderReleasePending).toBe(true);
    expect("rowVersion" in out).toBe(false);
    // One compare-and-set (Ruling A6).
    expect((await deps.store.getAgreement(a.workspaceId, a.id))!.rowVersion).toBe(before!.rowVersion + 1);

    const pdf = await artifactBytes(deps.store, OWNER, a.id, "source");
    expect(await textOf(pdf)).toContain("Synthetic first signature");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(out.senderSignedHash);

    const p = out.participants[0];
    const events = out.events.slice(-4);
    expect(out.events).toHaveLength(a.events.length + 4);
    expect(events.map((e) => [e.type, e.actor])).toEqual([
      ["Sender account verified for first signature", OWNER.email],
      ["Document viewed by verified recipient", OWNER.email],
      ["Signature accepted", OWNER.email],
      ["Sender-signed PDF persisted", OWNER.email],
    ]);
    expect(events[0].detail).toEqual({ recipientId: p.id });
    expect(events[1].detail).toEqual({ recipientId: p.id, sourceHash: a.frozen!.sourceHash });
    expect(events[2].detail).toMatchObject({
      recipientId: p.id,
      submissionId: p.submissionId,
      sourceHash: a.frozen!.sourceHash,
      consent: CONSENT,
      verification: "verified account session",
      signatureHash: sha("Synthetic first signature"),
    });
    expect(events[3].detail).toEqual({ sourceHash: out.senderSignedHash });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4].map((n) => a.events.at(-1)!.seq + n));

    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
    expect(resend.calls).toHaveLength(0);
  });

  it("twice: the second returns the same sender-signed hash with no new events", async () => {
    const { deps, a } = await signFirstSent();
    const first = await signFirst(deps, OWNER, a.id, consented(a));
    const second = await signFirst(deps, OWNER, a.id, consented(a, { signature: "Another" }));
    expect(second.senderSignedHash).toBe(first.senderSignedHash);
    expect(second.events).toEqual(first.events);
    expect(second.participants[0].signature).toBe("Synthetic first signature");
  });

  it("two at once: one signature is accepted; the other is the same result or 409 'Signing state changed.'", async () => {
    const { deps, a } = await signFirstSent();
    const results = await Promise.allSettled([signFirst(deps, OWNER, a.id, consented(a)), signFirst(deps, OWNER, a.id, consented(a))]);
    const won = results.filter((r): r is PromiseFulfilledResult<Agreement> => r.status === "fulfilled");
    expect(won.length).toBeGreaterThan(0);
    for (const r of results)
      if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409, message: "Signing state changed." });
    const got = await getAgreement(deps.store, OWNER, a.id);
    expect(got.senderSignedHash).toBe(won[0].value.senderSignedHash);
    expect(got.events.filter((e) => e.type === "Signature accepted")).toHaveLength(1);
  });

  it("validates a drawing first, as SR's route does", async () => {
    const { deps, a } = await signFirstSent();
    await expect(signFirst(deps, OWNER, a.id, consented(a, { drawing: "data:image/gif;base64,AAAA" }))).rejects.toMatchObject({
      status: 400,
      message: "Use a small PNG signature drawing.",
    });
    expect((await getAgreement(deps.store, OWNER, a.id)).participants[0].progress).toBe("waiting");
  });

  it("an agreement not sent sign-first is 409 'This document is not waiting for your first signature.'", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    let a = await madeDraft(m.deps, client.id, { recipients: 2 });
    a = await sent(m.deps, a);
    await expect(signFirst(m.deps, OWNER, a.id, consented(a))).rejects.toMatchObject({
      status: 409,
      message: "This document is not waiting for your first signature.",
    });
  });

  it("the store refuses to replace the sender-signed PDF reference (SR 'Database refuses replacement')", async () => {
    const { deps, a } = await signFirstSent();
    await signFirst(deps, OWNER, a.id, consented(a));
    const row = (await deps.store.getAgreement(a.workspaceId, a.id))!;
    await expect(deps.store.updateAgreement(a.workspaceId, a.id, row.rowVersion, { senderSignedHash: "0".repeat(64) })).rejects.toThrow(
      "Sender-signed document is immutable.",
    );
  });
});

describe("releaseFirst", () => {
  it("invites signer 2 once, by email with #access=, and records the release last", async () => {
    const { deps, a, resend } = await signFirstSent();
    const signed = await signFirst(deps, OWNER, a.id, consented(a));
    const out = await releaseFirst(deps, OWNER, a.id, ORIGIN);
    expect(out.senderReleasePending).toBe(false);
    expect(out.senderSignedHash).toBe(signed.senderSignedHash);
    expect(out.sentAt).toBeTruthy();
    expect(out.lastReminderAt).toBe(out.sentAt);
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].participantId).toBe(a.participants[1].id);
    expect(out.participants[1]).toMatchObject({ progress: "invited", version: 1 });
    expect(out.participants[0].progress).toBe("signed");
    const sentMail = mails(resend);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toEqual(["counterparty@example.test"]);
    expect(sentMail[0].text).toContain(ORIGIN + "/sign#access=");
    // The release is the last request event; the inline run then records the provider's acceptance.
    expect(out.events.at(-1)!).toMatchObject({ type: "Email accepted by provider", detail: { recipientId: a.participants[1].id } });
    const last = out.events.at(-2)!;
    expect(last).toMatchObject({
      type: "Sender released signed document for counter-signature",
      actor: OWNER.email,
      detail: { sourceHash: signed.senderSignedHash },
    });
    // Released once: a second release is refused.
    await expect(releaseFirst(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "Sign the document first before sending it to the other company.",
    });
  });
  it("with no Resend key: 503 before anything is released (Ruling A5)", async () => {
    const { deps, a, resend } = await signFirstSent();
    await signFirst(deps, OWNER, a.id, consented(a));
    const before = await getAgreement(deps.store, OWNER, a.id);
    deps.resendKey = undefined;
    await expect(releaseFirst(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({ status: 503, message: UNAVAILABLE_MESSAGE });
    const after = await getAgreement(deps.store, OWNER, a.id);
    expect(after.senderReleasePending).toBe(true);
    expect(after.events).toEqual(before.events);
    expect(after).toEqual(before);
    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
    expect(await deps.store.listAgreementDeliveries(a.id)).toEqual([]);
    expect(resend.calls).toHaveLength(0);
  });
});

describe("who may act", () => {
  it("a Member who is not the sender gets 404 on sign-first and release-first", async () => {
    const { deps, a } = await signFirstSent();
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    const store = deps.store;
    const asMember = {
      ...deps,
      store: withMemberRole(store, member.id),
    };
    const notFound = { status: 404, message: "Agreement not found." };
    await expect(signFirst(asMember, member, a.id, consented(a))).rejects.toMatchObject(notFound);
    await signFirst(deps, OWNER, a.id, consented(a));
    await expect(releaseFirst(asMember, member, a.id, ORIGIN)).rejects.toMatchObject(notFound);
    expect((await getAgreement(store, OWNER, a.id)).senderReleasePending).toBe(true);
  });

  it("the workspace Owner who is not the sender gets SR's 409s on sign-first and release-first", async () => {
    const m = mailSetup();
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    const store = m.store;
    const asMember = {
      ...m.deps,
      store: withMemberRole(store, member.id),
    };
    const client = await newClient(store);
    let a = await madeDraft(asMember, client.id, { recipients: 2, user: member });
    a = (await agreementAction(asMember.store, member, a.id, "save", {
      ...a,
      senderFirst: true,
      participants: [{ ...a.participants[0], email: member.email }, a.participants[1]],
    })) as Agreement;
    a = await sent(asMember, a, { user: member });
    expect(a.senderReleasePending).toBe(true);
    await expect(signFirst(m.deps, OWNER, a.id, consented(a))).rejects.toMatchObject({
      status: 409,
      message: "This document is not waiting for your first signature.",
    });
    await signFirst(asMember, member, a.id, consented(a));
    await expect(releaseFirst(m.deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "Sign the document first before sending it to the other company.",
    });
    const got = await getAgreement(store, OWNER, a.id);
    expect(got.senderReleasePending).toBe(true);
    expect(got.events.filter((e) => e.type === "Signature accepted")).toHaveLength(1);
    expect(await store.listSignTokens(a.id)).toEqual([]);
  });
});

// ------------------------------------------------------------ acceptSignature (SR guest.ts 224–288)

const P1 = "p1",
  P2 = "p2";
const field = (id: string, participantId: string, kind: Field["kind"], label: string, page: number, y: number, required = true): Field => ({
  id,
  participantId,
  kind,
  label,
  page,
  x: 0.1,
  y,
  width: 0.3,
  height: 0.04,
  required,
});

function frozenAgreement(over: Partial<Agreement> = {}): Agreement {
  const participants: Participant[] = [
    { id: P1, name: "One", email: "one@example.test", role: "signer", order: 1, progress: "viewed", version: 1 },
    { id: P2, name: "Two", email: "two@example.test", role: "signer", order: 2, progress: "waiting", version: 0 },
  ];
  const fields = [
    field("date", P1, "date_signed", "date signed", 2, 0.5),
    field("sig", P1, "signature", "signature", 1, 0.2),
    field("name", P1, "full_name", "Full name", 1, 0.3),
    field("tick", P1, "checkbox", "I agree", 2, 0.1, false),
    field("other", P2, "signature", "signature", 1, 0.6),
  ];
  return {
    id: "a1",
    workspaceId: "w1",
    senderId: "u1",
    clientId: "c1",
    type: "NDA",
    title: "T",
    status: "Awaiting signatures",
    revision: 3,
    content: "",
    sourceKind: "authored",
    pages: [
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ],
    participants,
    fields,
    sequential: false,
    deadline: "",
    reminderDays: 3,
    subject: "",
    message: "",
    created: "2026-11-01T00:00:00.000Z",
    updated: "2026-11-01T00:00:00.000Z",
    events: [],
    legalHold: false,
    frozen: {
      sourceHash: "a".repeat(64),
      snapshotHash: "b".repeat(64),
      consent: CONSENT,
      revision: 3,
      participants,
      fields,
      settings: { sequential: false, deadline: "" },
    },
    ...over,
  };
}

const AT = "2026-11-17T10:11:12.000Z";
const signBody = (extra: Record<string, unknown> = {}) => ({
  signature: "  Synthetic Signer  ",
  values: { name: "  Ada Lovelace " },
  consent: true,
  consentVersion: CONSENT.version,
  sourceHash: "a".repeat(64),
  ...extra,
});

describe("acceptSignature", () => {
  it("accepts: the participant's fields in page order, trimmed, dated, with SR's detail; the agreement is not touched", () => {
    const a = frozenAgreement();
    const copy = structuredClone(a);
    const { participant, detail } = acceptSignature(a, P1, signBody({ values: { name: "  Ada Lovelace ", tick: "yes" } }), AT);
    expect(a).toEqual(copy);
    const accepted = { sig: "Synthetic Signer", name: "Ada Lovelace", tick: true, date: "2026-11-17" };
    expect(participant).toMatchObject({
      id: P1,
      progress: "signed",
      signature: "Synthetic Signer",
      signedAt: AT,
      values: accepted,
    });
    expect(participant.drawing).toBeUndefined();
    expect(participant.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(participant.values!)).toEqual(["sig", "name", "tick", "date"]);
    expect(detail).toEqual({
      recipientId: P1,
      submissionId: participant.submissionId,
      sourceHash: "a".repeat(64),
      consent: CONSENT,
      verification: "email access verified",
      valuesHash: sha(JSON.stringify(accepted)),
      signatureHash: sha("Synthetic Signer"),
    });
  });

  it("keeps a recorded verification, and a valid drawing with its hash", () => {
    const drawing = "data:image/png;base64,iVBORw0KGgo=";
    const a = frozenAgreement();
    a.participants[0] = { ...a.participants[0], verification: "verified account session" };
    const { participant, detail } = acceptSignature(a, P1, signBody({ drawing }), AT);
    expect(participant.drawing).toBe(drawing);
    expect(detail).toMatchObject({ verification: "verified account session", drawingHash: sha(drawing) });
  });

  it("checks the source against the sender-signed hash once there is one", () => {
    const a = frozenAgreement({ senderSignedHash: "c".repeat(64) });
    expect(() => acceptSignature(a, P1, signBody(), AT)).toThrow("Review the current document and give explicit consent.");
    expect(acceptSignature(a, P1, signBody({ sourceHash: "c".repeat(64) }), AT).detail.sourceHash).toBe("c".repeat(64));
  });

  it("refuses with SR's sentences", () => {
    const a = frozenAgreement();
    const refuse = (body: Record<string, unknown>, status: number, message: string, ag = a) => {
      let err: unknown;
      try {
        acceptSignature(ag, P1, body, AT);
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ status, message });
    };
    refuse(signBody({ values: { other: "x" } }), 403, "You can complete only your assigned fields.");
    refuse(signBody({ values: {} }), 400, "Complete Full name.");
    refuse(signBody({ values: { name: "   " } }), 400, "Complete Full name.");
    refuse(signBody({ signature: "x".repeat(151) }), 400, "Enter your typed signature (150 characters or fewer).");
    refuse(signBody({ signature: "   " }), 400, "Enter your typed signature (150 characters or fewer).");
    refuse(signBody({ consent: false }), 400, "Review the current document and give explicit consent.");
    refuse(signBody({ consentVersion: "2020-01-v0" }), 400, "Review the current document and give explicit consent.");
    refuse(signBody({ values: { name: "x".repeat(501) } }), 400, "Full name is too long.");
    refuse(signBody({ drawing: "data:image/gif;base64,AAAA" }), 400, "Use a smaller PNG signature image.");
    refuse(signBody({ drawing: "data:image/png;base64," + "A".repeat(200000) }), 400, "Use a smaller PNG signature image.");
    const signed = frozenAgreement();
    signed.participants[0] = { ...signed.participants[0], progress: "signed" };
    refuse(signBody(), 409, "Your signature has already been recorded.", signed);
    expect(acceptSignature(a, P1, signBody({ signature: "x".repeat(150) }), AT).participant.signature).toHaveLength(150);
  });

  it("a required checkbox must be ticked", () => {
    const a = frozenAgreement();
    a.frozen!.fields = a.frozen!.fields.map((f) => (f.id === "tick" ? { ...f, required: true } : f));
    expect(() => acceptSignature(a, P1, signBody(), AT)).toThrow("Complete I agree.");
  });
});
