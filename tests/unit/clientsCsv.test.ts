import { describe, expect, it } from "vitest";
import {
  getClientCsvHeaderMappings,
  isApolloStyleClientCsv,
  normalizeClientCsvHeader,
} from "@/services/supabase/clients";

describe("client CSV helpers", () => {
  it("maps Apollo-style company headers to client fields", () => {
    expect(normalizeClientCsvHeader("orgName")).toBe("name");
    expect(normalizeClientCsvHeader("orgWebsite")).toBe("website");
    expect(normalizeClientCsvHeader("orgSize")).toBe("employee_count");
    expect(normalizeClientCsvHeader("orgCountry")).toBe("country");
  });

  it("keeps Apollo person fields as supported custom fields", () => {
    expect(normalizeClientCsvHeader("fullName")).toBe("primary_contact_name");
    expect(normalizeClientCsvHeader("position")).toBe("primary_contact_title");
    expect(normalizeClientCsvHeader("linkedinUrl")).toBe("linkedin_url");
    expect(normalizeClientCsvHeader("seniority")).toBe("lead_seniority");
    expect(normalizeClientCsvHeader("functional")).toBe("lead_function");
  });

  it("detects Apollo-style lead exports", () => {
    expect(isApolloStyleClientCsv(["fullName", "email", "orgName", "linkedinUrl"])).toBe(true);
    expect(isApolloStyleClientCsv(["name", "website", "city"])).toBe(false);
  });

  it("reports recognized alias mappings for import previews", () => {
    const mappings = getClientCsvHeaderMappings(["orgName", "random"]);
    expect(mappings).toEqual([
      { source: "orgName", target: "name", mapped: true, recognized: true },
      { source: "random", target: "random", mapped: false, recognized: false },
    ]);
  });
});
