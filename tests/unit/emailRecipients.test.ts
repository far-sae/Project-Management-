import { describe, it, expect, vi, beforeEach } from "vitest";

// queueRecipients talks to Supabase directly, so mock the client rather than
// hitting a database. `fromMock` is asserted against per test; the table-
// specific builders below just return enough shape for queueRecipients to
// complete without throwing.
const { fromMock, insertedRows } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  insertedRows: [] as Record<string, unknown>[],
}));

vi.mock("@/services/supabase/config", () => ({
  supabase: { from: fromMock },
}));

import { parseRecipientsCsv, parsePastedRecipients, queueRecipients } from "@/services/supabase/email";

beforeEach(() => {
  insertedRows.length = 0;
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    if (table === "email_suppressions") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    if (table === "email_messages") {
      return {
        insert: vi.fn((rows: Record<string, unknown>[]) => {
          insertedRows.push(...rows);
          return Promise.resolve({ error: null });
        }),
      };
    }
    if (table === "email_campaigns") {
      // Same chainable stub serves both `.select().eq().single()` (read the
      // running counts) and `.update().eq()` (write them back) — `.eq()`
      // just returns the builder either way, and whichever call is actually
      // awaited resolves via `.single()` or the plain object itself.
      const builder: { select: () => typeof builder; update: () => typeof builder; eq: () => typeof builder; single: () => Promise<{ data: unknown; error: null }> } = {
        select: () => builder,
        update: () => builder,
        eq: () => builder,
        single: () => Promise.resolve({ data: { queued_count: 0, suppressed_count: 0 }, error: null }),
      };
      return builder;
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
});

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

describe("queueRecipients", () => {
  const recipients = [
    { email: "a@x.com", mergeData: {} },
    { email: "b@x.com", mergeData: {} },
  ];

  it("stamps every inserted row's send_after when a schedule time is given", async () => {
    const sendAfter = new Date("2030-01-01T12:00:00.000Z");
    await queueRecipients("camp-1", "org-1", recipients, sendAfter);

    expect(insertedRows).toHaveLength(2);
    for (const row of insertedRows) {
      expect(row.send_after).toBe(sendAfter.toISOString());
    }
  });

  it("leaves send_after unset (the column's now() default) when no schedule time is given", async () => {
    await queueRecipients("camp-1", "org-1", recipients);

    expect(insertedRows).toHaveLength(2);
    for (const row of insertedRows) {
      expect(row).not.toHaveProperty("send_after");
    }
  });

  it("also omits send_after when explicitly passed null (send-now path)", async () => {
    await queueRecipients("camp-1", "org-1", recipients, null);

    expect(insertedRows).toHaveLength(2);
    for (const row of insertedRows) {
      expect(row).not.toHaveProperty("send_after");
    }
  });
});
