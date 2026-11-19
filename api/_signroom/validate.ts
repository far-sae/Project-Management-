import { AppError } from "./errors.js";

/** Signroom's email rule: trimmed, lower-cased, one plain address. */
export function email(value: unknown): string {
  const e = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /[<>(),;:"\\]/.test(e) || e.length > 254)
    throw new AppError("Enter a valid email address.");
  return e;
}

export function text(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max);
}

/** A UUID's shape. A malformed id can never name a row, and must not reach a uuid column (it would be a 500). */
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
