// tests/unit/replyToToken.test.ts
import { describe, it, expect } from "vitest";
import { extractRunIdFromTo } from "../../supabase/functions/gmail-inbound/index.ts";

describe("extractRunIdFromTo", () => {
  it("extracts UUID from reply+UUID@domain", () => {
    expect(extractRunIdFromTo("reply+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@inbound.taskcalendar.co.uk"))
      .toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });

  it("returns null when there is no plus token", () => {
    expect(extractRunIdFromTo("reply@inbound.taskcalendar.co.uk")).toBe(null);
  });

  it("returns null for an unrelated address", () => {
    expect(extractRunIdFromTo("someone@example.com")).toBe(null);
  });

  it("case-insensitive on the reply+ prefix", () => {
    expect(extractRunIdFromTo("Reply+abc-DEF-1234-5678-90abcdef1234@x.co"))
      .toBe(null); // not a valid UUID
    expect(extractRunIdFromTo("REPLY+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@x.co"))
      .toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });

  it("handles a To: header with display name + angle brackets", () => {
    const to = '"Reply Bot" <reply+9f4c2a18-3b6e-4f7b-9b1a-1234567890ab@inbound.taskcalendar.co.uk>';
    expect(extractRunIdFromTo(to)).toBe("9f4c2a18-3b6e-4f7b-9b1a-1234567890ab");
  });
});
