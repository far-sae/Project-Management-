// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseStore } from "../../../../api/_signroom/store";
import { fakeStore } from "../../../../api/_signroom/fakeStore";

type Call = { table?: string; rpc?: string; ops: [string, ...unknown[]][]; args?: unknown };

/** A tiny chainable stand-in for the Supabase client: records calls, answers from `results`. */
function fakeSb(results: Record<string, unknown>) {
  const calls: Call[] = [];
  const builder = (call: Call, key: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "in", "is", "order", "limit", "range", "gt", "lt", "lte", "neq", "or", "not"]) {
      b[m] = (...a: unknown[]) => { call.ops.push([m, ...a]); return b; };
    }
    const done = () => {
      const v = results[key];
      const next = v && typeof v === "object" && "__seq" in v ? (v as { __seq: unknown[] }).__seq.shift() : v;
      if (next && typeof next === "object" && "__error" in next) return { data: null, error: (next as { __error: unknown }).__error };
      if (next && typeof next === "object" && "__count" in next) return { data: null, count: (next as { __count: number }).__count, error: null };
      return { data: next ?? null, error: null };
    };
    b.maybeSingle = () => { call.ops.push(["maybeSingle"]); return Promise.resolve(done()); };
    b.single = () => { call.ops.push(["single"]); return Promise.resolve(done()); };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(done()).then(res);
    return b;
  };
  const sb = {
    from(table: string) { const c: Call = { table, ops: [] }; calls.push(c); return builder(c, table); },
    storage: {
      from(bucket: string) {
        const c: Call = { table: `storage:${bucket}`, ops: [] };
        calls.push(c);
        return {
          createSignedUrl: (path: string, seconds: number, options?: unknown) => {
            c.ops.push(["createSignedUrl", path, seconds, options]);
            if (results.__signError) return Promise.resolve({ data: null, error: results.__signError });
            return Promise.resolve({ data: { signedUrl: `https://sb.test/sign/${path}?token=t` }, error: null });
          },
          createSignedUploadUrl: (path: string) => { c.ops.push(["createSignedUploadUrl", path]); return Promise.resolve({ data: { signedUrl: "u", token: "tok", path }, error: null }); },
          remove: (paths: string[]) => { c.ops.push(["remove", paths]); return Promise.resolve({ data: [], error: results.__removeError ?? null }); },
          download: (path: string) => {
            c.ops.push(["download", path]);
            if (results.__downloadError) return Promise.resolve({ data: null, error: results.__downloadError });
            return Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer) }, error: null });
          },
        };
      },
    },
    rpc(fn: string, args: unknown) { calls.push({ rpc: fn, ops: [], args }); return Promise.resolve({ data: results[fn] ?? null, error: null }); },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const row = {
  id: "i1", workspace_id: "w1", client_id: "c1", created_by: "u1", revision: 3, status: "Issued", number: "INV-2026-00001",
  currency: "GBP", issue_date: "2026-11-15", due_date: "2026-12-15", lines: [], tax_bps: 2000, subtotal_minor: 1500,
  tax_minor: 300, total_minor: 1800, notes: "n", project: null, receipt_draft: null, branding: { companyName: "Co" },
  customer: null, invoice_hash: "h", issued_at: "2026-11-15T10:00:00Z", sent_at: null,
  created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-15T10:00:00Z",
  sr_payments: [{ id: "p1", invoice_id: "i1", amount_minor: 500, paid_on: "2026-11-16", reference: null, method: "Bank", receipt_number: "R1", receipt_hash: null, recorded_at: "2026-11-16T09:00:00Z" }],
  sr_invoice_events: [
    { id: "e2", at: "2026-11-16T09:00:00Z", type: "paid", actor: "u1" },
    { id: "e1", at: "2026-11-15T10:00:00Z", type: "issued", actor: "u1" },
  ],
};

