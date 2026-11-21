/**
 * The quote on a deal: lines with a quantity and a price, and their total.
 * Pure functions only.
 */

export interface DealLine {
  description: string;
  quantity: number;
  /** Price of one, in the deal's currency. */
  unitPrice: number;
}

/** A line as it is typed: text boxes hold text. */
export interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

export const MAX_LINES = 50;
export const LINE_TEXT_LIMIT = 300;

const cents = (amount: number): number => Math.round(amount * 100);

/** What one line comes to, to the penny. */
export const lineTotal = (line: DealLine): number => cents(line.quantity * line.unitPrice) / 100;

/** What the quote comes to. Added up in pennies, so 0.1 + 0.2 is 0.3. */
export const quoteTotal = (lines: DealLine[]): number => lines.reduce((sum, line) => sum + cents(lineTotal(line)), 0) / 100;

/** Lines read from the database: anything that is not a proper line is left out. */
export function tidyLines(raw: unknown): DealLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: DealLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    const quantity = Number(r.quantity);
    const unitPrice = Number(r.unitPrice);
    if (!description || !Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice < 0) continue;
    lines.push({ description: description.slice(0, LINE_TEXT_LIMIT), quantity, unitPrice });
    if (lines.length >= MAX_LINES) break;
  }
  return lines;
}

/** "1,200.50" or "1200,50" as a number, or null when it is not one. */
export function readNumber(text: string): number | null {
  const clean = text.trim().replace(/\s/g, '');
  if (!clean) return null;
  // A comma followed by exactly three digits groups thousands; any other comma is a decimal mark.
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean) ? clean.replace(/,/g, '') : clean.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/**
 * The typed lines as lines to save, or the reason they cannot be saved. A line
 * with nothing typed in it is ignored: an empty last row is not a mistake.
 */
export function readLines(drafts: LineDraft[]): { lines: DealLine[]; problem: string | null } {
  const lines: DealLine[] = [];
  for (const [index, draft] of drafts.entries()) {
    const description = draft.description.trim();
    if (!description && !draft.quantity.trim() && !draft.unitPrice.trim()) continue;
    const n = index + 1;
    if (!description) return { lines: [], problem: `Line ${n} needs a description.` };
    const quantity = readNumber(draft.quantity || '1');
    if (quantity === null || quantity <= 0) return { lines: [], problem: `Line ${n}: the quantity must be a number above zero.` };
    const unitPrice = readNumber(draft.unitPrice);
    if (unitPrice === null) return { lines: [], problem: `Line ${n}: the price must be a number.` };
    lines.push({ description: description.slice(0, LINE_TEXT_LIMIT), quantity, unitPrice });
  }
  if (lines.length > MAX_LINES) return { lines: [], problem: `A quote can have ${MAX_LINES} lines at most.` };
  return { lines, problem: null };
}

export const toDrafts = (lines: DealLine[]): LineDraft[] =>
  lines.map((line) => ({ description: line.description, quantity: String(line.quantity), unitPrice: String(line.unitPrice) }));

export const EMPTY_LINE: LineDraft = { description: '', quantity: '1', unitPrice: '' };

/** "Q-3F9A2C1B": a short number for the quote, made from the deal's own id, so it never changes. */
export const quoteNumber = (dealId: string): string => `Q-${dealId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** The day a quote made on `from` stops being valid: 30 days later. */
export function validUntil(from: Date): Date {
  const until = new Date(from);
  until.setDate(until.getDate() + 30);
  return until;
}
