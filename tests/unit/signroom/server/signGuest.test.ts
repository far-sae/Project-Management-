// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction } from "../../../../api/_signroom/agreements";
import { cancelAgreement, resendInvitations } from "../../../../api/_signroom/agreementSend";
import { sha } from "../../../../api/_signroom/billing";
import type { MailDeps } from "../../../../api/_signroom/mail";
import {
  agreementGuestAction,
  agreementGuestArtifactUrl,
  agreementGuestExport,
  CODE_GAP_MS,
  CODE_LIFE_MS,
  MAX_SENDS,
  RECOVER_TOOL,
  SIGN_SESSION_MS,
  type SignGuestAction,
} from "../../../../api/_signroom/signGuest";
import { CONSENT, type Agreement, type Field, type Participant } from "../../../../api/_signroom/shared/types";
import type { StoredAgreement } from "../../../../api/_signroom/store";
import { madeDraft, mailSetup, newClient, ORIGIN, OWNER, sent, type Resend } from "./agreementFixtures";

/**
 * Port of SR tests/v2.integration.ts 416–627, 768–850, 1180–1222 and the
 * session part of 1223–1241: guest signing through emailed codes.
 */

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
});

type Sent = { to: string[]; subject: string; text: string };
const mails = (resend: Resend): Sent[] => resend.calls.map((c) => JSON.parse(String(c.init.body)) as Sent);
const CODE_SUBJECT = "Your TaskCalendar verification code";

/** The raw token from the last email to `email` that carries a link (optionally with a subject prefix). */
function linkFor(resend: Resend, email: string, subject = ""): string {
  const m = mails(resend)
    .filter((x) => x.to[0] === email && x.text.includes("#access=") && x.subject.startsWith(subject))
    .at(-1);
  if (!m) throw new Error("No link for " + email);
  return m.text.split("#access=")[1].trim();
}

/** The 6-digit code from the last code email to `email`. */
function codeFor(resend: Resend, email: string): string {
  const m = mails(resend)
    .filter((x) => x.to[0] === email && x.subject === CODE_SUBJECT)
    .at(-1);
  const code = m?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("No code for " + email);
  return code;
}

const act = (d: MailDeps, action: SignGuestAction, body: Record<string, unknown> = {}, raw?: string) =>
  agreementGuestAction(d, action, body, raw, ORIGIN);

/** Code, then verify: the session's raw value. */
async function verified(t: { deps: MailDeps; resend: Resend }, access: string, email: string): Promise<string> {
  await act(t.deps, "code", { access });
  const out = await act(t.deps, "verify", { access, code: codeFor(t.resend, email) });
  if (!out.session) throw new Error("No session");
  return out.session.raw;
}

type Doc = { sourceHash: string; fields: Field[] };

/** SR signGuest(): the document, then a sign with every field filled. */
async function signAs(d: MailDeps, access: string, session: string, extra: Record<string, unknown> = {}) {
  const doc = (await act(d, "document", { access }, session)).json as unknown as Doc;
  return act(d, "sign", signBody(doc, { access, ...extra }), session);
}

function signBody(doc: Doc, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const values = Object.fromEntries(
    doc.fields.filter((f) => !["signature", "date_signed"].includes(f.kind)).map((f) => [f.id, f.kind === "checkbox" ? true : "Synthetic " + f.kind]),
  );
  return {
    sourceHash: doc.sourceHash,
    consentVersion: CONSENT.version,
    consent: true,
    signature: "Synthetic Signer — TEST ONLY",
    values,
    ...extra,
  };
}

async function setup(opts: { recipients?: number; allFields?: boolean; sequential?: boolean; copies?: number } = {}) {
  const m = mailSetup();
  const client = await newClient(m.store);
  let a = await madeDraft(m.deps, client.id, { recipients: opts.recipients ?? 1, allFields: opts.allFields });
  if (opts.copies) {
    const copies: Participant[] = Array.from({ length: opts.copies }, (_, i) => ({
      id: crypto.randomUUID(),
      name: "Copy " + (i + 1),
      email: `copy-${i + 1}@example.test`,
      role: "copy",
      order: a.participants.length + i + 1,
      progress: "waiting",
      version: 0,
    }));
    a = (await agreementAction(m.store, OWNER, a.id, "save", { ...a, participants: [...a.participants, ...copies] })) as Agreement;
  }
  a = await sent(m.deps, a, { sequential: opts.sequential });
  return { ...m, a };
}

