/** Strict yyyy-MM-DD (Gregorian calendar string from AI parsers). */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse AI-provided yyyy-MM-DD into local-midnight Date, or null if invalid/malformed.
 */
export function parseIsoCalendarDate(raw: string | undefined | null): Date | null {
  if (raw === undefined || raw === null) return null;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || !ISO_DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
