// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as agreementPdf from "../../../../api/_signroom/agreementPdf";
import * as financial from "../../../../api/_signroom/financialPdf";
import { AppError } from "../../../../api/_signroom/errors";
import { presetDesign } from "../../../../api/_signroom/shared/letterhead";
import { brandingPreview, sessionView, workspaceAction } from "../../../../api/_signroom/workspace";
import { brandingOf } from "../../../../api/_signroom/branding";
import type { Workspace } from "../../../../api/_signroom/shared/types";
import { seededStore, WS2, ORG2, WS } from "./helpers";

const user = { id: "u1", email: "jane@example.com", workspaceId: WS };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==";

vi.mock("../../../../api/_signroom/agreementPdf", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/agreementPdf")>();
  return { ...real, authoredPdf: vi.fn(real.authoredPdf) };
});
vi.mock("../../../../api/_signroom/financialPdf", async (orig) => {
  const real = await orig<typeof import("../../../../api/_signroom/financialPdf")>();
  return { ...real, sampleFinancial: vi.fn(real.sampleFinancial) };
});

describe("sessionView", () => {
  it("creates the workspace on first use and reports the role", async () => {
    const store = seededStore(user, "Design team");
    const v = await sessionView(store, user);
    expect(v.user).toEqual({ id: "u1", email: "jane@example.com" });
    expect(v.role).toBe("Owner");
    expect(v.workspace.id).toBe(WS);
    expect(v.workspace.name).toBe("Design team");
    expect(v.workspaces).toEqual([{ id: WS, name: "Design team", role: "Owner" }]);
  });

  it("returns the logo once, at the top level", async () => {
    const store = seededStore(user);
    await workspaceAction(store, user, "settings", { name: "Co", retentionDays: 365, logo: PNG });
    await workspaceAction(store, user, "branding", { companyName: "Co", logo: PNG });
    const v = await sessionView(store, user);
    expect(v.workspace.logo).toBe(PNG);
    expect(v.workspace.branding).toBeDefined();
    expect(v.workspace.branding && "logo" in v.workspace.branding).toBe(false);
    expect(v.workspaces[0]).toEqual({ id: v.workspace.id, name: "Co", role: "Owner" });
    expect(JSON.stringify(v).split(PNG).length - 1).toBe(1); // the workspace only: the list carries no logo
  });

  it("an organisation member gets the Member role in the same workspace", async () => {
    const store = seededStore(user);
    store.addMember(WS, "u2", "Member");
    const v = await sessionView(store, { id: "u2", email: "sam@example.com", workspaceId: WS });
    expect(v.workspace.id).toBe(WS);
    expect(v.role).toBe("Member");
    expect(v.workspaces).toEqual([{ id: WS, name: "Acme Studio", role: "Member" }]);
  });

  it("there is no fallback: no header, a stale or malformed choice, a viewer and an outsider are all 403", async () => {
    const store = seededStore(user);
    store.seedWorkspace({ id: WS2, organizationId: ORG2, name: "Another company" });
    store.setOrgMember(WS, "viewer", "viewer");
    const refused = { status: 403, message: "Choose a workspace." };
    await expect(sessionView(store, { id: "u1", email: "jane@example.com" })).rejects.toMatchObject(refused);
    for (const workspaceId of [WS2, "not-an-id", "11111111-2222-4333-8444-555555555555"])
      await expect(sessionView(store, { ...user, workspaceId })).rejects.toMatchObject(refused);
    await expect(sessionView(store, { id: "viewer", email: "v@example.com", workspaceId: WS })).rejects.toMatchObject(refused);
    await expect(sessionView(store, { id: "u9", email: "x@example.com", workspaceId: WS })).rejects.toMatchObject(refused);
  });
});

