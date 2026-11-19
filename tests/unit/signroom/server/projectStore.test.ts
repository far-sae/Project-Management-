// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import { supabaseStore } from "../../../../api/_signroom/store";
import type { ClientProject, Invoice } from "../../../../api/_signroom/shared/types";

type NewProject = Omit<ClientProject, "id" | "revision" | "created" | "updated">;

const project = (over: Partial<NewProject> = {}): NewProject => ({
  workspaceId: "w1",
  clientId: "c1",
  createdBy: "u1",
  name: "Website",
  billingType: "Monthly",
  billingLabel: "",
  currency: "GBP",
  monthlyFeeMinor: 10000,
  contractValueMinor: 0,
  annualTargetMinor: 0,
  startMonth: "2026-01",
  endMonth: "",
  status: "Active",
  notes: "",
  monthlyEntries: {},
  archived: false,
  ...over,
});

describe("fake store: billing plans (sr_projects)", () => {
  it("inserts at revision 1 and reads back a copy", async () => {
    const s = fakeStore();
    const p = await s.insertProject(project());
    expect(p.revision).toBe(1);
    expect(p.id).toBeTruthy();
    p.name = "Changed";
    expect((await s.getProject("w1", p.id))?.name).toBe("Website");
  });

  it("a stale revision returns null and changes nothing", async () => {
    const s = fakeStore();
    const p = await s.insertProject(project());
    const ok = await s.updateProject("w1", p.id, 1, { archived: true });
    expect(ok).toMatchObject({ archived: true, revision: 2 });
    const stale = await s.updateProject("w1", p.id, 1, { name: "Other" });
    expect(stale).toBeNull();
    expect(await s.getProject("w1", p.id)).toMatchObject({ name: "Website", archived: true, revision: 2 });
  });

  it("another workspace cannot read or update a plan", async () => {
    const s = fakeStore();
    const p = await s.insertProject(project());
    expect(await s.getProject("w2", p.id)).toBeNull();
    expect(await s.updateProject("w2", p.id, 1, { name: "x" })).toBeNull();
    expect(await s.listProjects("w2")).toEqual([]);
    expect(await s.listProjects("w2", "c1")).toEqual([]);
  });

  it("lists oldest first and filters by client", async () => {
    const s = fakeStore();
    const a = await s.insertProject(project({ name: "A" }));
    const b = await s.insertProject(project({ name: "B", clientId: "c2" }));
    const c = await s.insertProject(project({ name: "C" }));
    expect((await s.listProjects("w1")).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect((await s.listProjects("w1", "c1")).map((x) => x.id)).toEqual([a.id, c.id]);
  });
});

describe("fake store: an invoice's billing plan link", () => {
  it("projectId set then cleared with an empty string leaves no projectId", async () => {
    const s = fakeStore();
    const inv = await s.insertInvoice(
      {
        workspaceId: "w1", clientId: "c1", createdBy: "u1", revision: 1, status: "Draft", number: "", currency: "GBP",
        issueDate: "2026-11-01", dueDate: "2026-11-15", lines: [], taxBps: 0, subtotalMinor: 0, taxMinor: 0, totalMinor: 0,
        notes: "", created: "", updated: "",
      } as unknown as Omit<Invoice, "id" | "payments" | "events">,
      { at: "2026-11-01T00:00:00Z", type: "created", actor: "u1" },
    );
    const ev = { at: "2026-11-01T00:00:00Z", type: "edited", actor: "u1" };
    const a = await s.updateDraft("w1", inv.id, 1, { projectId: "p1" }, ev);
    expect(a?.projectId).toBe("p1");
    const b = await s.updateDraft("w1", inv.id, 2, { projectId: "" }, ev);
    expect(b).not.toBeNull();
    expect("projectId" in (b as Invoice)).toBe(false);
  });
});

// ---- the Supabase store: what it asks the database for ------------------------------------------

type Op = [string, ...unknown[]];

/** Records one table's calls and answers each with `answer` (or the error). */
function recordingSb(answer: unknown, error: { message: string; code?: string } | null = null) {
  const calls: { table: string; ops: Op[] }[] = [];
  const sb = {
    from(table: string) {
      const call = { table, ops: [] as Op[] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "order", "limit", "gt", "lt"]) {
        b[m] = (...a: unknown[]) => {
          call.ops.push([m, ...a]);
          return b;
        };
      }
      const done = () => Promise.resolve(error ? { data: null, error } : { data: answer, error: null });
      b.maybeSingle = done;
      b.single = done;
      b.then = (ok: (v: unknown) => unknown) => done().then(ok);
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const ROW = {
  id: "p1", workspace_id: "w1", client_id: "c1", created_by: null, name: "Website", billing_type: "Custom", billing_label: "Retainer",
  currency: "GBP", monthly_fee_minor: "10000", contract_value_minor: 0, annual_target_minor: 5, start_month: "2026-01", end_month: null,
  status: "Active", notes: null, monthly_entries: null, archived: false, revision: 3, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z",
};

describe("supabaseStore: billing plans", () => {
  it("reads a row into the shared shape, always inside the workspace", async () => {
    const { sb, calls } = recordingSb(ROW);
    expect(await supabaseStore(sb).getProject("w1", "p1")).toEqual({
      id: "p1", workspaceId: "w1", clientId: "c1", createdBy: "", name: "Website", billingType: "Custom", billingLabel: "Retainer",
      currency: "GBP", monthlyFeeMinor: 10000, contractValueMinor: 0, annualTargetMinor: 5, startMonth: "2026-01", endMonth: "",
      status: "Active", notes: "", monthlyEntries: {}, archived: false, revision: 3, created: "2026-01-01T00:00:00Z", updated: "2026-02-01T00:00:00Z",
    });
    expect(calls[0].table).toBe("sr_projects");
    expect(calls[0].ops).toContainEqual(["eq", "workspace_id", "w1"]);
    expect(calls[0].ops).toContainEqual(["eq", "id", "p1"]);
  });

  it("lists oldest first, narrowed to the client when one is given", async () => {
    const { sb, calls } = recordingSb([ROW]);
    expect(await supabaseStore(sb).listProjects("w1", "c1")).toHaveLength(1);
    expect(calls[0].ops).toEqual([["select", "*"], ["eq", "workspace_id", "w1"], ["eq", "client_id", "c1"], ["order", "created_at", { ascending: true }]]);
    const all = recordingSb([ROW]);
    await supabaseStore(all.sb).listProjects("w1");
    expect(all.calls[0].ops).not.toContainEqual(["eq", "client_id", "c1"]);
  });

  it("inserts the plan's columns, with no created_by for an unknown creator", async () => {
    const { sb, calls } = recordingSb(ROW);
    await supabaseStore(sb).insertProject(project({ createdBy: "", billingType: "Custom", billingLabel: "Retainer" }));
    expect(calls[0].ops[0]).toEqual([
      "insert",
      {
        workspace_id: "w1", client_id: "c1", created_by: null, name: "Website", billing_type: "Custom", billing_label: "Retainer", currency: "GBP",
        monthly_fee_minor: 10000, contract_value_minor: 0, annual_target_minor: 0, start_month: "2026-01", end_month: "", status: "Active",
        notes: "", monthly_entries: {}, archived: false,
      },
    ]);
  });

  it("updates only while the revision is the one given, inside the workspace; no row is null", async () => {
    const { sb, calls } = recordingSb(null);
    expect(await supabaseStore(sb).updateProject("w1", "p1", 3, { archived: true })).toBeNull();
    const [update, ...filters] = calls[0].ops;
    expect(update[0]).toBe("update");
    expect(update[1]).toMatchObject({ archived: true, revision: 4 });
    expect(Object.keys(update[1] as object).sort()).toEqual(["archived", "revision", "updated_at"]);
    expect(filters).toEqual(expect.arrayContaining([["eq", "id", "p1"], ["eq", "workspace_id", "w1"], ["eq", "revision", 3]]));
  });

  it("a missing table is a StoreError that names it (the router turns that into the 186 sentence)", async () => {
    const { sb } = recordingSb(null, { message: "Could not find the table 'public.sr_projects' in the schema cache" });
    await expect(supabaseStore(sb).listProjects("w1")).rejects.toMatchObject({ name: "StoreError", message: expect.stringContaining("sr_projects") });
  });
});

describe("supabaseStore: an invoice's billing plan link (a column migration 186 adds)", () => {
  const invoice = { id: "i1", workspace_id: "w1", status: "Draft", revision: 2, created_at: "", updated_at: "", sr_payments: [], sr_invoice_events: [] };

  it("reads project_id as projectId, and nothing when the column is absent or empty", async () => {
    expect((await supabaseStore(recordingSb({ ...invoice, project_id: "p1" }).sb).getInvoice("w1", "i1"))?.projectId).toBe("p1");
    for (const row of [invoice, { ...invoice, project_id: null }]) {
      const read = await supabaseStore(recordingSb(row).sb).getInvoice("w1", "i1");
      expect(read && "projectId" in read).toBe(false);
    }
  });

  it("a draft save that does not name the link never writes the column", async () => {
    const { sb, calls } = recordingSb({ ...invoice });
    await supabaseStore(sb).updateDraft("w1", "i1", 2, { notes: "n", currency: "GBP" }, { at: "2026-11-01T00:00:00Z", type: "edited", actor: "u1" });
    const update = calls[0].ops[0];
    expect(update[0]).toBe("update");
    expect("project_id" in (update[1] as object)).toBe(false);
  });

  it("naming the link writes it, and an empty one writes NULL", async () => {
    const event = { at: "2026-11-01T00:00:00Z", type: "edited", actor: "u1" };
    const set = recordingSb({ ...invoice });
    await supabaseStore(set.sb).updateDraft("w1", "i1", 2, { projectId: "p1" }, event);
    expect(set.calls[0].ops[0][1]).toMatchObject({ project_id: "p1" });
    const clear = recordingSb({ ...invoice });
    await supabaseStore(clear.sb).updateDraft("w1", "i1", 2, { projectId: "" }, event);
    expect(clear.calls[0].ops[0][1]).toMatchObject({ project_id: null });
  });

  it("a new invoice never writes the column", async () => {
    const { sb, calls } = recordingSb({ ...invoice });
    await supabaseStore(sb).insertInvoice(
      { workspaceId: "w1", clientId: "c1", createdBy: "u1", revision: 1, status: "Draft", number: "", currency: "GBP", issueDate: "2026-11-01", dueDate: "2026-11-15", lines: [], taxBps: 0, subtotalMinor: 0, taxMinor: 0, totalMinor: 0, notes: "", created: "", updated: "" },
      { at: "2026-11-01T00:00:00Z", type: "created", actor: "u1" },
    );
    expect("project_id" in (calls[0].ops[0][1] as object)).toBe(false);
  });
});