type T = Awaited<ReturnType<typeof setup>>;
const reread = async (t: T): Promise<StoredAgreement> => (await t.store.getAgreement(t.a.workspaceId, t.a.id))!;
const signerOf = (t: T, i: number) => t.a.participants.filter((p) => p.role === "signer")[i];

describe("guest signing: before verification", () => {
  it("intro twice creates no session (SR 'Link scanner entry does not consume invitation')", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    expect((await act(t.deps, "intro", { access })).json).toEqual({ ok: true, purpose: "sign" });
    await act(t.deps, "intro", { access });
    expect(t.store.signSessions()).toHaveLength(0);
  });

  it("the source PDF needs a verified session (SR 'Unverified PDF download denied')", async () => {
    const t = await setup();
    await expect(agreementGuestArtifactUrl(t.deps, undefined, "source")).rejects.toMatchObject({
      status: 401,
      message: "Verify your invited email to continue.",
    });
  });

  it("an unknown link is 410 with SR's sentence", async () => {
    const t = await setup();
    await expect(act(t.deps, "intro", { access: "nope" })).rejects.toMatchObject({
      status: 410,
      message: "This link is expired or has been replaced. Ask the sender to resend it, or recover completion access.",
    });
  });
});

describe("guest signing: codes", () => {
  it("emails a 6-digit code with SR's subject and text, through sendMail as otp", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    await act(t.deps, "code", { access: linkFor(t.resend, p.email) });
    const m = mails(t.resend).at(-1)!;
    expect(m.to).toEqual([p.email]);
    expect(m.subject).toBe(CODE_SUBJECT);
    expect(m.text).toMatch(/^Your code is \d{6}\. It expires in 10 minutes\. This verifies email access, not legal identity\.$/);
    const delivery = (await t.store.listAgreementDeliveries(t.a.id)).at(-1)!;
    expect(delivery).toMatchObject({ purpose: "otp", participantId: p.id, status: "sent" });
  });

  it("a wrong code is 403 and counts one attempt (SR 'Invalid OTP denied and attempt recorded')", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    await act(t.deps, "code", { access });
    await expect(act(t.deps, "verify", { access, code: "000000" })).rejects.toMatchObject({
      status: 403,
      message: "That verification code is incorrect.",
    });
    expect((await t.store.findSignToken(sha(access)))!.attempts).toBe(1);
  });

  it("a second code within 60 s is 429 (SR 'OTP resend is throttled')", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    await act(t.deps, "code", { access });
    await expect(act(t.deps, "code", { access })).rejects.toMatchObject({
      status: 429,
      message: "Please wait one minute before requesting another code.",
    });
  });

  it("the 4th code within the hour is 429, even 60 s apart (Ruling B5)", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    for (let i = 0; i < MAX_SENDS; i++) {
      vi.setSystemTime(start + i * (CODE_GAP_MS + 1000));
      await act(t.deps, "code", { access });
    }
    vi.setSystemTime(start + MAX_SENDS * (CODE_GAP_MS + 1000));
    await expect(act(t.deps, "code", { access })).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts on this link. Ask the sender to resend.",
    });
    vi.setSystemTime(start + 3600000 + 1000);
    await expect(act(t.deps, "code", { access })).resolves.toMatchObject({ json: { ok: true } });
  });

  it("an expired code is refused (SR 'Expired OTP rejected')", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    vi.useFakeTimers({ toFake: ["Date"] });
    await act(t.deps, "code", { access });
    vi.setSystemTime(Date.now() + CODE_LIFE_MS + 1000);
    await expect(act(t.deps, "verify", { access, code: codeFor(t.resend, p.email) })).rejects.toMatchObject({
      status: 403,
      message: "Code expired or attempt limit reached. Request a new code.",
    });
  });

  it("five wrong tries use up the code", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    await act(t.deps, "code", { access });
    for (let i = 0; i < 5; i++) await expect(act(t.deps, "verify", { access, code: "000000" })).rejects.toMatchObject({ status: 403 });
    await expect(act(t.deps, "verify", { access, code: codeFor(t.resend, p.email) })).rejects.toMatchObject({
      status: 403,
      message: "Code expired or attempt limit reached. Request a new code.",
    });
  });

  it("a failed code email resets the code so the visitor may ask again at once", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    t.resend.status = 500;
    await expect(act(t.deps, "code", { access })).rejects.toMatchObject({ status: 502 });
    const tok = (await t.store.findSignToken(sha(access)))!;
    expect(tok.codeExpires).toBe(0);
    expect(tok.codeSent).toBe(0);
    t.resend.status = 200;
    await expect(act(t.deps, "code", { access })).resolves.toMatchObject({ json: { ok: true } });
  });

  it("the code, link and address never reach the log", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    t.resend.status = 500;
    await act(t.deps, "code", { access }).catch(() => undefined);
    t.resend.status = 200;
    await act(t.deps, "code", { access });
    const code = codeFor(t.resend, p.email);
    await act(t.deps, "verify", { access, code: code === "999999" ? "999998" : "999999" }).catch(() => undefined);
    await act(t.deps, "verify", { access, code });
    const seen = JSON.stringify(logged.mock.calls);
    expect(seen).not.toContain(code);
    expect(seen).not.toContain(access);
    expect(seen).not.toContain(p.email);
  });
});

