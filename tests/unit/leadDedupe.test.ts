// tests/unit/leadDedupe.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  isLeadDuplicate,
  findLeadDuplicates,
  createLead,
  exportLeadsToCsv,
  LEAD_CSV_HEADERS,
  type Lead,
} from "@/services/supabase/leads";

// Local-org id → localStorage-backed fallback (no Supabase round-trips), same
// pattern as accountLeads.test.ts. findLeadDuplicates scans getOrganizationLeads.
const ORG = "local-test-leaddedupe";

beforeEach(() => {
  localStorage.clear();
});

describe("isLeadDuplicate (pure matcher)", () => {
  it("matches on case-insensitive exact email", () => {
    expect(
      isLeadDuplicate(
        { email: "Jane@Acme.com", lastName: "Doe", company: "Acme" },
        { email: "jane@acme.com", lastName: "Smith", company: "Globex" },
      ),
    ).toBe(true);
  });

  it("matches on case-insensitive lastName + company when emails differ/absent", () => {
    expect(
      isLeadDuplicate(
        { email: null, lastName: "Doe", company: "Acme Inc" },
        { email: "other@x.com", lastName: "doe", company: "acme inc" },
      ),
    ).toBe(true);
  });

  it("does NOT match on lastName alone (company differs)", () => {
    expect(
      isLeadDuplicate(
        { lastName: "Doe", company: "Acme" },
        { lastName: "Doe", company: "Globex" },
      ),
    ).toBe(false);
  });

  it("does NOT match on company alone (lastName differs)", () => {
    expect(
      isLeadDuplicate(
        { lastName: "Doe", company: "Acme" },
        { lastName: "Smith", company: "Acme" },
      ),
    ).toBe(false);
  });

  it("returns false when there is nothing to match on", () => {
    expect(isLeadDuplicate({}, { email: "a@b.com" })).toBe(false);
    expect(isLeadDuplicate({ lastName: "Doe" }, { lastName: "Doe" })).toBe(false);
  });
});

describe("findLeadDuplicates (org-scoped)", () => {
  it("returns existing leads matching by email", async () => {
    await createLead(ORG, null, null, { lastName: "Doe", company: "Acme", email: "jane@acme.com" });
    await createLead(ORG, null, null, { lastName: "Smith", company: "Globex", email: "bob@globex.com" });

    const dupes = await findLeadDuplicates(ORG, { email: "JANE@acme.com", lastName: "X", company: "Y" });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].email).toBe("jane@acme.com");
  });

  it("returns existing leads matching by lastName + company", async () => {
    await createLead(ORG, null, null, { lastName: "Doe", company: "Acme Inc" });
    await createLead(ORG, null, null, { lastName: "Doe", company: "Globex" });

    const dupes = await findLeadDuplicates(ORG, { lastName: "doe", company: "ACME INC" });
    expect(dupes.map((l) => l.company)).toEqual(["Acme Inc"]);
  });

  it("returns [] when nothing matches", async () => {
    await createLead(ORG, null, null, { lastName: "Doe", company: "Acme" });
    expect(await findLeadDuplicates(ORG, { email: "nobody@nowhere.com" })).toEqual([]);
  });

  it("returns [] when the candidate has nothing to match on", async () => {
    await createLead(ORG, null, null, { lastName: "Doe", company: "Acme" });
    expect(await findLeadDuplicates(ORG, {})).toEqual([]);
  });
});

describe("exportLeadsToCsv", () => {
  const makeLead = (over: Partial<Lead> = {}): Lead => ({
    leadId: "id-1",
    organizationId: ORG,
    workspaceId: "ws-1",
    leadNumber: "L-000001",
    salutation: null,
    firstName: "Jane",
    lastName: "Doe",
    title: null,
    email: "jane@acme.com",
    phone: null,
    mobile: null,
    fax: null,
    website: null,
    skypeId: null,
    twitter: null,
    linkedinUrl: null,
    company: "Acme",
    industry: null,
    annualRevenue: null,
    noOfEmployees: null,
    street: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    leadOwnerId: null,
    leadOwnerName: null,
    leadSource: null,
    leadStatus: "new",
    rating: null,
    emailOptOut: false,
    accountId: null,
    category: null,
    convertedAt: null,
    convertedToClientId: null,
    convertedToContactId: null,
    convertedToDealId: null,
    description: null,
    tags: [],
    customFields: {},
    imageUrl: null,
    createdBy: null,
    createdByName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it("emits the header row then one row per lead", () => {
    const csv = exportLeadsToCsv([makeLead(), makeLead({ leadNumber: "L-000002", lastName: "Smith" })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(LEAD_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("L-000001");
    expect(lines[2]).toContain("Smith");
  });

  it("quotes values containing commas/quotes/newlines and joins tags with ;", () => {
    const csv = exportLeadsToCsv([
      makeLead({ company: "Acme, Inc", description: 'He said "hi"', tags: ["vip", "hot"] }),
    ]);
    expect(csv).toContain('"Acme, Inc"');
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain("vip;hot");
  });

  it("writes a human-readable lead status label", () => {
    const csv = exportLeadsToCsv([makeLead({ leadStatus: "attempted_to_contact" })]);
    expect(csv).toContain("Attempted to Contact");
  });
});