describe("supabaseStore", () => {
  it("maps an invoice read from snake_case to camelCase, with payments and events", async () => {
    const { sb, calls } = fakeSb({ sr_invoices: row });
    const inv = await supabaseStore(sb).getInvoice("w1", "i1");
    expect(inv).toMatchObject({
      id: "i1", workspaceId: "w1", clientId: "c1", createdBy: "u1", revision: 3, status: "Issued",
      issueDate: "2026-11-15", dueDate: "2026-12-15", taxBps: 2000, subtotalMinor: 1500, taxMinor: 300, totalMinor: 1800,
      invoiceHash: "h", issuedAt: "2026-11-15T10:00:00Z", created: "2026-11-14T10:00:00Z", updated: "2026-11-15T10:00:00Z",
      branding: { companyName: "Co" },
    });
    expect(inv?.payments).toEqual([
      { id: "p1", amountMinor: 500, paidOn: "2026-11-16", reference: "", method: "Bank", receiptNumber: "R1", receiptHash: "", recordedAt: "2026-11-16T09:00:00Z" },
    ]);
    expect(inv?.events.map((e) => e.type)).toEqual(["issued", "paid"]);
    const ops = calls[0].ops;
    expect(ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(ops).toContainEqual(["eq", "id", "i1"]);
  });

  it("listInvoices reads in pages of 1000 and joins them in order, stopping on a short page", async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, k) => ({ ...row, id: `i${from + k}` }));
    const { sb, calls } = fakeSb({ sr_invoices: { __seq: [page(0, 1000), page(1000, 3)] } });
    const list = await supabaseStore(sb).listInvoices("w1");
    expect(list).toHaveLength(1003);
    expect(list[0].id).toBe("i0");
    expect(list[999].id).toBe("i999");
    expect(list[1000].id).toBe("i1000");
    expect(list[1002].id).toBe("i1002");
    expect(calls).toHaveLength(2);
    expect(calls[0].ops).toContainEqual(["range", 0, 999]);
    expect(calls[1].ops).toContainEqual(["range", 1000, 1999]);
    expect(calls[0].ops).toContainEqual(["order", "id", { ascending: false }]);
  });

  it("listInvoices stops after one short page", async () => {
    const { sb, calls } = fakeSb({ sr_invoices: { __seq: [[row], [{ ...row, id: "never" }]] } });
    const list = await supabaseStore(sb).listInvoices("w1");
    expect(list.map((i) => i.id)).toEqual(["i1"]);
    expect(calls).toHaveLength(1);
  });

  it("returns null for a missing invoice", async () => {
    const { sb } = fakeSb({});
    expect(await supabaseStore(sb).getInvoice("w1", "nope")).toBeNull();
  });

  it("calls sr_issue_invoice with snake_case arguments", async () => {
    const { sb, calls } = fakeSb({ sr_issue_invoice: true });
    const ok = await supabaseStore(sb).issueInvoice(
      "i1", 2,
      { status: "Issued", number: "INV-2026-00001", invoiceHash: "h", issuedAt: "2026-11-15T10:00:00Z", customer: { name: "Acme", contactName: "", email: "a@b.co", companyNumber: "" } },
      { id: "p1", amountMinor: 500, paidOn: "2026-11-16", reference: "r", method: "Bank", receiptNumber: "R1", receiptHash: "", recordedAt: "2026-11-16T09:00:00Z" },
      [{ at: "2026-11-15T10:00:00Z", type: "issued", actor: "u1" }],
    );
    expect(ok).toBe(true);
    expect(calls[0].rpc).toBe("sr_issue_invoice");
    expect(calls[0].args).toEqual({
      p_id: "i1",
      p_revision: 2,
      p_patch: { status: "Issued", number: "INV-2026-00001", invoice_hash: "h", issued_at: "2026-11-15T10:00:00Z", customer: { name: "Acme", contactName: "", email: "a@b.co", companyNumber: "" } },
      p_payment: { id: "p1", amount_minor: 500, paid_on: "2026-11-16", reference: "r", method: "Bank", receipt_number: "R1", receipt_hash: null, recorded_at: "2026-11-16T09:00:00Z" },
      p_events: [{ at: "2026-11-15T10:00:00Z", type: "issued", actor: "u1" }],
    });
  });

  it("passes null payment and reads false from the RPC", async () => {
    const { sb, calls } = fakeSb({ sr_issue_invoice: false });
    expect(await supabaseStore(sb).issueInvoice("i1", 1, { status: "Issued" }, null, [])).toBe(false);
    expect((calls[0].args as { p_payment: unknown }).p_payment).toBeNull();
  });

  it("takes an invoice number through the RPC", async () => {
    const { sb, calls } = fakeSb({ sr_take_invoice_number: "INV-2026-00004" });
    expect(await supabaseStore(sb).takeInvoiceNumber("w1", 2026)).toBe("INV-2026-00004");
    expect(calls[0]).toMatchObject({ rpc: "sr_take_invoice_number", args: { p_workspace: "w1", p_year: 2026 } });
  });

  it("writes NULL, not an empty string, for blank number/dates/currency on insert", async () => {
    const { sb, calls } = fakeSb({ sr_invoices: { id: "i9", workspace_id: "w1", status: "Draft" } });
    await supabaseStore(sb).insertInvoice(
      { workspaceId: "w1", clientId: "c1", createdBy: "u1", revision: 1, status: "Draft", number: "", currency: "", issueDate: "", dueDate: "", lines: [], taxBps: 0, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, notes: "", created: "", updated: "" },
      { at: "2026-11-15T10:00:00Z", type: "created", actor: "u1" },
    );
    const insert = calls[0].ops.find((o) => o[0] === "insert")![1] as Record<string, unknown>;
    expect(insert).toMatchObject({ number: null, currency: null, issue_date: null, due_date: null });
  });

  it("getWorkspace reads one workspace by id, or null", async () => {
    const found = fakeSb({ sr_workspaces: { id: "w1", owner: "u1", created_at: "t" } });
    expect((await supabaseStore(found.sb).getWorkspace("w1"))?.id).toBe("w1");
    expect(found.calls[0].ops).toContainEqual(["eq", "id", "w1"]);
    expect(await supabaseStore(fakeSb({ sr_workspaces: null }).sb).getWorkspace("nope")).toBeNull();
  });

  it("updateTokenIf matches the expected counters and reports whether a row changed", async () => {
    const won = fakeSb({ sr_tokens: [{ id: "t1" }] });
    expect(await supabaseStore(won.sb).updateTokenIf("t1", { attempts: 2, codeSends: 1 }, { attempts: 3 })).toBe(true);
    expect(won.calls[0].ops).toContainEqual(["eq", "attempts", 2]);
    expect(won.calls[0].ops).toContainEqual(["eq", "code_sends", 1]);
    expect(await supabaseStore(fakeSb({ sr_tokens: [] }).sb).updateTokenIf("t1", { attempts: 2, codeSends: 1 }, { attempts: 3 })).toBe(false);
  });

  it("setInvoiceHash only sets an empty hash, with no revision change", async () => {
    const { sb, calls } = fakeSb({ sr_invoices: [{ id: "i1" }] });
    expect(await supabaseStore(sb).setInvoiceHash("i1", "h")).toBe(true);
    expect(calls[0].ops).toContainEqual(["update", { invoice_hash: "h" }]);
    expect(calls[0].ops).toContainEqual(["is", "invoice_hash", null]);
    const lost = fakeSb({ sr_invoices: [] });
    expect(await supabaseStore(lost.sb).setInvoiceHash("i1", "h")).toBe(false);
  });

  it("setReceiptHash only sets an empty hash and reports whether it did", async () => {
    const { sb, calls } = fakeSb({ sr_payments: [{ id: "p1" }] });
    expect(await supabaseStore(sb).setReceiptHash("p1", "h")).toBe(true);
    expect(calls[0].ops).toContainEqual(["is", "receipt_hash", null]);
    expect(await supabaseStore(fakeSb({ sr_payments: [] }).sb).setReceiptHash("p1", "h")).toBe(false);
  });

  describe("template files", () => {
    it("lists a workspace's templates oldest first, mapped to TemplateFile", async () => {
      const { sb, calls } = fakeSb({
        sr_template_files: [
          { workspace_id: "w1", hash: "h1", name: "a.pdf", size_bytes: 10, scan_engine: "x", created_at: "2026-11-16T10:00:00Z" },
        ],
      });
      const out = await supabaseStore(sb).listTemplateFiles("w1");
      expect(out).toEqual([{ workspaceId: "w1", hash: "h1", name: "a.pdf" }]);
      expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
      expect(calls[0].ops).toContainEqual(["order", "created_at", { ascending: true }]);
    });

    it("upserts on (workspace_id, hash), then deletes everything beyond the newest 20", async () => {
      const { sb, calls } = fakeSb({
        sr_template_files: { __seq: [null, [{ hash: "old1" }, { hash: "old2" }], null] },
      });
      await supabaseStore(sb).addTemplateFile({ workspaceId: "w1", hash: "h9", name: "n.pdf", sizeBytes: 123, scanEngine: "cloudmersive" });
      const up = calls[0].ops.find((o) => o[0] === "upsert")!;
      expect(up[1]).toMatchObject({ workspace_id: "w1", hash: "h9", name: "n.pdf", size_bytes: 123, scan_engine: "cloudmersive" });
      expect(typeof (up[1] as { created_at: unknown }).created_at).toBe("string");
      // A re-upload of the same hash is a fresh scan: scanned_at is refreshed with scan_engine.
      expect(typeof (up[1] as { scanned_at: unknown }).scanned_at).toBe("string");
      expect(up[2]).toEqual({ onConflict: "workspace_id,hash" });
      expect(calls[1].ops).toContainEqual(["order", "created_at", { ascending: false }]);
      expect(calls[1].ops).toContainEqual(["range", 20, 999]);
      const del = calls[2].ops;
      expect(del.map((o) => o[0])).toContain("delete");
      expect(del).toContainEqual(["eq", "workspace_id", "w1"]);
      expect(del).toContainEqual(["in", "hash", ["old1", "old2"]]);
    });

    it("keeps only the newest 20 in the fake store, dropping the oldest", async () => {
      const s = fakeStore();
      for (let n = 1; n <= 21; n++) await s.addTemplateFile({ workspaceId: "w1", hash: `h${n}`, name: `${n}.pdf`, sizeBytes: 1, scanEngine: "x" });
      const list = await s.listTemplateFiles("w1");
      expect(list).toHaveLength(20);
      expect(list[0].hash).toBe("h2");
      expect(list[19].hash).toBe("h21");
    });

    it("re-adding a hash refreshes its name and position instead of duplicating it", async () => {
      const s = fakeStore();
      await s.addTemplateFile({ workspaceId: "w1", hash: "a", name: "one.pdf", sizeBytes: 1, scanEngine: "x" });
      await s.addTemplateFile({ workspaceId: "w1", hash: "b", name: "two.pdf", sizeBytes: 1, scanEngine: "x" });
      await s.addTemplateFile({ workspaceId: "w1", hash: "a", name: "renamed.pdf", sizeBytes: 1, scanEngine: "x" });
      await s.addTemplateFile({ workspaceId: "w2", hash: "z", name: "other.pdf", sizeBytes: 1, scanEngine: "x" });
      expect(await s.listTemplateFiles("w1")).toEqual([
        { workspaceId: "w1", hash: "b", name: "two.pdf" },
        { workspaceId: "w1", hash: "a", name: "renamed.pdf" },
      ]);
    });
  });

  describe("agreements", () => {
    const agRow = {
      id: "a1", workspace_id: "w1", sender_id: "u1", client_id: "c1", type: "NDA", title: "T", status: "Draft", revision: 2,
      row_version: 3, content: "c", source_kind: "authored", document_hash: "dh", pages: [{ width: 1, height: 2 }], participants: [],
      fields: [], events: [], sequential: false, sender_first: true, sender_release_pending: true, sender_signed_hash: null,
      deadline: null, reminder_days: 3, subject: "", message: "", branding: null, frozen: null, send_key: null,
      template_version_id: null, legal_hold: false, archived_at: null, trashed_at: null, sent_at: null, completed_at: null,
      last_reminder_at: null, created_at: "2026-11-17T10:00:00Z", updated_at: "2026-11-17T11:00:00Z",
    };
    const newAgreement = {
      workspaceId: "w1", senderId: "u1", clientId: "c1", type: "NDA", title: "T", status: "Draft" as const, revision: 1, content: "",
      sourceKind: "authored" as const, pages: [], participants: [], fields: [], sequential: false, deadline: "", reminderDays: 3,
      subject: "", message: "", events: [], legalHold: false,
    };
    const newTemplate = { workspaceId: "w1", name: "N", type: "NDA", content: "", roles: [], fields: [] };

    it("updateAgreement compares row_version and maps snake_case", async () => {
      const { sb, calls } = fakeSb({ sr_agreements: agRow });
      const out = await supabaseStore(sb).updateAgreement("w1", "a1", 3, { documentHash: "dh", senderReleasePending: true, deadline: "" });
      const upd = calls[0].ops.find((o) => o[0] === "update")![1] as Record<string, unknown>;
      expect(upd).toMatchObject({ document_hash: "dh", sender_release_pending: true, deadline: null });
      expect(upd).not.toHaveProperty("documentHash");
      expect(calls[0].ops).toContainEqual(["eq", "row_version", 3]);
      expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
      expect(calls[0].ops).toContainEqual(["eq", "id", "a1"]);
      expect(out).toMatchObject({ id: "a1", rowVersion: 3, documentHash: "dh", senderFirst: true, senderReleasePending: true, deadline: "", reminderDays: 3, created: "2026-11-17T10:00:00Z" });
    });

    it("updateAgreement returns null when the row moved", async () => {
      const { sb } = fakeSb({ sr_agreements: null });
      expect(await supabaseStore(sb).updateAgreement("w1", "a1", 1, { title: "x" })).toBeNull();
    });

    it("updateAgreement turns a database refusal into a StoreError with its sentence", async () => {
      const { sb } = fakeSb({ sr_agreements: { __error: { message: "Evidence history is append-only." } } });
      await expect(supabaseStore(sb).updateAgreement("w1", "a1", 1, { events: [] })).rejects.toThrow("Evidence history is append-only.");
    });

    it("writes a blank deadline as null on insert and reads null as an empty string", async () => {
      const { sb, calls } = fakeSb({ sr_agreements: agRow });
      const a = await supabaseStore(sb).insertAgreement(newAgreement);
      const ins = calls[0].ops.find((o) => o[0] === "insert")![1] as Record<string, unknown>;
      expect(ins).toMatchObject({ workspace_id: "w1", sender_id: "u1", deadline: null, source_kind: "authored", legal_hold: false });
      expect(a.deadline).toBe("");
      expect(a.rowVersion).toBe(3);
    });

    it("lists summaries without the heavy columns, newest first", async () => {
      const { sb, calls } = fakeSb({ sr_agreements: [agRow] });
      const out = await supabaseStore(sb).listAgreements("w1", "u1");
      const sel = calls[0].ops.find((o) => o[0] === "select")![1] as string;
      const cols = sel.split(",").map((x) => x.trim());
      for (const c of ["content", "events", "branding", "frozen", "fields"]) expect(cols).not.toContain(c);
      expect(cols).toContain("title");
      expect(calls[0].ops).toContainEqual(["eq", "sender_id", "u1"]);
      expect(calls[0].ops).toContainEqual(["order", "updated_at", { ascending: false }]);
      expect(out[0]).toMatchObject({ id: "a1", title: "T" });
      expect(out[0]).not.toHaveProperty("content");
      const all = fakeSb({ sr_agreements: [] });
      await supabaseStore(all.sb).listAgreements("w1", null);
      expect(all.calls[0].ops.some((o) => o[0] === "eq" && o[1] === "sender_id")).toBe(false);
    });

    it("counts drafts that are not in the bin", async () => {
      const { sb, calls } = fakeSb({ sr_agreements: { __count: 4 } });
      expect(await supabaseStore(sb).countDrafts("w1")).toBe(4);
      expect(calls[0].ops).toContainEqual(["eq", "status", "Draft"]);
      expect(calls[0].ops).toContainEqual(["is", "trashed_at", null]);
    });

    it("insertAgreementTemplate takes the next version and retries once on a duplicate", async () => {
      const trow = { id: "t1", workspace_id: "w1", name: "N", type: "NDA", version: 3, content: "", roles: [], fields: [], created_at: "t" };
      const { sb, calls } = fakeSb({
        sr_agreement_templates: { __seq: [{ version: 1 }, { __error: { code: "23505", message: "dup" } }, { version: 2 }, trow] },
      });
      const out = await supabaseStore(sb).insertAgreementTemplate(newTemplate);
      expect(out.version).toBe(3);
      const inserts = calls.flatMap((c) => c.ops.filter((o) => o[0] === "insert").map((o) => (o[1] as { version: number }).version));
      expect(inserts).toEqual([2, 3]);
    });

    it("insertAgreementTemplate gives a 409 after a second duplicate", async () => {
      const dup = { __error: { code: "23505", message: "dup" } };
      const { sb } = fakeSb({ sr_agreement_templates: { __seq: [null, dup, null, dup] } });
      await expect(supabaseStore(sb).insertAgreementTemplate(newTemplate)).rejects.toMatchObject({
        status: 409,
        message: "This template was saved at the same moment elsewhere. Try again.",
      });
    });

    it("signedBlobUrl signs <workspace>/<hash> for the given seconds; a download name only when given", async () => {
      const { sb, calls } = fakeSb({});
      const store = supabaseStore(sb);
      expect(await store.signedBlobUrl("w1", "h1", 60)).toBe("https://sb.test/sign/w1/h1?token=t");
      expect(await store.signedBlobUrl("w1", "h1", 60, "final.pdf")).toBe("https://sb.test/sign/w1/h1?token=t");
      const ops = calls.filter((c) => c.table === "storage:signroom").flatMap((c) => c.ops);
      expect(ops).toEqual([
        ["createSignedUrl", "w1/h1", 60, undefined],
        ["createSignedUrl", "w1/h1", 60, { download: "final.pdf" }],
      ]);
    });

    it("signedBlobUrl throws a StoreError when Storage refuses", async () => {
      const { sb } = fakeSb({ __signError: { message: "Object not found" } });
      await expect(supabaseStore(sb).signedBlobUrl("w1", "h1", 60)).rejects.toThrow("Object not found");
    });

    it("createUpload records the ticket and asks Storage for a signed upload URL", async () => {
      const { sb, calls } = fakeSb({ sr_uploads: { id: "x", workspace_id: "w1", agreement_id: "a1", path: "p", used_at: null, created_at: "t" } });
      const out = await supabaseStore(sb).createUpload("w1", "a1");
      const ins = calls[0].ops.find((o) => o[0] === "insert")![1] as { id: string; path: string; workspace_id: string; agreement_id: string };
      expect(ins.path).toBe(`w1/quarantine/${ins.id}.pdf`);
      expect(ins).toMatchObject({ workspace_id: "w1", agreement_id: "a1" });
      const storage = calls.find((c) => c.table === "storage:signroom")!;
      expect(storage.ops).toContainEqual(["createSignedUploadUrl", ins.path]);
      expect(out.token).toBe("tok");
      expect(out.id).toBe(ins.id);
      expect(out.path).toBe(ins.path);
    });

    it("takeUpload only takes an unused ticket under 2 hours old in its workspace", async () => {
      const ticket = { id: "11111111-1111-4111-8111-111111111111", workspace_id: "w1", agreement_id: "a1", path: "p", used_at: "t", created_at: "t" };
      const { sb, calls } = fakeSb({ sr_uploads: ticket });
      const out = await supabaseStore(sb).takeUpload("w1", ticket.id);
      expect(out?.agreementId).toBe("a1");
      expect(calls[0].ops).toContainEqual(["is", "used_at", null]);
      expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
      expect(calls[0].ops.some((o) => o[0] === "gt" && o[1] === "created_at")).toBe(true);
      const bad = fakeSb({});
      expect(await supabaseStore(bad.sb).takeUpload("w1", "nope")).toBeNull();
      expect(bad.calls).toHaveLength(0);
    });

    it("removeQuarantine never throws and logs a fixed sentence", async () => {
      const { sb } = fakeSb({ __removeError: { message: "secret file name" } });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(supabaseStore(sb).removeQuarantine("w1/quarantine/x.pdf")).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith("[signroom] quarantine cleanup failed");
      log.mockRestore();
    });

    it("readQuarantine downloads the object", async () => {
      const { sb } = fakeSb({});
      expect([...(await supabaseStore(sb).readQuarantine("w1/quarantine/x.pdf"))!]).toEqual([7, 8]);
    });

    it("readQuarantine is null for a missing object (statusCode 404 on HTTP 400, or HTTP 404)", async () => {
      for (const err of [
        { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" },
        { name: "StorageApiError", message: "Object not found", status: 404, statusCode: "not_found" },
      ]) {
        const { sb } = fakeSb({ __downloadError: err });
        expect(await supabaseStore(sb).readQuarantine("w1/quarantine/x.pdf")).toBeNull();
      }
    });

    it("readQuarantine throws on any other Storage error", async () => {
      for (const err of [
        { name: "StorageApiError", message: "denied", status: 403, statusCode: "403" },
        { name: "StorageUnknownError", message: "fetch failed" },
      ]) {
        const { sb } = fakeSb({ __downloadError: err });
        await expect(supabaseStore(sb).readQuarantine("w1/quarantine/x.pdf")).rejects.toThrow();
      }
    });

    it("sweepUploads removes the objects, then the rows", async () => {
      const { sb, calls } = fakeSb({ sr_uploads: { __seq: [[{ path: "w1/quarantine/a.pdf" }, { path: "w1/quarantine/b.pdf" }], null] } });
      await supabaseStore(sb).sweepUploads("w1", "2026-11-17T10:00:00Z");
      expect(calls[0].ops).toContainEqual(["lt", "created_at", "2026-11-17T10:00:00Z"]);
      expect(calls.find((c) => c.table === "storage:signroom")!.ops).toContainEqual(["remove", ["w1/quarantine/a.pdf", "w1/quarantine/b.pdf"]]);
      const del = calls.filter((c) => c.table === "sr_uploads")[1].ops;
      expect(del.map((o) => o[0])).toContain("delete");
      expect(del).toContainEqual(["eq", "workspace_id", "w1"]);
    });

    it("sweepUploads logs and keeps the rows when Storage removal fails", async () => {
      const { sb, calls } = fakeSb({ sr_uploads: [{ path: "w1/quarantine/a.pdf" }], __removeError: { message: "secret" } });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(supabaseStore(sb).sweepUploads("w1", "2026-11-17T10:00:00Z")).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith("[signroom] quarantine cleanup failed");
      expect(calls.filter((c) => c.table === "sr_uploads")).toHaveLength(1);
      log.mockRestore();
    });

    it("deliveries carry the agreement and participant", async () => {
      const r = { id: "d1", workspace_id: "w1", agreement_id: "a1", participant_id: "p1", recipient: "x@y.z", subject: "s", purpose: "invite", route: "mailbox", status: "sent", created_at: "t" };
      const { sb, calls } = fakeSb({ sr_deliveries: r });
      const d = await supabaseStore(sb).insertDelivery({ workspaceId: "w1", agreementId: "a1", participantId: "p1", recipient: "x@y.z", subject: "s", purpose: "invite", route: "mailbox", status: "sending" });
      expect(calls[0].ops.find((o) => o[0] === "insert")![1]).toMatchObject({ agreement_id: "a1", participant_id: "p1", invoice_id: null });
      expect(d).toMatchObject({ agreementId: "a1", participantId: "p1" });
      const list = await supabaseStore(fakeSb({ sr_deliveries: [r] }).sb).listAgreementDeliveries("a1");
      expect(list[0].agreementId).toBe("a1");
    });

    it("sign tokens map to and from snake_case", async () => {
      const at = "2026-11-24T00:00:00.000Z";
      const r = { id: "k1", digest: "d", purpose: "sign", workspace_id: "w1", agreement_id: "a1", participant_id: "p1", email: "a@b.co", version: 2, expires_at: at, revoked: false };
      const { sb, calls } = fakeSb({ sr_sign_tokens: r });
      const t = await supabaseStore(sb).insertSignToken({ digest: "d", purpose: "sign", workspaceId: "w1", agreementId: "a1", participantId: "p1", email: "a@b.co", version: 2, expires: Date.parse(at), revoked: false });
      expect(calls[0].ops.find((o) => o[0] === "insert")![1]).toMatchObject({ agreement_id: "a1", participant_id: "p1", expires_at: at });
      expect(t).toMatchObject({ id: "k1", agreementId: "a1", participantId: "p1", expires: Date.parse(at) });
      const rev = fakeSb({});
      await supabaseStore(rev.sb).revokeSignTokens("a1", "p1");
      expect(rev.calls[0].ops).toContainEqual(["update", { revoked: true }]);
      expect(rev.calls[0].ops).toContainEqual(["eq", "agreement_id", "a1"]);
      expect(rev.calls[0].ops).toContainEqual(["eq", "participant_id", "p1"]);
    });
  });
});

