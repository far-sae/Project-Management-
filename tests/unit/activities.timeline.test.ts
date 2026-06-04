import { describe, it, expect } from "vitest";
import { dayBucket, isToday, isOverdue } from "@/services/supabase/activities";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-06-04T12:00:00Z");

describe("dayBucket", () => {
  it("buckets relative to now", () => {
    expect(dayBucket(at("2026-06-04T09:00:00Z"), NOW)).toBe("Today");
    expect(dayBucket(at("2026-06-03T09:00:00Z"), NOW)).toBe("Yesterday");
    expect(dayBucket(at("2026-05-31T09:00:00Z"), NOW)).toBe("This week");
    expect(dayBucket(at("2026-05-01T09:00:00Z"), NOW)).toBe("Earlier");
    expect(dayBucket(null, NOW)).toBe("Earlier");
  });
});

describe("isToday / isOverdue", () => {
  it("isToday is true only for same calendar day", () => {
    expect(isToday(at("2026-06-04T23:00:00Z"), NOW)).toBe(true);
    expect(isToday(at("2026-06-05T01:00:00Z"), NOW)).toBe(false);
  });
  it("isOverdue is past + open", () => {
    expect(isOverdue(at("2026-06-03T09:00:00Z"), true, NOW)).toBe(true);
    expect(isOverdue(at("2026-06-05T09:00:00Z"), true, NOW)).toBe(false); // future
    expect(isOverdue(at("2026-06-03T09:00:00Z"), false, NOW)).toBe(false); // closed
    expect(isOverdue(null, true, NOW)).toBe(false);
  });
});

import { noteToActivity, emailToActivity } from "@/services/supabase/activities";

describe("note/email mapping", () => {
  it("maps a note to a logged activity", () => {
    const a = noteToActivity({
      id: "n1", organization_id: "o1", client_id: "c1", lead_id: null, deal_id: null,
      kind: "note", subject: null, body: "Called, will renew", occurred_at: "2026-06-03T10:00:00Z",
      author_id: "u1", author_name: "Sam",
    });
    expect(a.kind).toBe("note");
    expect(a.open).toBe(false);
    expect(a.title).toContain("Called");
    expect(a.ownerUserId).toBe("u1");
  });
  it("maps an email event to a logged activity", () => {
    const a = emailToActivity({
      event_id: "e1", organization_id: "o1", entity_type: "deal", entity_id: "d1",
      direction: "outbound", subject: "Proposal", snippet: "Here it is", from_email: "me@x.com",
      occurred_at: "2026-06-02T10:00:00Z",
    });
    expect(a.kind).toBe("email");
    expect(a.open).toBe(false);
    expect(a.title).toContain("Proposal");
  });
});
