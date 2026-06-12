// tests/unit/dashboardWidgets.test.ts
import { describe, it, expect } from "vitest";
import {
  addWidget,
  removeWidget,
  reorderWidget,
  moveWidget,
  setWidgetSize,
} from "@/lib/dashboardWidgets";
import type { Widget } from "@/services/dashboards/dashboards";

const mk = (over: Partial<Widget> = {}): Widget => ({
  id: over.id ?? crypto.randomUUID(),
  metricId: over.metricId ?? "deals_by_stage",
  title: over.title ?? "Deals by stage",
  chartType: over.chartType ?? "bar",
  dimension: over.dimension,
  timeframe: over.timeframe,
  size: over.size ?? "md",
  order: over.order ?? 0,
});

describe("dashboardWidgets helpers", () => {
  it("addWidget appends a widget with the next order and does not mutate input", () => {
    const a = mk({ id: "a", order: 0 });
    const b = mk({ id: "b", order: 1 });
    const list = [a, b];
    const next = addWidget(list, mk({ id: "c", order: 999 }));
    expect(next).toHaveLength(3);
    // original untouched
    expect(list).toHaveLength(2);
    // new widget placed at the end with order = length-based next index
    expect(next[2].id).toBe("c");
    expect(next[2].order).toBe(2);
  });

  it("addWidget normalizes order to a 0..n-1 sequence", () => {
    const next = addWidget([], mk({ id: "first" }));
    expect(next[0].order).toBe(0);
  });

  it("removeWidget drops the matching id and re-sequences order", () => {
    const list = [
      mk({ id: "a", order: 0 }),
      mk({ id: "b", order: 1 }),
      mk({ id: "c", order: 2 }),
    ];
    const next = removeWidget(list, "b");
    expect(next.map((w) => w.id)).toEqual(["a", "c"]);
    expect(next.map((w) => w.order)).toEqual([0, 1]);
    // unknown id is a no-op (still re-sequenced, same members)
    expect(removeWidget(list, "zzz").map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("reorderWidget moves a widget up and down within bounds", () => {
    const list = [
      mk({ id: "a", order: 0 }),
      mk({ id: "b", order: 1 }),
      mk({ id: "c", order: 2 }),
    ];
    const up = reorderWidget(list, "b", "up");
    expect(up.map((w) => w.id)).toEqual(["b", "a", "c"]);
    expect(up.map((w) => w.order)).toEqual([0, 1, 2]);

    const down = reorderWidget(list, "b", "down");
    expect(down.map((w) => w.id)).toEqual(["a", "c", "b"]);
    expect(down.map((w) => w.order)).toEqual([0, 1, 2]);
  });

  it("reorderWidget at the edges is a no-op", () => {
    const list = [
      mk({ id: "a", order: 0 }),
      mk({ id: "b", order: 1 }),
    ];
    expect(reorderWidget(list, "a", "up").map((w) => w.id)).toEqual(["a", "b"]);
    expect(reorderWidget(list, "b", "down").map((w) => w.id)).toEqual(["a", "b"]);
    // unknown id is a no-op
    expect(reorderWidget(list, "zzz", "up").map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("moveWidget drops a widget into an arbitrary slot (drag reorder)", () => {
    const list = [
      mk({ id: "a", order: 0 }),
      mk({ id: "b", order: 1 }),
      mk({ id: "c", order: 2 }),
      mk({ id: "d", order: 3 }),
    ];
    // drag "a" onto "c" → a lands where c was, shifting b/c left
    const fwd = moveWidget(list, "a", "c");
    expect(fwd.map((w) => w.id)).toEqual(["b", "c", "a", "d"]);
    expect(fwd.map((w) => w.order)).toEqual([0, 1, 2, 3]);

    // drag "d" onto "a" → d jumps to the front
    const back = moveWidget(list, "d", "a");
    expect(back.map((w) => w.id)).toEqual(["d", "a", "b", "c"]);
    expect(back.map((w) => w.order)).toEqual([0, 1, 2, 3]);

    // original untouched
    expect(list.map((w) => w.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("moveWidget is a no-op for same id or unknown ids", () => {
    const list = [
      mk({ id: "a", order: 0 }),
      mk({ id: "b", order: 1 }),
    ];
    expect(moveWidget(list, "a", "a").map((w) => w.id)).toEqual(["a", "b"]);
    expect(moveWidget(list, "zzz", "a").map((w) => w.id)).toEqual(["a", "b"]);
    expect(moveWidget(list, "a", "zzz").map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("setWidgetSize updates only the matching widget's size", () => {
    const list = [
      mk({ id: "a", order: 0, size: "sm" }),
      mk({ id: "b", order: 1, size: "md" }),
    ];
    const next = setWidgetSize(list, "b", "lg");
    expect(next.find((w) => w.id === "b")?.size).toBe("lg");
    expect(next.find((w) => w.id === "a")?.size).toBe("sm");
    // original untouched
    expect(list.find((w) => w.id === "b")?.size).toBe("md");
  });
});