describe("guest signing: verify and document", () => {
  it("verify returns the session raw, marks the signer verified and records SR's event", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    await act(t.deps, "code", { access });
    const out = await act(t.deps, "verify", { access, code: codeFor(t.resend, p.email) });
    expect(out.json).toEqual({ ok: true });
    expect(out.session!.raw).toMatch(/^[\w-]{43}$/);
    expect(out.session!.expires).toBeGreaterThan(Date.now() + SIGN_SESSION_MS - 5000);
    const s = t.store.signSessions()[0];
    expect(s.digest).toBe(sha(out.session!.raw));
    expect(s).toMatchObject({ purpose: "sign", agreementId: t.a.id, participantId: p.id });
    const a = await reread(t);
    expect(a.participants[0]).toMatchObject({ progress: "verified", verification: "email access verified" });
    const ev = a.events.filter((e) => e.type === "Recipient email access verified");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toEqual({ recipientId: p.id, method: "email access verified" });
    expect((await t.store.findSignToken(sha(access)))!.codeDigest || "").toBe("");
  });

  it("two simultaneous correct verifies give one session (the code is used up by compare-and-set)", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    await act(t.deps, "code", { access });
    const code = codeFor(t.resend, p.email);
    const out = await Promise.allSettled([act(t.deps, "verify", { access, code }), act(t.deps, "verify", { access, code })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect((out.find((o) => o.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
      status: 403,
      message: "Code expired or attempt limit reached. Request a new code.",
    });
    expect(t.store.signSessions()).toHaveLength(1);
    expect((await reread(t)).events.filter((e) => e.type === "Recipient email access verified")).toHaveLength(1);
  });

  it("the signer sees only their own fields, sorted; the first view is recorded once (SR 'Signer sees only assigned fields')", async () => {
    const t = await setup({ recipients: 2, allFields: true, sequential: true });
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    const doc = (await act(t.deps, "document", { access }, session)).json as Record<string, unknown> & Doc;
    expect(doc.fields).toHaveLength(8);
    expect(doc.fields.every((f) => f.participantId === p.id)).toBe(true);
    const sorted = [...doc.fields].sort((x, y) => x.page - y.page || x.y - y.y || x.x - y.x);
    expect(doc.fields.map((f) => f.id)).toEqual(sorted.map((f) => f.id));
    expect(doc).toMatchObject({ id: t.a.id, title: t.a.title, purpose: "sign", name: p.name, email: p.email, othersPending: 2, artifacts: [] });
    expect(doc.sender).toBe((await t.store.getWorkspace(t.a.workspaceId))!.name);
    expect(doc.sourceHash).toBe(t.a.frozen!.sourceHash);
    expect((doc.pages as unknown[]).length).toBe(2);
    let a = await reread(t);
    expect(a.events.filter((e) => e.type === "Document viewed by verified recipient")).toHaveLength(1);
    expect(a.participants[0].progress).toBe("viewed");
    await act(t.deps, "document", { access }, session);
    a = await reread(t);
    expect(a.events.filter((e) => e.type === "Document viewed by verified recipient")).toHaveLength(1);
  });

  it("a session used with another invitation's link is refused", async () => {
    const t = await setup({ recipients: 2 });
    const [p1, p2] = [signerOf(t, 0), signerOf(t, 1)];
    const session = await verified(t, linkFor(t.resend, p1.email), p1.email);
    await expect(act(t.deps, "document", { access: linkFor(t.resend, p2.email) }, session)).rejects.toMatchObject({
      status: 403,
      message: "Verify this invitation to continue.",
    });
  });
});

describe("guest signing: sign", () => {
  it("refuses without consent, another signer's field, and an invalid drawing", async () => {
    const t = await setup({ recipients: 2, allFields: true, sequential: true });
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    const doc = (await act(t.deps, "document", { access }, session)).json as unknown as Doc;
    await expect(act(t.deps, "sign", signBody(doc, { access, consent: false }), session)).rejects.toMatchObject({
      status: 400,
      message: "Review the current document and give explicit consent.",
    });
    const other = t.a.fields.find((f) => f.participantId === signerOf(t, 1).id)!;
    await expect(act(t.deps, "sign", signBody(doc, { access, values: { [other.id]: "tamper" } }), session)).rejects.toMatchObject({
      status: 403,
    });
    await expect(act(t.deps, "sign", signBody(doc, { access, drawing: "data:image/gif;base64,R0lGOD" }), session)).rejects.toMatchObject({
      status: 400,
      message: "Use a smaller PNG signature image.",
    });
    // SR 1180–1205: bytes that are not a PNG are refused before acceptance.
    await expect(act(t.deps, "sign", signBody(doc, { access, drawing: "data:image/png;base64,aW52YWxpZA==" }), session)).rejects.toMatchObject({
      status: 400,
    });
    expect((await reread(t)).participants[0].progress).toBe("viewed");
  });

  it("sequential: the first signature invites the next signer; the last completes and revokes every sign link", async () => {
    const t = await setup({ recipients: 2, allFields: true, sequential: true });
    const [p1, p2] = [signerOf(t, 0), signerOf(t, 1)];
    expect(mails(t.resend).filter((m) => m.to[0] === p2.email)).toHaveLength(0);
    const a1 = linkFor(t.resend, p1.email);
    const first = await signAs(t.deps, a1, await verified(t, a1, p1.email));
    expect(first.json).toEqual({ ok: true, pending: 1 });
    expect(mails(t.resend).filter((m) => m.to[0] === p2.email && m.text.includes("#access="))).toHaveLength(1);
    const a2 = linkFor(t.resend, p2.email);
    const second = await signAs(t.deps, a2, await verified(t, a2, p2.email));
    expect(second.json).toEqual({ ok: true, pending: 0 });
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(a.participants.every((p) => p.progress === "signed")).toBe(true);
    expect((await t.store.listSignTokens(a.id)).filter((x) => x.purpose === "sign").every((x) => x.revoked)).toBe(true);
    const accepted = a.events.filter((e) => e.type === "Signature accepted");
    expect(accepted).toHaveLength(2);
    expect(accepted[0].actor).toBe(p1.email);
  }, 60000);

  it("sequential: when inviting the next signer fails after a signature, Resend invites them", async () => {
    const t = await setup({ recipients: 2, allFields: true, sequential: true });
    const [p1, p2] = [signerOf(t, 0), signerOf(t, 1)];
    const a1 = linkFor(t.resend, p1.email);
    // Before signer 1 signs, Resend does not reach signer 2 (not yet due).
    await resendInvitations(t.deps, OWNER, t.a.id, ORIGIN);
    expect(mails(t.resend).filter((m) => m.to[0] === p2.email)).toHaveLength(0);
    const fresh = linkFor(t.resend, p1.email);
    expect(fresh).not.toBe(a1);
    const session = await verified(t, fresh, p1.email);
    const doc = (await act(t.deps, "document", { access: fresh }, session)).json as unknown as Doc;
    // The signature commits; the step that invites signer 2 then fails.
    vi.spyOn(t.store, "getWorkspace").mockRejectedValueOnce(new Error("down"));
    const first = await act(t.deps, "sign", signBody(doc, { access: fresh }), session);
    expect(first.json).toEqual({ ok: true, pending: 1 });
    expect(logged).toHaveBeenCalledWith("[signroom] after signing failed", "Error");
    const stuck = await reread(t);
    expect(stuck.participants.find((p) => p.id === p2.id)!.progress).toBe("waiting");
    expect(mails(t.resend).filter((m) => m.to[0] === p2.email)).toHaveLength(0);
    expect((await t.store.listSignTokens(t.a.id)).some((x) => x.participantId === p2.id)).toBe(false);

    await resendInvitations(t.deps, OWNER, t.a.id, ORIGIN);
    const after = await reread(t);
    expect(after.participants.find((p) => p.id === p2.id)!.progress).toBe("invited");
    expect(after.participants.find((p) => p.id === p1.id)!.progress).toBe("signed");
    expect(mails(t.resend).filter((m) => m.to[0] === p2.email && m.text.includes("#access="))).toHaveLength(1);
    const a2 = linkFor(t.resend, p2.email);
    const second = await signAs(t.deps, a2, await verified(t, a2, p2.email));
    expect(second.json).toEqual({ ok: true, pending: 0 });
    expect((await reread(t)).status).toBe("Completed");
  }, 60000);

  it("two parallel signers at once: both 200, Completed, one finalise job and one queued event (Review Focus 2)", async () => {
    const t = await setup({ recipients: 2 });
    const people = [signerOf(t, 0), signerOf(t, 1)];
    const links = people.map((p) => linkFor(t.resend, p.email));
    const sessions = [await verified(t, links[0], people[0].email), await verified(t, links[1], people[1].email)];
    const docs = await Promise.all(links.map(async (access, i) => (await act(t.deps, "document", { access }, sessions[i])).json as unknown as Doc));
    const out = await Promise.all(links.map((access, i) => act(t.deps, "sign", signBody(docs[i], { access }), sessions[i])));
    expect(out.map((o) => o.json.ok)).toEqual([true, true]);
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(t.store.jobs().filter((j) => j.dedupe === "finalise:" + a.id)).toHaveLength(1);
    expect(a.events.filter((e) => e.type === "All signers finished; finalisation queued")).toHaveLength(1);
    expect(a.finalSnapshot!.at(-1)!.type).toBe("All signers finished; finalisation queued");
  }, 60000);

  it("a double click gives one 200 and one 409 (Review Focus 2)", async () => {
    const t = await setup({ recipients: 2 });
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    const doc = (await act(t.deps, "document", { access }, session)).json as unknown as Doc;
    const out = await Promise.allSettled([act(t.deps, "sign", signBody(doc, { access }), session), act(t.deps, "sign", signBody(doc, { access }), session)]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409, message: "Your signature has already been recorded." });
    expect((await reread(t)).events.filter((e) => e.type === "Signature accepted")).toHaveLength(1);
  });

  it("a cancel racing a sign leaves one valid outcome (SR 1206–1222)", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    const doc = (await act(t.deps, "document", { access }, session)).json as unknown as Doc;
    const [cancel] = await Promise.allSettled([
      cancelAgreement(t.deps, OWNER, t.a.id, { reason: "Race test" }),
      act(t.deps, "sign", signBody(doc, { access }), session),
    ]);
    const a = await reread(t);
    if (cancel.status === "fulfilled") {
      expect(a.status).toBe("Cancelled");
      expect(a.participants[0].progress).not.toBe("signed");
    } else {
      expect(cancel.reason).toMatchObject({ status: 409 });
      expect(a.participants[0].progress).toBe("signed");
      expect(["Finalising", "Completed"]).toContain(a.status);
    }
  }, 60000);

  it("a participant whose stored version is below the live token's opens and signs (Ruling B3)", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const row = await reread(t);
    expect(row.participants[0].version).toBe(1);
    await t.store.updateAgreement(row.workspaceId, row.id, row.rowVersion, {
      participants: row.participants.map((x) => ({ ...x, version: 0 })),
    });
    const access = linkFor(t.resend, p.email);
    await act(t.deps, "intro", { access });
    const out = await signAs(t.deps, access, await verified(t, access, p.email));
    expect(out.json).toEqual({ ok: true, pending: 0 });
    const a = await reread(t);
    expect(a.status).toBe("Completed");
    expect(a.participants[0].version).toBe(1);
  }, 60000);
});

