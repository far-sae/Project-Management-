// tests/unit/dealTimelineActivities.test.ts
import { describe, it, expect } from "vitest";
import {
  dealTimelineActivities,
  buildDealActivity,
} from "@/services/supabase/activities";

const fmt = (v: number, c = "USD") => `${c} ${v}`;
const label = (k: string | null) =>
  (({ lead: "Lead", qualified: "Qualified", won: "Won" }) as Record<string, string>)[
    k ?? ""
  ] ?? k ?? "(new)";

const deals = [
  {
    dealId: "d1", clientId: "c1", title: "web", stage: "qualified",
    value: 12222, currency: "GBP", createdAt: new Date("2026-06-09T10:00:00Z"),
  },
  {
    dealId: "d2", clientId: "c1", title: "addon", stage: "lead",
    value: 500, currency: "USD", createdAt: new Date("2026-06-10T10:00:00Z"),
    dealType: "custom",
  },
];

const history = [
  // initial creation row — must be skipped (the "added" entry covers it)
  {
    historyId: "h0", dealId: "d1", fromStage: null, toStage: "qualified",
    amount: 12222, changedAt: new Date("2026-06-09T10:00:00Z"), changedByName: "Alice",
  },
  {
    historyId: "h1", dealId: "d1", fromStage: "qualified", toStage: "won",
    amount: 12222, changedAt: new Date("2026-06-11T10:00:00Z"), changedByName: "Bob",
  },
];

describe("dealTimelineActivities", () => {
  it("adds one 'added' entry per deal (stage + money; money-only for custom)", () => {
    const out = dealTimelineActivities(deals, [], { formatMoney: fmt, stageLabel: label });
    const added = out.filter((a) => a.id.endsWith(":created"));
    expect(added).toHaveLength(2);

    const web = out.find((a) => a.id === "deal:d1:created")!;
    expect(web.kind).toBe("deal");
    expect(web.title).toBe("Deal added: web");
    expect(web.relatedToLabel).toBe("Qualified · GBP 12222");
    expect(web.whenAt?.toISOString()).toBe("2026-06-09T10:00:00.000Z");

    const custom = out.find((a) => a.id === "deal:d2:created")!;
    expect(custom.title).toBe("Custom item added: addon");
    expect(custom.relatedToLabel).toBe("USD 500"); // no stage shown for custom
  });

  it("includes only real stage moves (skips the null→stage creation row)", () => {
    const out = dealTimelineActivities(deals, history, { formatMoney: fmt, stageLabel: label });
    const moves = out.filter((a) => a.id.includes(":stage:"));
    expect(moves).toHaveLength(1);
    expect(moves[0].id).toBe("deal:d1:stage:h1");
    expect(moves[0].title).toBe("web: Qualified → Won");
    expect(moves[0].ownerName).toBe("Bob");
    expect(moves[0].relatedToLabel).toBe("USD 12222");
  });

  it("buildDealActivity sets kind/category/open and a stable id + source", () => {
    const a = buildDealActivity({
      dealId: "x", clientId: null, title: "T",
      headline: "H", detail: null, whenAt: null, eventKey: "created",
    });
    expect(a.kind).toBe("deal");
    expect(a.category).toBe("open_deals");
    expect(a.open).toBe(false);
    expect(a.id).toBe("deal:x:created");
    expect(a.source).toEqual({ kind: "deal", row: { dealId: "x", clientId: null, title: "T" } });
  });
});
