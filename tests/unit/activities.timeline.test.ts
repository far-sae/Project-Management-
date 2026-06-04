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

import { noteToActivity, emailToActivity, filterByEntity } from "@/services/supabase/activities";

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

describe("filterByEntity", () => {
  const clientNote = noteToActivity({
    id: "n1", organization_id: "o1", client_id: "c1", lead_id: null, deal_id: null,
    kind: "note", subject: "client note", body: null, occurred_at: "2026-06-04T10:00:00Z",
    author_id: "u1", author_name: "Sam",
  });
  const dealNote = noteToActivity({
    id: "n2", organization_id: "o1", client_id: "c1", lead_id: null, deal_id: "d1",
    kind: "note", subject: "deal note", body: null, occurred_at: "2026-06-04T10:00:00Z",
    author_id: "u1", author_name: "Sam",
  });
  const leadNote = noteToActivity({
    id: "n3", organization_id: "o1", client_id: null, lead_id: "l1", deal_id: null,
    kind: "note", subject: "lead note", body: null, occurred_at: "2026-06-04T10:00:00Z",
    author_id: "u1", author_name: "Sam",
  });
  const clientEmail = emailToActivity({
    event_id: "e1", organization_id: "o1", entity_type: "client", entity_id: "c1",
    direction: "inbound", subject: "Hello", snippet: null, from_email: "a@b.com",
    occurred_at: "2026-06-04T10:00:00Z",
  });
  const dealEmail = emailToActivity({
    event_id: "e2", organization_id: "o1", entity_type: "deal", entity_id: "d1",
    direction: "outbound", subject: "Proposal", snippet: null, from_email: "me@b.com",
    occurred_at: "2026-06-04T10:00:00Z",
  });

  const all = [clientNote, dealNote, leadNote, clientEmail, dealEmail];

  it("filters to a specific client", () => {
    const result = filterByEntity(all, "client", "c1");
    expect(result.map((a) => a.id)).toEqual(
      expect.arrayContaining(["note:n1", "note:n2", "email:e1"]),
    );
    expect(result.find((a) => a.id === "note:n3")).toBeUndefined();
  });

  it("filters to a specific deal", () => {
    const result = filterByEntity(all, "deal", "d1");
    expect(result.map((a) => a.id)).toEqual(
      expect.arrayContaining(["note:n2", "email:e2"]),
    );
    expect(result.find((a) => a.id === "note:n1")).toBeUndefined();
  });

  it("filters to a specific lead", () => {
    const result = filterByEntity(all, "lead", "l1");
    expect(result.map((a) => a.id)).toEqual(["note:n3"]);
  });
});
