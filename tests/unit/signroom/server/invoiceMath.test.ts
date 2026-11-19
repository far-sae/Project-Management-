// @vitest-environment node
import { describe, expect, it } from "vitest";
import { balance, CURRENCIES, decimal, money, totals } from "../../../../api/_signroom/shared/invoiceMath";
import type { Invoice } from "../../../../api/_signroom/shared/types";

const line = (o: Record<string, unknown> = {}) => ({ description: "A", quantity: "1.5", rate: "10.00", ...o });

describe("invoice maths", () => {
  it("totals a line with invoice-wide tax", () => {
    const t = totals([line()], "20");
    expect(t.subtotalMinor).toBe(1500);
    expect(t.taxMinor).toBe(300);
    expect(t.totalMinor).toBe(1800);
    expect(t.taxBps).toBe(2000);
    expect(t.lines[0]).toMatchObject({ quantityMilli: 1500, rateMinor: 1000, totalMinor: 1500, billingType: "One-off" });
  });

  it("rounds half up", () => {
    // 0.005 x 1.00 = 0.005 -> rounds to 1 minor (half up)
    expect(totals([{ description: "x", quantity: "0.005", rate: "1.00" }], "0").subtotalMinor).toBe(1);
    // 1.00 x 0.004 = 0.4 minor -> 0
    expect(totals([{ description: "x", quantity: "0.004", rate: "1.00" }], "0").subtotalMinor).toBe(0);
    // tax 5% of 10 minor = 0.5 -> 1
    expect(totals([{ description: "x", quantity: "1", rate: "0.10" }], "5").taxMinor).toBe(1);
  });

  it("lets per-line tax win over the invoice-wide percentage", () => {
    const t = totals([line({ taxPercent: "5" }), line({ taxPercent: "0" })], "20");
    expect(t.lines.map((l) => l.taxMinor)).toEqual([75, 0]);
    expect(t.taxMinor).toBe(75);
    expect(t.totalMinor).toBe(3000 + 75);
  });

  it("refuses 0 and 101 lines", () => {
    expect(() => totals([], "0")).toThrow(/1 to 100/);
    expect(() => totals(Array.from({ length: 101 }, () => line()), "0")).toThrow(/1 to 100/);
    expect(totals(Array.from({ length: 100 }, () => line()), "0").lines).toHaveLength(100);
  });

  it("validates decimals, tax range and custom labels", () => {
    expect(() => decimal("1.234", 2)).toThrow();
    expect(decimal("12.5", 2)).toBe(1250);
    expect(() => totals([line()], "100.01")).toThrow(/Tax rate/);
    expect(() => totals([line({ billingType: "Custom" })], "0")).toThrow(/custom billing label/);
    expect(() => totals([line({ billingType: "Weekly" })], "0")).toThrow(/billing type/);
  });

  it("formats money and balances", () => {
    expect(money(123456, "GBP").replace(/\u00a0/g, " ")).toBe("GBP 1,234.56");
    expect(CURRENCIES).toEqual(["GBP", "USD", "EUR", "CAD", "AUD", "NZD", "INR", "AED"]);
    const inv = { totalMinor: 1800, payments: [{ amountMinor: 500 }, { amountMinor: 300 }] } as unknown as Invoice;
    expect(balance(inv)).toBe(1000);
  });
});