describe("guest signing: decline", () => {
  it("declines, records the reason, revokes every link and tells the sender", async () => {
    const t = await setup({ recipients: 2 });
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    expect((await act(t.deps, "decline", { access, reason: "Synthetic reason" }, session)).json).toEqual({ ok: true });
    const a = await reread(t);
    expect(a.status).toBe("Declined");
    expect(a.participants[0].progress).toBe("declined");
    const ev = a.events.find((e) => e.type === "Recipient declined")!;
    expect(ev.actor).toBe(p.email);
    expect(ev.detail).toEqual({ reason: "Synthetic reason", recipientId: p.id });
    expect((await t.store.listSignTokens(a.id)).every((x) => x.revoked)).toBe(true);
    const notice = mails(t.resend).filter((m) => m.to[0] === OWNER.email && m.subject === `Declined: ${t.a.title}`);
    expect(notice).toHaveLength(1);
    expect(notice[0].text).toBe(`${p.name} declined. Reason: Synthetic reason. The sender can see this reason.`);
    expect(t.store.jobs().filter((j) => j.dedupe === "notice:declined:" + a.id)).toHaveLength(1);
  });

  it("a failure after the decline committed is logged by name only and still answers ok", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    vi.spyOn(t.store, "revokeSignTokens").mockRejectedValueOnce(new TypeError("boom " + p.email));
    vi.spyOn(t.store, "claimJobs").mockRejectedValueOnce(new RangeError("boom " + p.email));
    expect((await act(t.deps, "decline", { access, reason: "Synthetic reason" }, session)).json).toEqual({ ok: true });
    expect((await reread(t)).status).toBe("Declined");
    const seen = JSON.stringify(logged.mock.calls);
    expect(seen).toContain("TypeError");
    expect(seen).not.toContain(p.email);
    expect(seen).not.toContain("Synthetic reason");
  });
});

