// @vitest-environment node
// The live preview of a draft agreement: the text being typed, drawn as the
// PDF it would become, with the workspace's letterhead. Nothing is stored and
// the draft is not changed.
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { agreementAction, createAgreement, getAgreement, NOT_FOUND } from "../../../../api/_signroom/agreements";
import { previewAgreement, PREVIEW_LIMIT, PREVIEW_TOOL } from "../../../../api/_signroom/agreementDocument";
import type { SignedInUser as User } from "../../../../api/_signroom/context";
import { AppError } from "../../../../api/_signroom/errors";
import type { MailDeps } from "../../../../api/_signroom/mail";
import type { Agreement } from "../../../../api/_signroom/shared/types";
import { madeDraft, mailSetup, newClient, OWNER, sent } from "./agreementFixtures";
import { WS } from "./helpers";

const stranger: User = { id: "nobody", email: "x@example.com", workspaceId: WS };

async function setup() {
  const m = mailSetup();
  const client = await newClient(m.store);
  const a = await createAgreement(m.store, OWNER, { clientId: client.id, type: "Service agreement", title: "Website care" });
  const spend = vi.fn(m.deps.spend!);
  const d: MailDeps = { ...m.deps, spend };
  return { m, d, a, spend };
}

async function refusal(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
}

describe("previewing a draft agreement", () => {
  it("draws the text that was sent as a PDF, and changes nothing", async () => {
    const s = await setup();
    const before = await getAgreement(s.m.store, OWNER, s.a.id);
    const putBlob = vi.spyOn(s.m.store, "putBlob");
    const bytes = await previewAgreement(s.d, OWNER, s.a.id, { title: "Website care", content: "# Terms\nWe look after the website.\n\n- Updates\n- Backups" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Website care");
    // Not stored, and the draft is as it was: no hash, no new revision, no event.
    expect(putBlob).not.toHaveBeenCalled();
    const after = await getAgreement(s.m.store, OWNER, s.a.id);
    expect(after.revision).toBe(before.revision);
    expect(after.documentHash).toBe(before.documentHash);
    expect(after.content).toBe(before.content);
    expect(after.events).toEqual(before.events);
  });

  it("draws the saved text when none is sent", async () => {
    const s = await setup();
    const saved = (await agreementAction(s.m.store, OWNER, s.a.id, "save", { ...s.a, content: "Saved terms." })) as Agreement;
    const bytes = await previewAgreement(s.d, OWNER, saved.id, {});
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("says what is wrong with the text in the same words as preparing does", async () => {
    const s = await setup();
    expect((await refusal(previewAgreement(s.d, OWNER, s.a.id, { content: "   " }))).message).toBe("Write the agreement before preparing the PDF.");
    expect((await refusal(previewAgreement(s.d, OWNER, s.a.id, { content: "Dear {{client_name}}," }))).message).toBe("Resolve all {{placeholders}} before preparing the PDF.");
  });

  it("is for the sender and the workspace owner only", async () => {
    const s = await setup();
    const e = await refusal(previewAgreement(s.d, stranger, s.a.id, { content: "Terms" }));
    expect([403, 404]).toContain(e.status);
    expect(s.spend).not.toHaveBeenCalled();
    expect((await refusal(previewAgreement(s.d, OWNER, "not-an-id", { content: "Terms" }))).message).toBe(NOT_FOUND);
  });

  it("is not offered for a document that was sent: that one is frozen", async () => {
    const m = mailSetup();
    const client = await newClient(m.store);
    const a = await sent(m.deps, await madeDraft(m.deps, client.id));
    const e = await refusal(previewAgreement(m.deps, OWNER, a.id, { content: "Other terms" }));
    expect(e.status).toBe(409);
  });

  it("is limited for each account, so typing cannot keep the server busy", async () => {
    const s = await setup();
    await previewAgreement(s.d, OWNER, s.a.id, { content: "Terms" });
    expect(s.spend).toHaveBeenCalledWith(expect.anything(), PREVIEW_TOOL, expect.stringContaining("u1"), PREVIEW_LIMIT, 10);
    const refused: MailDeps = { ...s.d, spend: async () => ({ ok: false, minutesLeft: 4 }) };
    const e = await refusal(previewAgreement(refused, OWNER, s.a.id, { content: "Terms" }));
    expect(e.status).toBe(429);
  });

  it("never takes a text longer than a document can be", async () => {
    const s = await setup();
    const e = await refusal(previewAgreement(s.d, OWNER, s.a.id, { content: "x".repeat(200001) }));
    expect(e.message).toBe("The document is too long.");
  });
});
