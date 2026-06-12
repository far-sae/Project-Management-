// tests/unit/accountLeads.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  createLead,
  updateLead,
  listAccountLeads,
  listUnassignedLeads,
} from "@/services/supabase/leads";

// Use a local-org id so the service hits its localStorage-backed fallback
// path (no Supabase round-trips). This exercises the same account_id/category
// filtering logic the Supabase path uses.
const ORG = "local-test-accountleads";

const base = (over: Partial<Parameters<typeof createLead>[3]> = {}) => ({
  lastName: "Doe",
  company: "Acme",
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe("account-scoped leads", () => {
  it("listUnassignedLeads returns only leads with no category", async () => {
    // Leads are organised by category now — "unassigned" = no category yet
    // (account_id is irrelevant to this list).
    await createLead(ORG, null, null, base({ lastName: "Uncat1" }));
    await createLead(ORG, null, null, base({ lastName: "Uncat2" }));
    await createLead(ORG, null, null, base({ lastName: "Filed", category: "Enterprise" }));

    const unassigned = await listUnassignedLeads(ORG);
    expect(unassigned).toHaveLength(2);
    expect(unassigned.every((l) => !l.category)).toBe(true);
    expect(unassigned.map((l) => l.lastName).sort()).toEqual([
      "Uncat1",
      "Uncat2",
    ]);
  });

  it("listAccountLeads filters by account_id", async () => {
    await createLead(ORG, null, null, base({ lastName: "A1", accountId: "acct-1", category: "Enterprise" }));
    await createLead(ORG, null, null, base({ lastName: "A2", accountId: "acct-1", category: "SMB" }));
    await createLead(ORG, null, null, base({ lastName: "B1", accountId: "acct-2" }));
    await createLead(ORG, null, null, base({ lastName: "Free" }));

    const acct1 = await listAccountLeads(ORG, "acct-1");
    expect(acct1.map((l) => l.lastName).sort()).toEqual(["A1", "A2"]);
    expect(acct1.every((l) => l.accountId === "acct-1")).toBe(true);

    const acct2 = await listAccountLeads(ORG, "acct-2");
    expect(acct2.map((l) => l.lastName)).toEqual(["B1"]);
  });

  it("persists category alongside account_id and round-trips through the mapper", async () => {
    const created = await createLead(
      ORG, null, null,
      base({ lastName: "Cat", accountId: "acct-9", category: "Strategic" }),
    );
    expect(created.accountId).toBe("acct-9");
    expect(created.category).toBe("Strategic");
  });

  it("updateLead moves a lead into an account + category (the 'Move to account' path)", async () => {
    const created = await createLead(ORG, null, null, base({ lastName: "Mover" }));
    expect(created.accountId).toBeNull();

    const moved = await updateLead(ORG, created.leadId, {
      accountId: "acct-7",
      category: "Inbound",
    });
    expect(moved.accountId).toBe("acct-7");
    expect(moved.category).toBe("Inbound");

    // No longer surfaces as unassigned; now lives under the account.
    expect(await listUnassignedLeads(ORG)).toHaveLength(0);
    expect((await listAccountLeads(ORG, "acct-7")).map((l) => l.leadId)).toEqual([
      created.leadId,
    ]);
  });
});
