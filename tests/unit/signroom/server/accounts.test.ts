// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildStatement,
  londonToday,
  projectPaymentStatus,
  projectYear,
} from "../../../../api/_signroom/shared/accounts";
import type { ClientProject, Invoice } from "../../../../api/_signroom/shared/types";

const P: ClientProject = {
  id: "p1",
  workspaceId: "w",
  clientId: "c",
  createdBy: "u",
  name: "Plan",
  billingType: "Monthly",
  billingLabel: "",
  currency: "GBP",
  monthlyFeeMinor: 10000,
  contractValueMinor: 0,
  annualTargetMinor: 0,
  startMonth: "2026-01",
  endMonth: "2026-12",
  status: "Active",
  notes: "",
  archived: false,
  revision: 1,
  created: "2026-01-01T00:00:00Z",
  updated: "2026-01-01T00:00:00Z",
};

const inv = (o: Record<string, unknown> = {}): Invoice =>
  ({
    id: "i1",
    workspaceId: "w",
    clientId: "c",
    createdBy: "u",
    revision: 1,
    status: "Issued",
    number: "INV-1",
    currency: "GBP",
    issueDate: "2026-01-01",
    dueDate: "2026-01-10",
    lines: [],
    taxBps: 0,
    subtotalMinor: 10000,
    taxMinor: 0,
    totalMinor: 10000,
    notes: "",
    created: "",
    updated: "",
    payments: [],
    events: [],
    ...o,
  }) as Invoice;

const pay = (id: string, amountMinor: number, paidOn: string) => ({
  id,
  amountMinor,
  paidOn,
  reference: "",
  method: "Bank",
  receiptNumber: "R-" + id,
  receiptHash: "",
  recordedAt: "",
});

describe("londonToday", () => {
  it.each([
    ["2026-06-30T23:30:00Z", "2026-07-01"],
    ["2026-06-30T22:30:00Z", "2026-06-30"],
    ["2026-12-31T23:30:00Z", "2026-12-31"],
    ["2026-03-29T00:30:00Z", "2026-03-29"],
    ["2026-03-29T23:30:00Z", "2026-03-30"],
    ["2026-10-24T23:30:00Z", "2026-10-25"],
    ["2026-10-25T23:30:00Z", "2026-10-25"],
  ])("%s is %s", (at, day) => {
    expect(londonToday(new Date(at))).toBe(day);
  });
});

describe("projectYear", () => {
  const L = inv({
    projectId: "p1",
    payments: [pay("a", 2500, "2026-11-17")],
  });
  it("counts linked payments", () => {
    const y = projectYear(P, [L], 2026);
    expect(y.receivedMinor).toBe(2500);
    expect(y.outstandingMinor).toBe(7500);
    expect(y.months[10]).toBe(2500);
    expect(y.targetMinor).toBe(120000);
    expect(y.invoicedMinor).toBe(10000);
  });
  it("counts active months for the target", () => {
    expect(
      projectYear({ ...P, startMonth: "2026-03", endMonth: "2026-05" }, [], 2026).targetMinor,
    ).toBe(30000);
  });
  it("ignores other years", () => {
    expect(projectYear(P, [L], 2027).receivedMinor).toBe(0);
  });
  it("adds monthly entries", () => {
    const y = projectYear(
      {
        ...P,
        monthlyEntries: {
          "2026-11": { paidMinor: 3000, expectedMinor: 10000, notes: "", updated: "", updatedBy: "u" },
        },
      },
      [L],
      2026,
    );
    expect(y.months[10]).toBe(5500);
    expect(y.invoiceMonths[10]).toBe(2500);
    expect(y.upcomingMonths[10]).toBe(4500);
    expect(y.outstandingMinor).toBe(7500);
  });
  it.each([
    ["Draft", {}],
    ["Voided", {}],
    ["Issued", { currency: "USD" }],
  ])("does not count %s %j", (status, extra) => {
    const y = projectYear(P, [{ ...L, status, ...extra } as Invoice], 2026);
    expect(y.receivedMinor).toBe(0);
    expect(y.invoicedMinor).toBe(0);
  });
  it("one-off contract falls in its start year", () => {
    const o = { ...P, billingType: "One-off" as const, contractValueMinor: 120000, startMonth: "2026-04", endMonth: "" };
    expect(projectYear(o, [], 2026).targetMinor).toBe(120000);
    const y27 = projectYear(o, [], 2027);
    expect(y27.targetMinor).toBe(0);
    expect(projectYear(o, [], 2026).expectedMonths.every((n) => n === 0)).toBe(true);
  });
  it("annual target overrides", () => {
    const y = projectYear({ ...P, annualTargetMinor: 50000 }, [L], 2026);
    expect(y.targetMinor).toBe(50000);
    expect(y.remainingTargetMinor).toBe(47500);
  });
});

