// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { billingAction, billingArtifact, billingPreview } from "../../../../api/_signroom/billing";
import { PDFDocument } from "pdf-lib";
import { workspaceAction } from "../../../../api/_signroom/workspace";
import type { Store } from "../../../../api/_signroom/store";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import { withMemberRole, companyClient, seededStore, WS } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const JPG =
  "data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z";

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

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const LINES = [{ description: "Consulting", quantity: "1", rate: "100.00" }];

async function setup(store: Store = seededStore(owner)) {
  const client = await companyClient(store, owner);
  const draft = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id })) as Invoice;
  return { store, client, draft };
}
async function saved(store: Store, d: Invoice, lines: unknown[] = LINES) {
  return (await billingAction(store, owner, "POST", d.id, "save", {
    revision: d.revision,
    currency: "GBP",
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    lines,
    taxPercent: "0",
  })) as Invoice;
}
const issue = (store: Store, i: Invoice, extra: Record<string, unknown> = {}) =>
  billingAction(store, owner, "POST", i.id, "issue", { revision: i.revision, ...extra }) as Promise<Invoice>;
const pay = (store: Store, i: Invoice, amount: string, extra: Record<string, unknown> = {}) =>
  billingAction(store, owner, "POST", i.id, "payment", { revision: i.revision, amount, paidOn: day(0), ...extra }) as Promise<Invoice>;