describe("guest signing: copy recipients, completion and recovery", () => {
  async function completed() {
    const t = await setup({ copies: 1 });
    const signer = signerOf(t, 0);
    const copy = t.a.participants.find((p) => p.role === "copy")!;
    expect(mails(t.resend).filter((m) => m.to[0] === copy.email)).toHaveLength(0);
    const access = linkFor(t.resend, signer.email);
    await signAs(t.deps, access, await verified(t, access, signer.email));
    expect((await reread(t)).status).toBe("Completed");
    return { t, copy };
  }

  it("a copy recipient gets the completion link, downloads the final PDF and cannot sign (SR 768–806)", async () => {
    const { t, copy } = await completed();
    const access = linkFor(t.resend, copy.email, "Completed:");
    expect((await act(t.deps, "intro", { access })).json).toEqual({ ok: true, purpose: "complete" });
    const session = await verified(t, access, copy.email);
    const a = await reread(t);
    const final = await agreementGuestArtifactUrl(t.deps, session, "final");
    expect(final.filename).toBe("final.pdf");
    expect(new URL(final.url).pathname).toBe(`/signroom/${a.workspaceId}/${a.artifacts!.final}`);
    expect(new URL(final.url).searchParams.get("download")).toBe("final.pdf");
    await expect(act(t.deps, "sign", { access, consent: true }, session)).rejects.toMatchObject({
      status: 403,
      message: "This invitation provides download access only.",
    });
    const doc = (await act(t.deps, "document", { access }, session)).json as Record<string, unknown>;
    expect(doc).toMatchObject({ purpose: "complete", fields: [] });
    expect((doc.artifacts as string[]).sort()).toEqual(Object.keys(a.artifacts!).sort());
  }, 60000);

  it("the evidence export is a signed link for a completion session only", async () => {
    const { t, copy } = await completed();
    const access = linkFor(t.resend, copy.email, "Completed:");
    const session = await verified(t, access, copy.email);
    const a = await reread(t);
    const out = await agreementGuestExport(t.deps, session);
    expect(new URL(out.url).pathname.endsWith(`/${a.workspaceId}/${a.artifacts!.export}`)).toBe(true);
    expect(out.filename).toBe(`signroom-evidence-${a.id}.zip`);
    // A signing session, on another agreement still awaiting signatures.
    const other = await setup();
    const p = signerOf(other, 0);
    const signing = await verified(other, linkFor(other.resend, p.email), p.email);
    await expect(agreementGuestExport(other.deps, signing)).rejects.toMatchObject({ status: 403, message: "Completion access required." });
    await expect(agreementGuestArtifactUrl(other.deps, signing, "final")).rejects.toMatchObject({
      status: 403,
      message: "This access is limited to the source document.",
    });
    const source = await agreementGuestArtifactUrl(other.deps, signing, "source");
    expect(source.filename).toBe("source.pdf");
  }, 60000);

  it("recovery rotates completion access; unknown addresses get the same answer; 3 an hour (SR 807–818)", async () => {
    const { t, copy } = await completed();
    const MESSAGE = "If this address is authorised, a new completion invitation will be emailed to it.";
    const tokensOf = async () => (await t.store.listSignTokens(t.a.id)).filter((x) => x.participantId === copy.id && x.purpose === "complete");
    const before = await tokensOf();
    expect(before.filter((x) => !x.revoked)).toHaveLength(1);
    const out = await act(t.deps, "recover", { agreementId: t.a.id, email: copy.email.toUpperCase() });
    expect(out.json).toEqual({ ok: true, message: MESSAGE });
    const after = await tokensOf();
    expect(after.find((x) => x.id === before[0].id)!.revoked).toBe(true);
    expect(after.filter((x) => !x.revoked)).toHaveLength(1);
    const fresh = linkFor(t.resend, copy.email, "Completed:");
    expect((await act(t.deps, "intro", { access: fresh })).json).toEqual({ ok: true, purpose: "complete" });

    const count = (await t.store.listSignTokens(t.a.id)).length;
    expect((await act(t.deps, "recover", { agreementId: t.a.id, email: "unknown@example.test" })).json).toEqual({ ok: true, message: MESSAGE });
    expect((await act(t.deps, "recover", { agreementId: "not-a-uuid", email: copy.email })).json).toEqual({ ok: true, message: MESSAGE });
    expect((await t.store.listSignTokens(t.a.id)).length).toBe(count);

    for (let i = 0; i < 2; i++) await act(t.deps, "recover", { agreementId: t.a.id, email: "unknown@example.test" });
    await expect(act(t.deps, "recover", { agreementId: t.a.id, email: "unknown@example.test" })).rejects.toMatchObject({
      status: 429,
      message: "Too many requests. Please try again later.",
    });
    expect(RECOVER_TOOL).toBe("signroom-recover");
  }, 60000);

  it("the recovered link uses the agreement's link_origin, whatever origin the request claims (Ruling B6)", async () => {
    const { t, copy } = await completed();
    expect((await reread(t)).linkOrigin).toBe(ORIGIN);
    await agreementGuestAction(t.deps, "recover", { agreementId: t.a.id, email: copy.email }, undefined, "http://localhost:4321");
    const m = mails(t.resend).filter((x) => x.to[0] === copy.email && x.subject.startsWith("Completed:")).at(-1)!;
    expect(m.text).toContain(ORIGIN + "/sign#access=");
    expect(m.text).not.toContain("localhost");
  }, 60000);
});