describe("projectPaymentStatus", () => {
  it("classifies", () => {
    expect(projectPaymentStatus(0, 100, 2026, 5, "2026-07")).toBe("overdue");
    expect(projectPaymentStatus(0, 100, 2026, 6, "2026-07")).toBe("upcoming");
    expect(projectPaymentStatus(100, 0, 2026, 5, "2026-07")).toBe("paid");
    expect(projectPaymentStatus(0, 0, 2026, 5, "2026-07")).toBe("neutral");
  });
});

describe("buildStatement", () => {
  it("SR fixture", () => {
    const gbp = inv({
      id: "g",
      number: "G-1",
      status: "Part paid",
      payments: [pay("gp", 4000, "2026-01-20")],
    });
    const usd = inv({ id: "u", number: "U-1", currency: "USD", issueDate: "2026-01-02", dueDate: "2026-02-20", totalMinor: 5000 });
    const s = buildStatement([usd, gbp], "2026-01-15", "2026-02-15", "2026-02-15");
    expect(s.opening.GBP).toBe(10000);
    expect(s.opening.USD).toBe(5000);
    expect(s.closing.GBP).toBe(6000);
    expect(s.closing.USD).toBe(5000);
    expect(s.summaries.map((x) => x.currency)).toEqual(["GBP", "USD"]);
    expect(s.summaries[0].days31to60).toBe(6000);
    expect(s.summaries[1].currentMinor).toBe(5000);
    expect(s.entries.length).toBe(1);
    expect(s.asOf).toBe("2026-02-15");
  });
  it.each([
    ["2026-07-01", "currentMinor"],
    ["2026-06-30", "days1to30"],
    ["2026-06-01", "days1to30"],
    ["2026-05-31", "days31to60"],
    ["2026-05-02", "days31to60"],
    ["2026-05-01", "days61to90"],
    ["2026-04-01", "over90"],
  ])("due %s ages into %s", (due, bucket) => {
    const s = buildStatement([inv({ dueDate: due, totalMinor: 1000, issueDate: "2026-01-01" })], "", "", "2026-07-01");
    expect((s.summaries[0] as Record<string, unknown>)[bucket]).toBe(1000);
  });
  it("excludes drafts, voids and future things", () => {
    expect(buildStatement([inv({ status: "Draft" }), inv({ id: "v", status: "Voided" })], "", "", "2026-07-01")).toMatchObject({ summaries: [], entries: [] });
    const late = inv({ payments: [pay("x", 500, "2026-08-01")] });
    const s = buildStatement([late], "", "", "2026-07-01");
    expect(s.summaries[0].receivedMinor).toBe(0);
    expect(s.entries.some((e) => e.kind === "Payment")).toBe(false);
    const future = inv({ id: "f", issueDate: "2026-09-01" });
    const a = buildStatement([future], "", "", "2026-07-01");
    expect(a.summaries).toEqual([]);
    expect(a.entries).toEqual([]);
    const b = buildStatement([future], "", "2026-09-30", "2026-07-01");
    expect(b.summaries).toEqual([]);
    expect(b.entries.length).toBe(1);
  });
});
