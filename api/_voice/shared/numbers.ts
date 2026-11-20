/**
 * Which phone numbers the CRM will ring, shared by the page and the server.
 *
 * Calls go to the United States (the +1 plan, Canada included, at the same
 * price) and the United Kingdom only. Premium lines and the costly parts of
 * both plans are refused here as well as in the phone provider's own settings:
 * a wrong number must never become an expensive call.
 */

export type CallCountry = "US" | "GB";

export const COUNTRY_NAME: Record<CallCountry, string> = { US: "United States", GB: "United Kingdom" };
export const COUNTRY_CODE: Record<CallCountry, string> = { US: "+1", GB: "+44" };

export const INCOMPLETE_NUMBER_MESSAGE = "Enter a full phone number, with its area code.";
export const OTHER_COUNTRY_MESSAGE = "Calls can go to United States and United Kingdom numbers only.";
export const BLOCKED_NUMBER_MESSAGE = "This number cannot be called from here.";

export type Dialable = { ok: true; e164: string; country: CallCountry } | { ok: false; error: string };

/**
 * +1 area codes that are not the United States or Canada (the Caribbean,
 * Bermuda and the Pacific territories billed as other countries), and the
 * premium codes. Calls to these cost many times a normal call.
 */
const BLOCKED_AREA_CODES = new Set([
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "670", "671", "684", "721", "758", "767",
  "784", "809", "829", "849", "868", "869", "876", "900", "976",
]);

/** Digits only, without an extension ("ext 12", "x12", "#12") and without the "(0)" people put after +44. */
function digitsOf(raw: string): { plus: boolean; digits: string } {
  let s = String(raw ?? "").trim();
  s = s.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "");
  const plus = s.startsWith("+");
  s = s.replace(/\(0\)/g, "");
  let digits = s.replace(/\D/g, "");
  if (!plus && digits.startsWith("00")) return { plus: true, digits: digits.slice(2) };
  if (plus) return { plus: true, digits };
  digits = digits.replace(/^\s+/, "");
  return { plus: false, digits };
}

/** The country a number written the local way most likely belongs to, or null when it cannot be told. */
export function guessCountry(raw: string): CallCountry | null {
  const { plus, digits } = digitsOf(raw);
  if (plus) return digits.startsWith("44") ? "GB" : digits.startsWith("1") ? "US" : null;
  if (digits.startsWith("0") && (digits.length === 10 || digits.length === 11)) return "GB";
  if (digits.length === 10 && !digits.startsWith("0")) return "US";
  if (digits.length === 11 && digits.startsWith("1")) return "US";
  return null;
}

function unitedStates(national: string): Dialable {
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return { ok: false, error: INCOMPLETE_NUMBER_MESSAGE };
  if (BLOCKED_AREA_CODES.has(national.slice(0, 3))) return { ok: false, error: BLOCKED_NUMBER_MESSAGE };
  return { ok: true, e164: "+1" + national, country: "US" };
}

function unitedKingdom(national: string): Dialable {
  // The number after +44, without the leading 0: nine or ten digits.
  if (!/^[1-9]\d{8,9}$/.test(national)) return { ok: false, error: INCOMPLETE_NUMBER_MESSAGE };
  const allowed =
    /^[123]/.test(national) || // places and UK-wide numbers
    (/^7/.test(national) && !/^7[06]/.test(national)) || // mobiles, not personal numbers or pagers
    /^80[08]/.test(national); // freephone
  if (!allowed) return { ok: false, error: BLOCKED_NUMBER_MESSAGE };
  // Mobiles and UK-wide numbers are always ten digits.
  if (/^[37]/.test(national) && national.length !== 10) return { ok: false, error: INCOMPLETE_NUMBER_MESSAGE };
  return { ok: true, e164: "+44" + national, country: "GB" };
}

/**
 * The number to ring, in international form, or why it cannot be rung.
 * `country` is used only for a number written the local way; one that starts
 * with + or 00 keeps its own country.
 */
export function dialable(raw: string, country?: CallCountry | null): Dialable {
  const { plus, digits } = digitsOf(raw);
  if (!digits) return { ok: false, error: INCOMPLETE_NUMBER_MESSAGE };
  if (plus) {
    if (digits.startsWith("44")) return unitedKingdom(digits.slice(2).replace(/^0/, ""));
    if (digits.startsWith("1")) return unitedStates(digits.slice(1));
    return { ok: false, error: OTHER_COUNTRY_MESSAGE };
  }
  const where = country ?? guessCountry(raw);
  if (where === "GB") return unitedKingdom(digits.replace(/^0/, ""));
  if (where === "US") return unitedStates(digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits);
  return { ok: false, error: INCOMPLETE_NUMBER_MESSAGE };
}

/** "+14155550132" as "+1 (415) 555-0132"; a United Kingdom number in its usual groups; anything else unchanged. */
export function formatNumber(e164: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (us) return `+1 (${us[1]}) ${us[2]}-${us[3]}`;
  const gb = /^\+44(\d{9,10})$/.exec(e164);
  if (!gb) return e164;
  const n = gb[1];
  if (n.length === 10) {
    if (n.startsWith("7")) return `+44 ${n.slice(0, 4)} ${n.slice(4)}`;
    if (n.startsWith("2")) return `+44 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
    return `+44 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return `+44 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}
