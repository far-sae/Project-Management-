// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dialable, formatNumber, guessCountry } from "../../../api/_voice/shared/numbers";

/**
 * Which numbers the CRM will ring: United States (and Canada) and United
 * Kingdom only, written the way people type them, and never a premium line.
 */
describe("dialable numbers", () => {
  it("takes an international number as written", () => {
    expect(dialable("+1 (415) 555-0132")).toEqual({ ok: true, e164: "+14155550132", country: "US" });
    expect(dialable("+44 20 7946 0958")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
    expect(dialable("0044 7700 900123")).toEqual({ ok: true, e164: "+447700900123", country: "GB" });
    expect(dialable("+44 (0)20 7946 0958")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
  });

  it("works out the country of a number written the local way", () => {
    expect(dialable("(415) 555-0132")).toEqual({ ok: true, e164: "+14155550132", country: "US" });
    expect(dialable("1-415-555-0132")).toEqual({ ok: true, e164: "+14155550132", country: "US" });
    expect(dialable("07700 900123")).toEqual({ ok: true, e164: "+447700900123", country: "GB" });
    expect(dialable("020 7946 0958")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
    expect(guessCountry("07700 900123")).toBe("GB");
    expect(guessCountry("415 555 0132")).toBe("US");
    expect(guessCountry("555 0132")).toBeNull();
  });

  it("uses the country it is told for a local number", () => {
    expect(dialable("2079460958", "GB")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
    expect(dialable("4155550132", "US")).toEqual({ ok: true, e164: "+14155550132", country: "US" });
    // An international number keeps its own country whatever was chosen.
    expect(dialable("+44 20 7946 0958", "US")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
  });

  it("drops an extension rather than dialling it", () => {
    expect(dialable("+1 415 555 0132 ext. 204")).toEqual({ ok: true, e164: "+14155550132", country: "US" });
    expect(dialable("020 7946 0958 x12")).toEqual({ ok: true, e164: "+442079460958", country: "GB" });
  });

  it("refuses other countries", () => {
    for (const n of ["+33 1 42 68 53 00", "+91 98765 43210", "+971 4 123 4567"]) {
      const r = dialable(n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) expect(r.error).toBe("Calls can go to United States and United Kingdom numbers only.");
    }
  });

  it("refuses premium and costly lines", () => {
    // US premium, the Caribbean part of +1, UK premium, UK special rate, UK personal numbers.
    for (const n of ["+1 900 555 0132", "+1 876 555 0132", "+1 809 555 0132", "+44 909 879 0123", "+44 871 234 5678", "+44 70 1234 5678"]) {
      const r = dialable(n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) expect(r.error).toBe("This number cannot be called from here.");
    }
  });

  it("allows UK freephone", () => {
    expect(dialable("0800 123 4567").ok).toBe(true);
    expect(dialable("0808 157 0192").ok).toBe(true);
  });

  it("refuses numbers of the wrong length, and empty ones", () => {
    for (const n of ["", "   ", "abc", "+1 415 555", "+44 20", "+1 415 555 01321", "12345"]) {
      const r = dialable(n);
      expect(r.ok, n).toBe(false);
      if (!r.ok) expect(r.error).toBe("Enter a full phone number, with its area code.");
    }
    // A US area code or exchange never starts with 0 or 1.
    expect(dialable("+1 015 555 0132").ok).toBe(false);
    expect(dialable("+1 415 155 0132").ok).toBe(false);
  });

  it("writes a number the way it is read", () => {
    expect(formatNumber("+14155550132")).toBe("+1 (415) 555-0132");
    expect(formatNumber("+447700900123")).toBe("+44 7700 900123");
    expect(formatNumber("+442079460958")).toBe("+44 20 7946 0958");
    expect(formatNumber("+441614960148")).toBe("+44 161 496 0148");
    expect(formatNumber("+448001234567")).toBe("+44 800 123 4567");
    expect(formatNumber("something else")).toBe("something else");
  });
});