describe("billingAction", () => {
  it("leaves the logo out of every invoice in the list, but keeps it on a single invoice", async () => {
    const { store, draft } = await setup();
    const ws = (await store.getWorkspace(WS))!;
    await store.updateWorkspace(ws.id, { logo: JPG });
    const i = await issue(store, await saved(store, draft));
    const list = (await billingAction(store, owner, "GET", undefined, undefined, {})) as Invoice[];
    expect(list).toHaveLength(1);
    expect(list[0].branding).toBeDefined();
    expect("logo" in list[0].branding!).toBe(false);
    expect(JSON.stringify(list)).not.toContain("data:image");
    const one = (await billingAction(store, owner, "GET", i.id, undefined, {})) as Invoice;
    expect(one.branding?.logo).toBe(JPG);
  });

  it("creates a numbered GBP draft due 30 days on", async () => {
    const { draft } = await setup();
    expect(draft.status).toBe("Draft");
    expect(draft.number).toBe(`INV-${new Date().getFullYear()}-00001`);
    expect(draft.currency).toBe("GBP");
    expect(draft.dueDate).toBe(day(30));
    expect(draft.createdBy).toBe(owner.id);
  });

  it("refuses create without an existing client", async () => {
    const store = seededStore(owner);
    await expect(billingAction(store, owner, "POST", undefined, undefined, { clientId: "nope" })).rejects.toThrow(
      "Choose an existing client.",
    );
  });

  it("refuses a stale revision, JPY and a due date before the issue date", async () => {
    const { store, draft } = await setup();
    const ok = await saved(store, draft);
    await expect(
      billingAction(store, owner, "POST", ok.id, "save", { revision: draft.revision, currency: "GBP", issueDate: day(0), dueDate: day(1), lines: LINES }),
    ).rejects.toMatchObject({ status: 409, message: "Only the current draft can be edited. Reload this invoice." });
    await expect(
      billingAction(store, owner, "POST", ok.id, "save", { revision: ok.revision, currency: "JPY", issueDate: day(0), dueDate: day(1), lines: LINES }),
    ).rejects.toThrow("Choose a supported two-decimal currency.");
    await expect(
      billingAction(store, owner, "POST", ok.id, "save", { revision: ok.revision, currency: "GBP", issueDate: day(2), dueDate: day(1), lines: LINES }),
    ).rejects.toThrow("The due date cannot precede the invoice date.");
  });

  it("refuses to issue an empty draft", async () => {
    const { store, draft } = await setup();
    await expect(issue(store, draft)).rejects.toMatchObject({
      status: 409,
      message: "Save a non-zero invoice draft before issuing it.",
    });
  });

  it("issue freezes branding and customer and sets the hash", async () => {
    const { store, draft } = await setup();
    const out = await issue(store, await saved(store, draft));
    expect(out.status).toBe("Issued");
    expect(out.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.customer?.name).toBe("Bloom & Co.");
    expect(out.branding?.companyName).toBeTruthy();
    expect(out.issuedAt).toBeTruthy();
  });

  it("issue with a confirmed full receipt gives Paid and receipt R01", async () => {
    const { store, draft } = await setup();
    const d = await saved(store, draft);
    await expect(issue(store, d, { createReceipt: true, payment: { amount: "100.00", paidOn: day(0) } })).rejects.toThrow(
      "Confirm the payment has been received before creating its receipt.",
    );
    const out = await issue(store, d, { createReceipt: true, payment: { amount: "100.00", paidOn: day(0), confirmed: true } });
    expect(out.status).toBe("Paid");
    expect(out.payments[0].receiptNumber).toBe(`${out.number}-R01`);
    expect(out.payments[0].receiptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses over-balance and future-dated payments, numbers R02 and reaches Paid", async () => {
    const { store, draft } = await setup();
    let i = await issue(store, await saved(store, draft));
    await expect(pay(store, i, "100.01")).rejects.toThrow(
      "Payment must be positive and no larger than the outstanding balance.",
    );
    await expect(pay(store, i, "10.00", { paidOn: day(1) })).rejects.toThrow("A received payment cannot have a future date.");
    i = await pay(store, i, "40.00");
    expect(i.status).toBe("Part paid");
    expect(i.payments[0].receiptNumber).toBe(`${i.number}-R01`);
    i = await pay(store, i, "60.00");
    expect(i.status).toBe("Paid");
    expect(i.payments[1].receiptNumber).toBe(`${i.number}-R02`);
  });

  it("refuses to void with a payment and voids when unpaid", async () => {
    const { store, draft } = await setup();
    const a = await issue(store, await saved(store, draft));
    const paid = await pay(store, a, "10.00");
    await expect(billingAction(store, owner, "POST", paid.id, "void", {})).rejects.toThrow(
      "Only an unpaid issued invoice can be voided. Paid records must be retained.",
    );
    const d2 = (await billingAction(store, owner, "POST", undefined, undefined, { clientId: draft.clientId })) as Invoice;
    const b = await issue(store, await saved(store, d2));
    const v = (await billingAction(store, owner, "POST", b.id, "void", {})) as Invoice;
    expect(v.status).toBe("Voided");
  });

  it("two issues with the same revision: one wins, one hash", async () => {
    const { store, draft } = await setup();
    const d = await saved(store, draft);
    const r = await Promise.allSettled([issue(store, d), issue(store, d)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    const final = (await billingAction(store, owner, "GET", d.id, undefined, {})) as Invoice;
    expect(final.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("members only see invoices they created", async () => {
    const { store } = await setup();
    const member = withMemberRole(store, "m1");
    const m = { id: "m1", email: "m@example.com", workspaceId: WS };
    expect(await billingAction(member, m, "GET", undefined, undefined, {})).toHaveLength(0);
    expect(await billingAction(member, owner, "GET", undefined, undefined, {})).toHaveLength(1);
  });
});

describe("artifacts", () => {
  it("renders a moved invoice once, then serves the stored copy", async () => {
    const store = seededStore(owner);
    const { draft } = await setup(store);
    const issued = await issue(store, await saved(store, draft));
    // Simulate an invoice moved from the old tool: issued, no hash.
    const ws = (await store.getWorkspace(WS))!;
    const { id: _i, payments: _p, events: _e, ...rest } = issued;
    const moved = await store.insertInvoice(
      { ...rest, number: "OLD-1", invoiceHash: undefined },
      { at: new Date().toISOString(), type: "Moved", actor: "system" },
    );
    expect(moved.invoiceHash).toBeFalsy();
    const spy = vi.spyOn(store, "putBlob");
    const a = await billingArtifact(store, owner, moved.id);
    expect(spy).toHaveBeenCalledTimes(1);
    const after = await store.getInvoice(ws.id, moved.id);
    expect(after?.invoiceHash).toMatch(/^[0-9a-f]{64}$/);
    const b = await billingArtifact(store, owner, moved.id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    // Viewing changes neither the revision nor the history, so a payment made from the open screen still works.
    expect(after?.revision).toBe(moved.revision);
    expect(after?.events).toHaveLength(moved.events.length);
    const paid = await pay(store, moved, "10.00");
    expect(paid.payments).toHaveLength(1);
  });

  it("renders each moved receipt with only the payments before it", async () => {
    const store = seededStore(owner);
    const { draft } = await setup(store);
    const issued = await issue(store, await saved(store, draft));
    const mk = (id: string, n: string, at: string) => ({
      id, amountMinor: 5000, paidOn: day(0), reference: "", method: "Bank", receiptNumber: issued.number + n, receiptHash: "", recordedAt: at,
    });
    let cur = issued;
    for (const [id, n, status] of [["pay-1", "-R01", "Part paid"], ["pay-2", "-R02", "Paid"]] as const) {
      await store.recordPayment(cur.id, cur.revision, mk(id, n, new Date().toISOString()), status, { at: new Date().toISOString(), type: "Moved", actor: "system" });
      cur = (await store.getInvoice(issued.workspaceId, issued.id))!;
    }
    const first = await textOf(await billingArtifact(store, owner, issued.id, "pay-1"));
    expect(first).toContain("Previously received GBP 0.00");
    expect(first).toContain("Remaining balance GBP 50.00");
    const second = await textOf(await billingArtifact(store, owner, issued.id, "pay-2"));
    expect(second).toContain("Previously received GBP 50.00");
    expect(second).toContain("Remaining balance GBP 0.00");
  });

  it("serves the already-stored invoice PDF when another request got there first", async () => {
    const store = seededStore(owner);
    const { draft } = await setup(store);
    const issued = await issue(store, await saved(store, draft));
    const { id: _i, payments: _p, events: _e, ...rest } = issued;
    const moved = await store.insertInvoice({ ...rest, number: "OLD-2", invoiceHash: undefined }, { at: new Date().toISOString(), type: "Moved", actor: "system" });
    const theirs = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
    const racing: Store = {
      ...store,
      setInvoiceHash: async (id, hash) => {
        await store.setInvoiceHash(id, await store.putBlob(moved.workspaceId, theirs));
        return store.setInvoiceHash(id, hash);
      },
    };
    const out = await billingArtifact(racing, owner, moved.id);
    expect(Buffer.from(out).equals(Buffer.from(theirs))).toBe(true);
  });

  it("serves the already-stored receipt PDF when another request got there first", async () => {
    const store = seededStore(owner);
    const { draft } = await setup(store);
    const issued = await issue(store, await saved(store, draft));
    await store.recordPayment(
      issued.id,
      issued.revision,
      { id: "pay-1", amountMinor: 1000, paidOn: day(0), reference: "", method: "Bank", receiptNumber: issued.number + "-R01", receiptHash: "", recordedAt: new Date().toISOString() },
      "Part paid",
      { at: new Date().toISOString(), type: "Moved", actor: "system" },
    );
    const theirs = new Uint8Array([37, 80, 68, 70, 9, 9]);
    const racing: Store = {
      ...store,
      setReceiptHash: async (id, hash) => {
        await store.setReceiptHash(id, await store.putBlob(issued.workspaceId, theirs));
        return store.setReceiptHash(id, hash);
      },
    };
    const out = await billingArtifact(racing, owner, issued.id, "pay-1");
    expect(Buffer.from(out).equals(Buffer.from(theirs))).toBe(true);
  });

  it("previews a draft without storing a blob", async () => {
    const { store, draft } = await setup();
    const d = await saved(store, draft);
    const spy = vi.spyOn(store, "putBlob");
    const bytes = await billingPreview(store, owner, d.id);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a brand-new workspace's invoice PDF carries the workspace name", async () => {
    const { store, draft } = await setup();
    const i = await issue(store, await saved(store, draft));
    const text = await textOf(await billingArtifact(store, owner, i.id));
    expect(text).toContain("Acme Studio");
  });

  it("renders an issued invoice whose branding has a real JPEG logo", async () => {
    const { store, draft } = await setup();
    const ws = (await store.getWorkspace(WS))!;
    await store.updateWorkspace(ws.id, { logo: JPG });
    const i = await issue(store, await saved(store, draft));
    expect(i.branding?.logo).toBe(JPG);
    const bytes = await billingArtifact(store, owner, i.id);
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("returns a receipt by payment id and 409 for a draft", async () => {
    const { store, draft } = await setup();
    const d = await saved(store, draft);
    await expect(billingArtifact(store, owner, d.id)).rejects.toMatchObject({ status: 409, message: "This PDF is not ready." });
    const p = await pay(store, await issue(store, d), "10.00");
    const bytes = await billingArtifact(store, owner, p.id, p.payments[0].id);
    expect(await textOf(bytes)).toContain("R01");
  });

  describe("letterhead", () => {
    const SENTENCE = "Your letterhead PDF could not be read. Choose it again in Settings.";
    async function a4(): Promise<Uint8Array> {
      const d = await PDFDocument.create();
      d.addPage([595.28, 841.89]).drawRectangle({ x: 0, y: 800, width: 595, height: 40 });
      return d.save();
    }
    /** A workspace whose branding uses a stored letterhead; `keepBlob: false` makes the file unreadable from storage. */
    async function withLetterhead(keepBlob: boolean) {
      const { store, draft } = await setup();
      const ws = (await store.getWorkspace(WS))!;
      const hash = await store.putBlob(ws.id, await a4());
      await store.addTemplateFile({ workspaceId: ws.id, hash, name: "letterhead.pdf", sizeBytes: 1, scanEngine: "test" });
      await workspaceAction(store, owner, "branding", { companyName: "Bloom Ltd", backgroundTemplate: { hash } });
      if (!keepBlob) {
        const real = store.getBlob.bind(store);
        store.getBlob = async (w, h) => {
          if (h === hash) throw new Error("Blob not found.");
          return real(w, h);
        };
      }
      return { store, ws, draft: await saved(store, draft) };
    }

    it("issues an invoice drawn on the letterhead", async () => {
      const { store, draft } = await withLetterhead(true);
      const issued = await issue(store, draft);
      expect(issued.status).toBe("Issued");
      const bytes = await billingArtifact(store, owner, issued.id);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
      expect(await textOf(bytes)).toContain(issued.number);
    });

    it("refuses to issue when the letterhead file is missing, and leaves the draft alone", async () => {
      const { store, draft } = await withLetterhead(false);
      const spy = vi.spyOn(store, "issueInvoice");
      await expect(issue(store, draft)).rejects.toMatchObject({ message: SENTENCE, status: 400 });
      expect(spy).not.toHaveBeenCalled();
      const after = (await billingAction(store, owner, "GET", draft.id, undefined, {})) as Invoice;
      expect(after.status).toBe("Draft");
      expect(after.revision).toBe(draft.revision);
    });

    it("serves an issued invoice's first stored PDF byte for byte after branding changes", async () => {
      const { store, draft } = await withLetterhead(true);
      const issued = await issue(store, draft);
      const first = await billingArtifact(store, owner, issued.id);
      await workspaceAction(store, owner, "branding", { companyName: "Another Name Ltd", color: "#aa0000", backgroundTemplate: null });
      const second = await billingArtifact(store, owner, issued.id);
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    });
  });
});

describe("billingAction: London's calendar date (D3)", () => {
  it("at 23:30 UTC on 30 June a payment dated 1 July counts, a new draft starts on 1 July, 2 July is still future", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-06-30T23:30:00Z"));
      const { store, draft } = await setup();
      expect(draft.issueDate).toBe("2026-07-01");
      expect(draft.dueDate).toBe("2026-07-31");
      const i = await issue(store, await saved(store, draft));
      const paid = await billingAction(store, owner, "POST", i.id, "payment", { revision: i.revision, amount: "10", paidOn: "2026-07-01" });
      expect((paid as Invoice).payments).toHaveLength(1);
      await expect(
        billingAction(store, owner, "POST", (paid as Invoice).id, "payment", { revision: (paid as Invoice).revision, amount: "10", paidOn: "2026-07-02" }),
      ).rejects.toThrow("A received payment cannot have a future date.");
    } finally {
      vi.useRealTimers();
    }
  });
});