describe("supabaseStore part 3B", () => {
  const jobRow = { id: "j1", workspace_id: "w1", agreement_id: "a1", participant_id: null, kind: "mail", purpose: "invite", dedupe: "x", status: "queued", attempts: 0, available_at: "2026-11-17T10:00:00.000Z", lease_until: null, payload: "p", error: null, live_attempted_at: null, manual_review: false, created_at: "2026-11-17T10:00:00.000Z" };

  it("claimJobs calls the sr_claim_jobs function", async () => {
    const { sb, calls } = fakeSb({ sr_claim_jobs: [jobRow] });
    const jobs = await supabaseStore(sb).claimJobs(5, 360, ["j1"]);
    expect(calls[0]).toMatchObject({ rpc: "sr_claim_jobs", args: { p_limit: 5, p_lease_seconds: 360, p_ids: ["j1"] } });
    expect(jobs[0]).toMatchObject({ id: "j1", kind: "mail", available: Date.parse("2026-11-17T10:00:00.000Z"), manualReview: false });
    const none = fakeSb({});
    expect(await supabaseStore(none.sb).claimJobs(1, 360)).toEqual([]);
    expect(none.calls[0].args).toEqual({ p_limit: 1, p_lease_seconds: 360, p_ids: null });
  });

  it("insertJob upserts on dedupe then reads the job back", async () => {
    const { sb, calls } = fakeSb({ sr_jobs: { __seq: [null, jobRow] } });
    const j = await supabaseStore(sb).insertJob({ workspaceId: "w1", agreementId: "a1", kind: "mail", purpose: "invite", dedupe: "x", payload: "p" });
    const up = calls[0].ops.find((o) => o[0] === "upsert")!;
    expect(up[2]).toEqual({ onConflict: "dedupe", ignoreDuplicates: true });
    expect(up[1]).toMatchObject({ workspace_id: "w1", agreement_id: "a1", dedupe: "x" });
    expect(calls[1].ops).toContainEqual(["eq", "dedupe", "x"]);
    expect(j.id).toBe("j1");
  });

  it("agreementRow maps the 3B fields and reads them back", async () => {
    const { sb, calls } = fakeSb({ sr_agreements: { id: "a1", workspace_id: "w1", row_version: 2, status: "Completed", artifacts: { final: "h" }, final_snapshot: [], exported_at: "e", deletion_at: "d", link_origin: "https://x.test" } });
    const a = await supabaseStore(sb).updateAgreement("w1", "a1", 1, { finalSnapshot: [], linkOrigin: "https://x.test", artifacts: { final: "h" }, exportedAt: "", deletionAt: "" });
    expect(calls[0].ops.find((o) => o[0] === "update")![1]).toEqual({ final_snapshot: [], link_origin: "https://x.test", artifacts: { final: "h" }, exported_at: null, deletion_at: null });
    expect(a).toMatchObject({ artifacts: { final: "h" }, finalSnapshot: [], exportedAt: "e", deletionAt: "d", linkOrigin: "https://x.test" });
  });

  it("deleteAgreement is false when the guard refuses or nothing matched", async () => {
    const refused = fakeSb({ sr_agreements: { __error: { code: "P0001", message: "Agreements cannot be deleted." } } });
    expect(await supabaseStore(refused.sb).deleteAgreement("w1", "a1")).toBe(false);
    expect(await supabaseStore(fakeSb({ sr_agreements: [] }).sb).deleteAgreement("w1", "a1")).toBe(false);
    const ok = fakeSb({ sr_agreements: [{ id: "a1" }] });
    expect(await supabaseStore(ok.sb).deleteAgreement("w1", "a1")).toBe(true);
    const other = fakeSb({ sr_agreements: { __error: { code: "XX000", message: "boom" } } });
    await expect(supabaseStore(other.sb).deleteAgreement("w1", "a1")).rejects.toThrow("boom");
  });

  it("a delivery carries its job, and holdJobDelivery fails the job's rows", async () => {
    const r = { id: "d1", workspace_id: "w1", agreement_id: "a1", participant_id: "p1", job_id: "j1", recipient: "x@y.z", subject: "s", purpose: "invite", route: null, status: "failed", error: "held", created_at: "t" };
    const ins = fakeSb({ sr_deliveries: r });
    const d = await supabaseStore(ins.sb).insertDelivery({ workspaceId: "w1", agreementId: "a1", participantId: "p1", recipient: "x@y.z", subject: "s", purpose: "invite", status: "failed", error: "held", jobId: "j1" });
    expect(ins.calls[0].ops.find((o) => o[0] === "insert")![1]).toMatchObject({ job_id: "j1", route: null });
    expect(d).toMatchObject({ jobId: "j1" });
    expect(d).not.toHaveProperty("route");
    // Without a job the column is left out, so invoice emails work before this migration runs.
    const plain = fakeSb({ sr_deliveries: r });
    await supabaseStore(plain.sb).insertDelivery({ workspaceId: "w1", recipient: "x@y.z", subject: "s", purpose: "invoice", route: "mailbox", status: "sending" });
    expect(plain.calls[0].ops.find((o) => o[0] === "insert")![1]).not.toHaveProperty("job_id");

    const upd = fakeSb({ sr_deliveries: [{ id: "d1" }] });
    expect(await supabaseStore(upd.sb).holdJobDelivery("j1", "held")).toBe(true);
    expect(upd.calls[0].ops).toContainEqual(["update", { status: "failed", error: "held" }]);
    expect(upd.calls[0].ops).toContainEqual(["eq", "job_id", "j1"]);
    expect(await supabaseStore(fakeSb({ sr_deliveries: [] }).sb).holdJobDelivery("j1", "held")).toBe(false);
  });

  it("markLiveAttempt only touches a job never attempted", async () => {
    const { sb, calls } = fakeSb({ sr_jobs: [{ id: "j1" }] });
    expect(await supabaseStore(sb).markLiveAttempt("j1")).toBe(true);
    expect(calls[0].ops).toContainEqual(["is", "live_attempted_at", null]);
    expect((calls[0].ops.find((o) => o[0] === "update")![1] as Record<string, unknown>).manual_review).toBe(true);
    expect(await supabaseStore(fakeSb({ sr_jobs: [] }).sb).markLiveAttempt("j1")).toBe(false);
  });

  it("sign tokens carry code columns and revoke by purpose", async () => {
    const at = "2026-11-24T00:00:00.000Z";
    const r = { id: "k1", digest: "d", purpose: "sign", workspace_id: "w1", agreement_id: "a1", participant_id: "p1", email: "a@b.co", version: 2, expires_at: at, revoked: false, code_digest: "cd", code_expires_at: at, code_sent_at: at, attempts: 2, code_sends: 1, code_window_start: at };
    const found = await supabaseStore(fakeSb({ sr_sign_tokens: r }).sb).findSignToken("d");
    expect(found).toMatchObject({ codeDigest: "cd", codeExpires: Date.parse(at), codeSent: Date.parse(at), attempts: 2, codeSends: 1, codeWindowStart: Date.parse(at) });
    const upd = fakeSb({ sr_sign_tokens: [{ id: "k1" }] });
    expect(await supabaseStore(upd.sb).updateSignTokenIf("k1", { attempts: 2, codeSends: 1 }, { attempts: 3 })).toBe(true);
    expect(upd.calls[0].ops).toContainEqual(["eq", "attempts", 2]);
    expect(upd.calls[0].ops).toContainEqual(["eq", "code_sends", 1]);
    expect(upd.calls[0].ops).toContainEqual(["update", { attempts: 3 }]);
    const rev = fakeSb({});
    await supabaseStore(rev.sb).revokeSignTokens("a1", "p1", "complete");
    expect(rev.calls[0].ops).toContainEqual(["eq", "purpose", "complete"]);
  });

  it("blobInUse calls the function; evidence keys compare the public key", async () => {
    const { sb, calls } = fakeSb({ sr_blob_in_use: true });
    expect(await supabaseStore(sb).blobInUse("w1", "h")).toBe(true);
    expect(calls[0]).toMatchObject({ rpc: "sr_blob_in_use", args: { p_workspace: "w1", p_hash: "h" } });
    const keys = fakeSb({ sr_evidence_keys: { __seq: [null, { key_id: "taskcalendar-ed25519-v1", public_key: "OTHER" }] } });
    await expect(supabaseStore(keys.sb).registerEvidenceKey("taskcalendar-ed25519-v1", "A")).rejects.toThrow("does not match its recorded public key");
    expect(keys.calls[0].ops.find((o) => o[0] === "upsert")![2]).toEqual({ onConflict: "key_id", ignoreDuplicates: true });
  });

  it("the maintenance lists call their database functions with the limit", async () => {
    const row = { id: "a1", workspace_id: "w1", row_version: 2, status: "Awaiting signatures", events: [], participants: [], fields: [], pages: [] };
    for (const [method, fn] of [
      ["listDueAgreements", "sr_agreements_due"],
      ["listDeletionsDue", "sr_deletions_due"],
      ["listStrandedFinalising", "sr_finalising_stranded"],
    ] as const) {
      const { sb, calls } = fakeSb({ [fn]: [row] });
      const out = await supabaseStore(sb)[method](25);
      expect(calls).toEqual([{ rpc: fn, ops: [], args: { p_limit: 25 } }]);
      expect(out.map((a) => a.id)).toEqual(["a1"]);
      expect(await supabaseStore(fakeSb({}).sb)[method](5)).toEqual([]);
    }
  });

  it("listRefusedCompletionMail calls its database function with the limit and maps jobs", async () => {
    const row = { id: "j1", workspace_id: "w1", kind: "mail", purpose: "completion", dedupe: "d", status: "failed", attempts: 5, payload: "x" };
    const { sb, calls } = fakeSb({ sr_completion_mail_refused: [row] });
    const out = await supabaseStore(sb).listRefusedCompletionMail(25);
    expect(calls).toEqual([{ rpc: "sr_completion_mail_refused", ops: [], args: { p_limit: 25 } }]);
    expect(out.map((j) => [j.id, j.purpose, j.status, j.attempts])).toEqual([["j1", "completion", "failed", 5]]);
    expect(await supabaseStore(fakeSb({}).sb).listRefusedCompletionMail(5)).toEqual([]);
  });

  it("requeueJob updates only from the given status and reports whether a row moved", async () => {
    const { sb, calls } = fakeSb({ sr_jobs: [{ id: "j1" }] });
    expect(await supabaseStore(sb).requeueJob("j1", "suppressed", { resetAttempts: true })).toBe(true);
    const set = calls[0].ops.find((o) => o[0] === "update")![1] as Record<string, unknown>;
    expect(set).toMatchObject({ status: "queued", error: null, attempts: 0 });
    expect(typeof set.available_at).toBe("string");
    expect(calls[0].ops).toContainEqual(["eq", "id", "j1"]);
    expect(calls[0].ops).toContainEqual(["eq", "status", "suppressed"]);
    const kept = fakeSb({ sr_jobs: [] });
    expect(await supabaseStore(kept.sb).requeueJob("j1", "failed")).toBe(false);
    expect(kept.calls[0].ops.find((o) => o[0] === "update")![1]).not.toHaveProperty("attempts");
    expect(kept.calls[0].ops).toContainEqual(["eq", "status", "failed"]);
  });

  it("clearJobPayloads suppresses the queued jobs, then empties every payload but the one kept", async () => {
    const { sb, calls } = fakeSb({});
    await supabaseStore(sb).clearJobPayloads("a1", "j1");
    expect(calls).toHaveLength(2);
    const [suppress, clear] = calls;
    expect(suppress.table).toBe("sr_jobs");
    expect(suppress.ops.find((o) => o[0] === "update")![1]).toMatchObject({ status: "suppressed", payload: "" });
    expect(suppress.ops).toContainEqual(["eq", "agreement_id", "a1"]);
    expect(suppress.ops).toContainEqual(["neq", "id", "j1"]);
    expect(suppress.ops).toContainEqual(["eq", "status", "queued"]);
    expect(clear.ops.find((o) => o[0] === "update")![1]).toMatchObject({ payload: "" });
    expect(clear.ops.find((o) => o[0] === "update")![1]).not.toHaveProperty("status");
    expect(clear.ops).toContainEqual(["eq", "agreement_id", "a1"]);
    expect(clear.ops).toContainEqual(["neq", "id", "j1"]);
  });
});

