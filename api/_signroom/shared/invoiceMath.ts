import { AppError } from "../errors.js";
import type { Invoice, InvoiceLine } from "./types.js";

/** Copied from Signroom lib/v2/invoice-math.ts and billing.ts (money, balance, currencies). */

export const CURRENCIES = ["GBP", "USD", "EUR", "CAD", "AUD", "NZD", "INR", "AED"];

export function decimal(value: unknown, places: number): number {
  const s = String(value ?? "").trim();
  if (!new RegExp("^\\d{1,9}(?:\\.\\d{1," + places + "})?$").test(s))
    throw new AppError("Enter a valid positive decimal amount.");
  const [whole, fraction = ""] = s.split(".");
  const amount = Number(whole) * 10 ** places + Number(fraction.padEnd(places, "0"));
  if (!Number.isSafeInteger(amount)) throw new AppError("Amount is too large.");
  return amount;
}

export function totals(
  value: unknown,
  tax: unknown,
): Pick<Invoice, "lines" | "taxBps" | "subtotalMinor" | "taxMinor" | "totalMinor"> {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new AppError("Add 1 to 100 invoice line items.");
  const defaultTaxBps = decimal(tax ?? "0", 2);
  if (defaultTaxBps > 10000) throw new AppError("Tax rate must be between 0 and 100 percent.");
  const perItem = value.some((v) => v && typeof v === "object" && v.taxPercent !== undefined);
  const lines: InvoiceLine[] = value.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new AppError("Invalid invoice line item.");
    const description = String(v.description || "")
        .trim()
        .slice(0, 1500),
      quantityMilli = decimal(v.quantity, 3),
      rateMinor = decimal(v.rate, 2);
    if (!description || !quantityMilli)
      throw new AppError("Each line needs a description and quantity greater than zero.");
    const totalMinor = Number((BigInt(quantityMilli) * BigInt(rateMinor) + BigInt(500)) / BigInt(1000));
    if (totalMinor > 1e12) throw new AppError("Line total is too large.");
    const billingType = String(v.billingType || "One-off");
    if (!["One-off", "Monthly", "Quarterly", "Yearly", "Custom"].includes(billingType))
      throw new AppError("Choose a supported billing type.");
    const billingLabel = String(v.billingLabel || "").trim();
    if (
      billingType === "Custom" &&
      (!billingLabel || billingLabel.length > 80 || /[\x00-\x1f]/.test(billingLabel))
    )
      throw new AppError("Enter a custom billing label up to 80 characters, without line breaks.");
    const taxBps = v.taxPercent === undefined ? defaultTaxBps : decimal(v.taxPercent, 2);
    if (taxBps > 10000) throw new AppError("Tax rate must be between 0 and 100 percent.");
    const taxMinor = Number((BigInt(totalMinor) * BigInt(taxBps) + BigInt(5000)) / BigInt(10000));
    return {
      description,
      quantityMilli,
      rateMinor,
      totalMinor,
      billingType: billingType as NonNullable<InvoiceLine["billingType"]>,
      ...(billingType === "Custom" ? { billingLabel } : {}),
      ...(perItem ? { taxBps, taxMinor } : {}),
    };
  });
  const taxBps = decimal(tax ?? "0", 2);
  if (taxBps > 10000) throw new AppError("Tax rate must be between 0 and 100 percent.");
  const subtotalMinor = lines.reduce((n, l) => n + l.totalMinor, 0);
  if (subtotalMinor > 1e12) throw new AppError("Invoice total is too large.");
  const taxMinor = perItem
    ? lines.reduce((sum, l) => sum + (l.taxMinor || 0), 0)
    : Number((BigInt(subtotalMinor) * BigInt(taxBps) + BigInt(5000)) / BigInt(10000));
  return { lines, taxBps, subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function balance(i: Invoice): number {
  return i.totalMinor - i.payments.reduce((n, p) => n + p.amountMinor, 0);
}
