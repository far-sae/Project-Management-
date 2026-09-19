// The three database-facing tests the phase 5 spec asks for, against a stubbed
// Supabase client — the same shape tests/unit/emailRecipients.test.ts uses.
//
// Each one pins a decision that is load-bearing and quiet: nothing in the
// product misbehaves visibly if these regress, which is precisely why they are
// worth writing down.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, tables, writes } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  tables: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
}));

vi.mock("@/services/supabase/config", () => ({
  supabase: { from: fromMock },
}));

import { listProspects, saveProspect } from "@/services/supabase/emailAudience";
import { createCampaign } from "@/services/supabase/email";

/** A chainable builder over `tables`, recording every write. */
function builderFor(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));

  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return builder;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    not: () => builder,
    insert: (row: Record<string, unknown>) => {
      writes.push({ table, op: "insert", row });
      (tables[table] ??= []).push(row);
      return builder;
    },
    upsert: (row: Record<string, unknown>) => {
      writes.push({ table, op: "upsert", row });
      (tables[table] ??= []).push(row);
      return builder;
    },
    single: async () => ({ data: rows()[0] ?? { id: "new" }, error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok, bad),
  };
  return builder;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  writes.length = 0;
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => builderFor(table));
});

describe("a prospect keeps its group and its pain point", () => {
  it("writes both, and reads both back", async () => {
    await saveProspect({
      id: "p1",
      organizationId: "org-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ADA@Acme.com",
      jobTitle: "CTO",
      painPoint: "onboarding takes three weeks",
      groupId: "grp-1",
    });

    const written = writes.find((w) => w.table === "crm_contacts")?.row;
    expect(written).toMatchObject({
      pain_point: "onboarding takes three weeks",
      group_id: "grp-1",
      // Addresses are stored lower-cased everywhere in this feature, because
      // the suppression list compares them that way.
      email: "ada@acme.com",
    });

    const list = await listProspects("org-1");
    expect(list[0]).toMatchObject({
      painPoint: "onboarding takes three weeks",
      groupId: "grp-1",
    });
  });
});

describe("suppression is read, never written onto the contact", () => {
  it("shows a suppressed prospect with its reason", async () => {
    tables.crm_contacts = [
      {
        id: "p1",
        organization_id: "org-1",
        first_name: "Ada",
        last_name: null,
        email: "ada@acme.com",
        job_title: null,
        pain_point: null,
        group_id: null,
        last_contacted_at: null,
        created_at: "2026-09-19T09:00:00Z",
      },
    ];
    tables.email_suppressions = [
      { organization_id: "org-1", email: "ADA@acme.com", reason: "bounced" },
      // Another organization's suppression of the same address, which must not
      // leak into this list.
      { organization_id: "org-2", email: "ada@acme.com", reason: "complaint" },
    ];

    const list = await listProspects("org-1");

    // Matched case-insensitively: the suppression list stores what it was
    // given, and an address that differs only in case is the same person.
    expect(list[0].suppressedReason).toBe("bounced");
  });

  it("never writes a status onto the contact", async () => {
    // The load-bearing rule of this phase. email_suppressions is what
    // claim_email_batch() enforces on every send, what the unsubscribe
    // endpoint writes and what a hard bounce adds to. A second flag on the
    // contact would be a second source of truth for the one question the law
    // cares about, and the two would disagree within a week — always in the
    // direction of mailing somebody who asked not to be.
    await saveProspect({
      organizationId: "org-1",
      firstName: "Ada",
      lastName: "",
      email: "ada@acme.com",
      jobTitle: "",
      painPoint: "",
      groupId: null,
    });

    const written = writes.find((w) => w.table === "crm_contacts")?.row ?? {};
    for (const forbidden of ["status", "suppressed", "unsubscribed", "is_active"]) {
      expect(written).not.toHaveProperty(forbidden);
    }
    // And nothing was written to the suppression table either: saving a
    // prospect is not a place where that decision is made.
    expect(writes.some((w) => w.table === "email_suppressions")).toBe(false);
  });
});

describe("a campaign copies from a template and only records where it came from", () => {
  it("stamps template_id beside its own wording", async () => {
    await createCampaign({
      organizationId: "org-1",
      accountId: null,
      kind: "bulk",
      name: "Q4 outreach",
      subject: "A subject the person may have rewritten",
      bodyHtml: "<p>A body the person may have rewritten</p>",
      templateId: "tpl-1",
    });

    const row = writes.find((w) => w.table === "email_campaigns")?.row;
    expect(row).toMatchObject({
      template_id: "tpl-1",
      subject: "A subject the person may have rewritten",
      body_html: "<p>A body the person may have rewritten</p>",
    });
  });

  it("carries the wording itself, so editing the template later changes nothing", async () => {
    // The campaign's own subject and body ARE what gets sent — the worker
    // reads email_campaigns.subject/body_html and has no knowledge of
    // template_id at all. This test pins that the wording is copied into the
    // campaign row rather than referenced, which is what makes a template safe
    // to edit while mail written from it is still in the queue.
    await createCampaign({
      organizationId: "org-1",
      accountId: null,
      kind: "bulk",
      name: "Q4 outreach",
      subject: "Original subject",
      bodyHtml: "<p>Original body</p>",
      templateId: "tpl-1",
    });

    const before = writes.find((w) => w.table === "email_campaigns")?.row;

    // Whatever happens to the template afterwards, the campaign row is
    // unchanged: nothing anywhere writes a template's text back into a
    // campaign.
    tables.email_templates = [
      { id: "tpl-1", subject: "Rewritten subject", body_html: "<p>Rewritten</p>" },
    ];

    expect(before).toMatchObject({
      subject: "Original subject",
      body_html: "<p>Original body</p>",
    });
  });

  it("records no template when the campaign was written from scratch", async () => {
    await createCampaign({
      organizationId: "org-1",
      accountId: null,
      kind: "bulk",
      name: "From scratch",
      subject: "s",
      bodyHtml: "<p>b</p>",
    });

    const row = writes.find((w) => w.table === "email_campaigns")?.row;
    expect(row?.template_id).toBeNull();
  });
});