describe("supabaseStore account settings", () => {
  it("setClientAccount calls the function and returns null when it answers null", async () => {
    const acct = { currency: "GBP", paymentTermsDays: 14, reference: "", notes: "", revision: 1 };
    const { sb, calls } = fakeSb({ sr_set_client_account: null });
    expect(await supabaseStore(sb).setClientAccount("w1", "c1", 0, acct)).toBeNull();
    expect(calls[0]).toMatchObject({ rpc: "sr_set_client_account", args: { p_workspace: "w1", p_client: "c1", p_revision: 0, p_account: acct } });
    const ok = fakeSb({ sr_set_client_account: acct });
    expect(await supabaseStore(ok.sb).setClientAccount("w1", "c1", 0, acct)).toEqual(acct);
  });

});

describe("supabaseStore: tenancy from TaskCalendar's own tables", () => {
  const WSID = "0a000000-0000-4000-8000-000000000001";
  const ORGID = "0b000000-0000-4000-8000-000000000001";
  const U = "11111111-1111-4111-8111-111111111111";
  const org = (members: unknown, owner_id: string | null = "boss") => ({ owner_id, members });

  it("workspaceAccess reads the workspace, then the organisation that owns it, and maps the role", async () => {
    const { sb, calls } = fakeSb({
      workspaces: { workspace_id: WSID, organization_id: ORGID, name: "Design team" },
      organizations: org([{ userId: U, role: "admin", status: "active" }]),
    });
    expect(await supabaseStore(sb).workspaceAccess(WSID, U)).toEqual({ workspaceId: WSID, name: "Design team", role: "admin" });
    expect(calls.map((c) => c.table)).toEqual(["workspaces", "organizations"]);
    expect(calls[0].ops).toContainEqual(["eq", "workspace_id", WSID]);
    expect(calls[1].ops).toContainEqual(["eq", "organization_id", ORGID]);
    // Only what the check needs is read from the organisation.
    expect(calls[1].ops).toContainEqual(["select", "owner_id, members"]);
  });

  it("workspaceAccess returns the stored workspace id, so a differently-cased header maps to one row", async () => {
    const { sb } = fakeSb({
      workspaces: { workspace_id: WSID, organization_id: ORGID, name: "Design team" },
      organizations: org([], U),
    });
    expect((await supabaseStore(sb).workspaceAccess(WSID.toUpperCase(), U))?.workspaceId).toBe(WSID);
  });

  it("workspaceAccess is null for an unknown workspace (the organisation is never read), a workspace with no organisation, and a missing organisation", async () => {
    const none = fakeSb({ workspaces: null, organizations: org([], U) });
    expect(await supabaseStore(none.sb).workspaceAccess(WSID, U)).toBeNull();
    expect(none.calls.map((c) => c.table)).toEqual(["workspaces"]);
    const loose = fakeSb({ workspaces: { workspace_id: WSID, organization_id: null, name: "x" }, organizations: org([], U) });
    expect(await supabaseStore(loose.sb).workspaceAccess(WSID, U)).toBeNull();
    const gone = fakeSb({ workspaces: { workspace_id: WSID, organization_id: ORGID, name: "x" }, organizations: null });
    expect(await supabaseStore(gone.sb).workspaceAccess(WSID, U)).toBeNull();
  });

  it("workspaceAccess is null for an outsider, a removed member and an invited one; a viewer is reported as a viewer", async () => {
    const ws = { workspace_id: WSID, organization_id: ORGID, name: "x" };
    const access = (members: unknown) => supabaseStore(fakeSb({ workspaces: ws, organizations: org(members) }).sb).workspaceAccess(WSID, U);
    expect(await access([{ userId: "someone-else", role: "admin", status: "active" }])).toBeNull();
    expect(await access([{ userId: U, role: "admin", status: "removed" }])).toBeNull();
    expect(await access([{ userId: U, role: "member", status: "invited" }])).toBeNull();
    expect(await access(null)).toBeNull();
    expect((await access([{ userId: U, role: "viewer", status: "active" }]))?.role).toBe("viewer");
    expect((await access([{ userId: U, role: "member", status: "active" }]))?.role).toBe("member");
  });

  it("workspaceAccess throws StoreError when a read fails: a database error is never read as 'no access granted' nor as access", async () => {
    const failing = fakeSb({ workspaces: { __error: { message: "down" } } });
    await expect(supabaseStore(failing.sb).workspaceAccess(WSID, U)).rejects.toThrow("down");
    const failing2 = fakeSb({ workspaces: { workspace_id: WSID, organization_id: ORGID, name: "x" }, organizations: { __error: { message: "down too" } } });
    await expect(supabaseStore(failing2.sb).workspaceAccess(WSID, U)).rejects.toThrow("down too");
  });

  it("ensureWorkspace returns the existing row without writing", async () => {
    const { sb, calls } = fakeSb({ sr_workspaces: { id: WSID, owner: U, name: "Design team", created_at: "t" } });
    expect(await supabaseStore(sb).ensureWorkspace(WSID, "Renamed since", "u2")).toMatchObject({ id: WSID, name: "Design team", owner: U });
    expect(calls).toHaveLength(1);
    expect(calls[0].ops.some((o) => o[0] === "insert")).toBe(false);
  });

  it("ensureWorkspace creates the row with the TaskCalendar workspace's id and name on first use", async () => {
    const { sb, calls } = fakeSb({ sr_workspaces: { __seq: [null, { id: WSID, owner: U, name: "Design team", created_at: "t" }] } });
    expect(await supabaseStore(sb).ensureWorkspace(WSID, "Design team", U)).toMatchObject({ id: WSID, name: "Design team" });
    expect(calls[1].ops[0]).toEqual(["insert", { id: WSID, owner: U, name: "Design team" }]);
  });

  it("ensureWorkspace: when a parallel first call won (23505), it uses that row; any other failure throws", async () => {
    const raced = fakeSb({ sr_workspaces: { __seq: [null, { __error: { code: "23505", message: "duplicate key" } }, { id: WSID, owner: "u2", name: "Design team", created_at: "t" }] } });
    expect(await supabaseStore(raced.sb).ensureWorkspace(WSID, "Design team", U)).toMatchObject({ id: WSID, owner: "u2" });
    const broken = fakeSb({ sr_workspaces: { __seq: [null, { __error: { code: "42501", message: "permission denied" } }] } });
    await expect(supabaseStore(broken.sb).ensureWorkspace(WSID, "Design team", U)).rejects.toThrow("permission denied");
  });

  it("a workspace row with no owner (that account was deleted) reads as an empty owner", async () => {
    const { sb } = fakeSb({ sr_workspaces: { id: WSID, owner: null, name: "x", created_at: "t" } });
    expect((await supabaseStore(sb).getWorkspace(WSID))?.owner).toBe("");
  });
});