describe("workspaceAction", () => {
  it("email-settings refuses a quote in the sender name", async () => {
    await expect(
      workspaceAction(seededStore(user), user, "email-settings", { senderName: 'A"B', senderEmail: "a@b.co", replyTo: "a@b.co" }),
    ).rejects.toThrow("Enter a sender name without quotes, brackets or line breaks.");
  });

  it("email-settings saves the sender name and reply-to, and reports the one route and whether it is configured", async () => {
    const store = seededStore(user);
    const body = { senderName: "Jane", senderEmail: "Jane@Example.com", replyTo: "reply@example.com" };
    const a = (await workspaceAction(store, user, "email-settings", body)) as { mode: string; ready: boolean; senderEmail: string };
    expect(a).toMatchObject({ ok: true, mode: "securovix", ready: false, senderName: "Jane", senderEmail: "jane@example.com", replyTo: "reply@example.com" });
    const b = (await workspaceAction(store, user, "email-settings", body, { resendKey: "re_test", from: "documents@app.example.com" })) as { mode: string; ready: boolean };
    expect(b).toMatchObject({ mode: "securovix", ready: true });
    const c = (await workspaceAction(store, user, "email-settings", body, { resendKey: undefined, from: "documents@app.example.com" })) as { ready: boolean };
    expect(c.ready).toBe(false);
    const w = (await store.getWorkspace(WS))!;
    expect(w.senderName).toBe("Jane");
    expect(w.replyTo).toBe("reply@example.com");
  });

  it("settings refuses a GIF logo and accepts a real PNG", async () => {
    const store = seededStore(user);
    await expect(workspaceAction(store, user, "settings", { name: "Co", logo: "data:image/gif;base64,AAAA" })).rejects.toThrow(
      "Use a PNG or JPEG logo.",
    );
    const w = (await workspaceAction(store, user, "settings", { name: "Co", retentionDays: 365, logo: PNG })) as Workspace;
    expect(w.name).toBe("Co");
    expect(w.logo).toBe(PNG);
    await expect(workspaceAction(store, user, "settings", { name: "", retentionDays: 365 })).rejects.toThrow(
      "Enter a workspace name and retention between 1 and 3650 days.",
    );
  });

  it("branding saves company name and VAT", async () => {
    const store = seededStore(user);
    const w = (await workspaceAction(store, user, "branding", { companyName: "Bloom Ltd", taxNumber: "GB123" })) as Workspace;
    const b = brandingOf(w);
    expect(b.companyName).toBe("Bloom Ltd");
    expect(b.taxNumber).toBe("GB123");
  });

  it("refuses a Member for every action", async () => {
    const store = seededStore(user);
    store.addMember(WS, "m1", "Member");
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    for (const action of ["settings", "email-settings", "branding"] as const)
      await expect(workspaceAction(store, member, action, {})).rejects.toMatchObject({ status: 403, message: "Only the workspace owner can do that." });
    await expect(brandingPreview(store, member, {})).rejects.toMatchObject({ status: 403 });
  });

  it("the preview draws the agreement sample for previewKind agreement", async () => {
    const store = seededStore(user);
    const bytes = await brandingPreview(store, user, { previewKind: "agreement" });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
    const content = await (await doc.getPage(1)).getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("A clear, consistent company document");
  }, 30000);

  it("the preview still draws the invoice sample for previewKind invoice", async () => {
    const store = seededStore(user);
    vi.mocked(financial.sampleFinancial).mockClear();
    await brandingPreview(store, user, { previewKind: "invoice" });
    expect(financial.sampleFinancial).toHaveBeenCalledWith(expect.anything(), false, expect.anything());
  }, 30000);

  it("the preview gives the same sentence for a design that cannot be drawn", async () => {
    const store = seededStore(user);
    vi.mocked(agreementPdf.authoredPdf).mockRejectedValueOnce(new Error("font failure"));
    await expect(brandingPreview(store, user, { design: presetDesign("classic", brandingOf((await sessionView(store, user)).workspace)) })).rejects.toMatchObject({
      message: "This letterhead design could not be drawn. Please change it and try again.",
      status: 400,
    });
  });

  it("branding refuses a design that cannot be drawn, and saves nothing", async () => {
    const store = seededStore(user);
    await workspaceAction(store, user, "branding", { companyName: "Bloom Ltd" });
    const before = brandingOf((await sessionView(store, user)).workspace);
    const sample = vi.mocked(agreementPdf.authoredPdf).mockRejectedValueOnce(new Error("font failure"));
    const design = presetDesign("classic", before);
    await expect(workspaceAction(store, user, "branding", { companyName: "Changed Ltd", design })).rejects.toMatchObject({
      message: "This letterhead design could not be drawn. Please change it and try again.",
      status: 400,
    });
    expect(sample).toHaveBeenCalled();
    expect(brandingOf((await sessionView(store, user)).workspace)).toEqual(before);
  });

  it("branding lets the letterhead sentence through unchanged", async () => {
    const store = seededStore(user);
    const sentence = "Your letterhead PDF could not be read. Choose it again in Settings.";
    vi.mocked(agreementPdf.authoredPdf).mockRejectedValueOnce(new AppError(sentence));
    const design = presetDesign("classic", brandingOf((await sessionView(store, user)).workspace));
    await expect(workspaceAction(store, user, "branding", { companyName: "Co", design })).rejects.toThrow(sentence);
  });

  it("branding saves a design that draws, and does not draw one when there is no design", async () => {
    const store = seededStore(user);
    const sample = vi.mocked(agreementPdf.authoredPdf).mockClear();
    await workspaceAction(store, user, "branding", { companyName: "Co" });
    expect(sample).not.toHaveBeenCalled();
    const design = presetDesign("classic", brandingOf((await sessionView(store, user)).workspace));
    const w = (await workspaceAction(store, user, "branding", { companyName: "Co", design })) as Workspace;
    expect(sample).toHaveBeenCalledTimes(1);
    expect(brandingOf(w).design).toBeDefined();
  });
});
