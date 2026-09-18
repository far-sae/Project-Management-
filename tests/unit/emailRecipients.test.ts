import { describe, it, expect } from "vitest";
import { parseRecipientsCsv, parsePastedRecipients } from "@/services/supabase/email";

describe("parsePastedRecipients", () => {
  it("accepts one address per line", () => {
    const { recipients } = parsePastedRecipients("a@x.com\nb@x.com");
    expect(recipients.map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
  });
  it("accepts comma and semicolon separated addresses", () => {
    const { recipients } = parsePastedRecipients("a@x.com, b@x.com; c@x.com");
    expect(recipients).toHaveLength(3);
  });
  it("accepts a display name in angle brackets", () => {
    const { recipients } = parsePastedRecipients("Ada Lovelace <ada@x.com>");
    expect(recipients[0]).toMatchObject({ email: "ada@x.com", name: "Ada Lovelace" });
  });
  it("reports invalid addresses instead of silently dropping them", () => {
    const { recipients, errors } = parsePastedRecipients("good@x.com\nnot-an-email");
    expect(recipients.map((r) => r.email)).toEqual(["good@x.com"]);
    expect(errors.join(" ")).toContain("not-an-email");
  });
  it("dedupes case-insensitively", () => {
    const { recipients } = parsePastedRecipients("a@x.com\nA@X.com");
    expect(recipients).toHaveLength(1);
  });
});

describe("parseRecipientsCsv", () => {
  it("reads an email column and exposes other columns as merge data", () => {
    const csv = "email,first_name,company\nada@x.com,Ada,Acme";
    const { recipients } = parseRecipientsCsv(csv);
    expect(recipients[0].email).toBe("ada@x.com");
    expect(recipients[0].mergeData).toMatchObject({ first_name: "Ada", company: "Acme" });
  });
  it("finds the email column whatever its case or spacing", () => {
    const { recipients } = parseRecipientsCsv(" Email Address \nada@x.com");
    expect(recipients[0].email).toBe("ada@x.com");
  });
  it("errors when no email column exists", () => {
    const { recipients, errors } = parseRecipientsCsv("name,company\nAda,Acme");
    expect(recipients).toHaveLength(0);
    expect(errors.join(" ").toLowerCase()).toContain("email");
  });
  it("skips blank rows", () => {
    const { recipients } = parseRecipientsCsv("email\nada@x.com\n\n");
    expect(recipients).toHaveLength(1);
  });
});