describe("guest signing: status always checked", () => {
  it("a passed deadline expires the agreement on intro (SR 'Deadline enforced even before scheduled expiry runs')", async () => {
    const t = await setup();
    const access = linkFor(t.resend, signerOf(t, 0).email);
    const real = t.store.getAgreement.bind(t.store);
    vi.spyOn(t.store, "getAgreement").mockImplementation(async (w, id) => {
      const a = await real(w, id);
      return a && { ...a, deadline: "2020-01-01" };
    });
    await expect(act(t.deps, "intro", { access })).rejects.toMatchObject({ status: 410 });
    expect((await real(t.a.workspaceId, t.a.id))!.status).toBe("Expired");
  });

  it("a Cancelled row with a live token: intro is 410 and an open session is 403 (Review Focus 1)", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    const row = await reread(t);
    await t.store.updateAgreement(row.workspaceId, row.id, row.rowVersion, { status: "Cancelled" });
    expect((await t.store.findSignToken(sha(access)))!.revoked).toBe(false);
    await expect(act(t.deps, "intro", { access })).rejects.toMatchObject({
      status: 410,
      message: "This agreement is no longer available for signing.",
    });
    await expect(act(t.deps, "document", { access }, session)).rejects.toMatchObject({
      status: 403,
      message: "Signing access is no longer available.",
    });
  });

  it("resending revokes the old session (SR 593–602)", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    const session = await verified(t, access, p.email);
    await resendInvitations(t.deps, OWNER, t.a.id, ORIGIN);
    await expect(act(t.deps, "document", { access }, session)).rejects.toMatchObject({
      status: 403,
      message: "This access session was revoked. Verify the latest invitation.",
    });
    await expect(act(t.deps, "intro", { access })).rejects.toMatchObject({ status: 410 });
  });

  it("an expired session is 401", async () => {
    const t = await setup();
    const p = signerOf(t, 0);
    const access = linkFor(t.resend, p.email);
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = await verified(t, access, p.email);
    vi.setSystemTime(Date.now() + SIGN_SESSION_MS + 1000);
    await expect(act(t.deps, "document", {}, session)).rejects.toMatchObject({ status: 401, message: "Verify your invited email to continue." });
  });
});