describe("supabaseStore: clients from CRM companies, and deals", () => {
  const crow = { id: "c1", workspace_id: "w1", name: "Bloom", contact_name: null, email: "a@b.co", crm_company_id: "co1", archived: false, created_at: "t" };

  it("reads crm_company_id as crmCompanyId (null when there is none)", async () => {
    expect((await supabaseStore(fakeSb({ sr_clients: crow }).sb).getClient("w1", "c1"))?.crmCompanyId).toBe("co1");
    expect((await supabaseStore(fakeSb({ sr_clients: { ...crow, crm_company_id: null } }).sb).getClient("w1", "c1"))?.crmCompanyId).toBeNull();
  });

  it("insertClient writes the company link; updateClient never does", async () => {
    const { sb, calls } = fakeSb({ sr_clients: crow });
    const s = supabaseStore(sb);
    await s.insertClient({ workspaceId: "w1", crmCompanyId: "co1", name: "Bloom", contactName: "", email: "a@b.co", companyNumber: "", notes: "", archived: false });
    expect(calls[0].ops[0][1]).toMatchObject({ workspace_id: "w1", crm_company_id: "co1", name: "Bloom" });
    await s.updateClient("w1", "c1", { name: "Renamed", crmCompanyId: "other", workspaceId: "w2" });
    const patch = calls[1].ops[0][1] as Record<string, unknown>;
    expect(patch.name).toBe("Renamed");
    expect(patch).not.toHaveProperty("crm_company_id");
    expect(patch).not.toHaveProperty("workspace_id");
    expect(calls[1].ops).toContainEqual(["eq", "workspace_id", "w1"]);
  });

  it("insertClient: a parallel request that made the company's client first (23505) gives that row; other failures throw", async () => {
    const raced = fakeSb({ sr_clients: { __seq: [{ __error: { code: "23505", message: "duplicate key" } }, crow] } });
    const out = await supabaseStore(raced.sb).insertClient({ workspaceId: "w1", crmCompanyId: "co1", name: "Bloom", contactName: "", email: "", companyNumber: "", notes: "", archived: false });
    expect(out.id).toBe("c1");
    expect(raced.calls[1].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(raced.calls[1].ops).toContainEqual(["eq", "crm_company_id", "co1"]);
    const broken = fakeSb({ sr_clients: { __error: { code: "23503", message: "foreign key" } } });
    await expect(supabaseStore(broken.sb).insertClient({ workspaceId: "w1", crmCompanyId: "co1", name: "x", contactName: "", email: "", companyNumber: "", notes: "", archived: false })).rejects.toThrow("foreign key");
  });

  it("getClientByCompany is scoped to the workspace", async () => {
    const { sb, calls } = fakeSb({ sr_clients: crow });
    expect((await supabaseStore(sb).getClientByCompany("w1", "co1"))?.id).toBe("c1");
    expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(calls[0].ops).toContainEqual(["eq", "crm_company_id", "co1"]);
    expect(await supabaseStore(fakeSb({ sr_clients: null }).sb).getClientByCompany("w1", "co1")).toBeNull();
  });

  it("clientHasDocuments counts invoices, then agreements, that are not drafts, inside the workspace", async () => {
    const none = fakeSb({ sr_invoices: { __count: 0 }, sr_agreements: { __count: 0 } });
    expect(await supabaseStore(none.sb).clientHasDocuments("w1", "c1")).toBe(false);
    for (const c of none.calls) {
      expect(c.ops).toContainEqual(["eq", "workspace_id", "w1"]);
      expect(c.ops).toContainEqual(["eq", "client_id", "c1"]);
      expect(c.ops).toContainEqual(["neq", "status", "Draft"]);
    }
    expect(none.calls.map((c) => c.table)).toEqual(["sr_invoices", "sr_agreements"]);
    const invoiced = fakeSb({ sr_invoices: { __count: 2 }, sr_agreements: { __count: 0 } });
    expect(await supabaseStore(invoiced.sb).clientHasDocuments("w1", "c1")).toBe(true);
    expect(invoiced.calls).toHaveLength(1);
    const agreed = fakeSb({ sr_invoices: { __count: 0 }, sr_agreements: { __count: 1 } });
    expect(await supabaseStore(agreed.sb).clientHasDocuments("w1", "c1")).toBe(true);
  });

  it("crmCompany reads the company only inside the workspace, with its contacts that have an email, oldest first", async () => {
    const { sb, calls } = fakeSb({
      crm_companies: { id: "co1", workspace_id: "w1", name: " Bloom & Co. ", email: "hello@bloom.co", address: "12 High Street", city: "London", state: "Greater London", postal_code: "SW1A 1AA", country: "United Kingdom" },
      crm_contacts: [
        { first_name: "Bea", last_name: "Bloom", email: " bea@bloom.co ", created_at: "2026-01-01" },
        { first_name: "No", last_name: null, email: "", created_at: "2026-01-02" },
        { first_name: "Solo", last_name: null, email: "solo@bloom.co", created_at: "2026-01-03" },
      ],
    });
    expect(await supabaseStore(sb).crmCompany("w1", "co1")).toEqual({
      id: "co1", name: "Bloom & Co.", email: "hello@bloom.co", address: "12 High Street", city: "London", state: "Greater London", postalCode: "SW1A 1AA", country: "United Kingdom",
      contacts: [{ name: "Bea Bloom", email: "bea@bloom.co" }, { name: "Solo", email: "solo@bloom.co" }],
    });
    expect(calls[0].ops).toContainEqual(["eq", "id", "co1"]);
    expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    // Every column: state and postal_code may not exist on an older database.
    expect(calls[0].ops).toContainEqual(["select", "*"]);
    expect(calls[1].ops).toContainEqual(["eq", "company_id", "co1"]);
    expect(calls[1].ops).toContainEqual(["order", "created_at", { ascending: true }]);
  });

  it("crmCompany copes with a database that has no state or postal_code yet, and is null outside the workspace (contacts are never read)", async () => {
    const old = fakeSb({ crm_companies: { id: "co1", workspace_id: "w1", name: "Bloom", email: null, address: null, city: "Leeds", country: null }, crm_contacts: [] });
    expect(await supabaseStore(old.sb).crmCompany("w1", "co1")).toEqual({ id: "co1", name: "Bloom", email: "", address: "", city: "Leeds", state: "", postalCode: "", country: "", contacts: [] });
    const none = fakeSb({ crm_companies: null, crm_contacts: [{ first_name: "x", email: "x@y.z" }] });
    expect(await supabaseStore(none.sb).crmCompany("w2", "co1")).toBeNull();
    expect(none.calls.map((c) => c.table)).toEqual(["crm_companies"]);
  });

  it("crmDeal reads the deal only inside the workspace", async () => {
    const { sb, calls } = fakeSb({ crm_deals: { id: "d1", company_id: "co1" } });
    expect(await supabaseStore(sb).crmDeal("w1", "d1")).toEqual({ id: "d1", companyId: "co1" });
    expect(calls[0].ops).toContainEqual(["eq", "id", "d1"]);
    expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(await supabaseStore(fakeSb({ crm_deals: null }).sb).crmDeal("w2", "d1")).toBeNull();
    expect(await supabaseStore(fakeSb({ crm_deals: { id: "d1", company_id: null } }).sb).crmDeal("w1", "d1")).toEqual({ id: "d1", companyId: null });
  });

  it("an agreement's deal is written at insert, read back as dealId, in the summary columns, and never sent in an update", async () => {
    const arow = { id: "a1", workspace_id: "w1", sender_id: "u1", client_id: "c1", crm_deal_id: "d1", type: "NDA", title: "T", status: "Draft", revision: 1, row_version: 1, created_at: "t", updated_at: "t" };
    const { sb, calls } = fakeSb({ sr_agreements: arow });
    const s = supabaseStore(sb);
    const made = await s.insertAgreement({ workspaceId: "w1", senderId: "u1", clientId: "c1", dealId: "d1", type: "NDA", title: "T", status: "Draft", revision: 1, content: "", sourceKind: "authored", pages: [], participants: [], fields: [], sequential: false, deadline: "", reminderDays: 3, subject: "", message: "", events: [], legalHold: false });
    expect(made.dealId).toBe("d1");
    expect(calls[0].ops[0][1]).toMatchObject({ crm_deal_id: "d1", workspace_id: "w1" });
    await s.updateAgreement("w1", "a1", 1, { title: "New", dealId: "d2" } as never);
    expect(calls[1].ops[0][1]).toEqual({ title: "New" });

    const noDeal = fakeSb({ sr_agreements: { ...arow, crm_deal_id: null } });
    await supabaseStore(noDeal.sb).insertAgreement({ workspaceId: "w1", senderId: "u1", clientId: "c1", type: "NDA", title: "T", status: "Draft", revision: 1, content: "", sourceKind: "authored", pages: [], participants: [], fields: [], sequential: false, deadline: "", reminderDays: 3, subject: "", message: "", events: [], legalHold: false });
    expect((noDeal.calls[0].ops[0][1] as Record<string, unknown>).crm_deal_id).toBeNull();

    const list = fakeSb({ sr_agreements: [arow] });
    const out = await supabaseStore(list.sb).listAgreements("w1", null, { clientId: "c1", dealId: "d1" });
    expect(out[0].dealId).toBe("d1");
    const sel = list.calls[0].ops.find((o) => o[0] === "select")![1] as string;
    expect(sel.split(",").map((x) => x.trim())).toContain("crm_deal_id");
    expect(list.calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(list.calls[0].ops).toContainEqual(["eq", "client_id", "c1"]);
    expect(list.calls[0].ops).toContainEqual(["eq", "crm_deal_id", "d1"]);
  });

  it("an invoice's deal is written at insert, read back as dealId, filtered in the list, and never sent in a draft update", async () => {
    const irow = { ...row, status: "Draft", crm_deal_id: "d1" };
    const { sb, calls } = fakeSb({ sr_invoices: { __seq: [{ id: "i1" }, irow, { id: "i1" }, irow, [irow]] }, sr_invoice_events: null });
    const s = supabaseStore(sb);
    const ev = { at: "2026-11-19T10:00:00Z", type: "Draft created", actor: "a" };
    const made = await s.insertInvoice({ workspaceId: "w1", clientId: "c1", dealId: "d1", createdBy: "u1", revision: 1, status: "Draft", number: "INV-1", currency: "GBP", issueDate: "2026-11-19", dueDate: "2026-12-19", lines: [], taxBps: 0, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, notes: "", created: "t", updated: "t" }, ev);
    expect(made.dealId).toBe("d1");
    const invoiceCalls = () => calls.filter((c) => c.table === "sr_invoices");
    expect(invoiceCalls()[0].ops[0][1]).toMatchObject({ crm_deal_id: "d1", workspace_id: "w1", client_id: "c1" });
    await s.updateDraft("w1", "i1", 1, { notes: "n", dealId: "d2" } as never, ev);
    const patch = invoiceCalls()[2].ops[0][1] as Record<string, unknown>;
    expect(patch.notes).toBe("n");
    expect(patch).not.toHaveProperty("crm_deal_id");
    const listed = await s.listInvoices("w1", { clientId: "c1", dealId: "d1" });
    expect(listed[0].dealId).toBe("d1");
    const listCall = invoiceCalls()[4];
    expect(listCall.ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(listCall.ops).toContainEqual(["eq", "client_id", "c1"]);
    expect(listCall.ops).toContainEqual(["eq", "crm_deal_id", "d1"]);
  });

  it("the lists have no client or deal filter unless one is given", async () => {
    const inv = fakeSb({ sr_invoices: [] });
    await supabaseStore(inv.sb).listInvoices("w1");
    expect(inv.calls[0].ops.some((o) => o[0] === "eq" && (o[1] === "client_id" || o[1] === "crm_deal_id"))).toBe(false);
    const agr = fakeSb({ sr_agreements: [] });
    await supabaseStore(agr.sb).listAgreements("w1", null);
    expect(agr.calls[0].ops.some((o) => o[0] === "eq" && (o[1] === "client_id" || o[1] === "crm_deal_id"))).toBe(false);
  });
});
