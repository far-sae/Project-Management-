/**
 * Reads the first sheet of an Excel workbook (.xlsx) into the same heading
 * row and data rows a CSV file gives, so an import can take either.
 *
 * An .xlsx file is a zip of XML files. Only what an import needs is read: the
 * cell values of the first sheet. Formulas give their last calculated value.
 * The old .xls format is a different thing and is not read.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { CsvTable } from '@/lib/csv';

/** The biggest workbook that is opened, in bytes. Bigger ones are better saved as CSV. */
export const XLSX_MAX_BYTES = 20 * 1024 * 1024;
/** Rows read from the sheet. */
export const XLSX_MAX_ROWS = 50000;

export const NOT_A_WORKBOOK = 'This file could not be read as an Excel workbook. Save it as .xlsx or as CSV and try again.';
export const WORKBOOK_TOO_BIG = 'This workbook is too big to open here. Save the sheet as CSV and import that.';
export const EMPTY_SHEET = 'The first sheet of this workbook has no rows.';

const xml = (text: string): Document => new DOMParser().parseFromString(text, 'application/xml');
const all = (node: Document | Element, tag: string): Element[] => Array.from(node.getElementsByTagName(tag));

/** "C7" → 2: the column a cell is in, counted from 0. */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** Excel's built-in number formats that are dates or times. */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** For each cell style, whether it shows its number as a date. */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const doc = xml(stylesXml);
  const custom = new Map<number, boolean>();
  for (const f of all(doc, 'numFmt')) {
    // Letters inside quotes or after a backslash are text, not date parts.
    const code = (f.getAttribute('formatCode') ?? '').replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    custom.set(Number(f.getAttribute('numFmtId')), /[dmyhs]/i.test(code));
  }
  const cellXfs = all(doc, 'cellXfs')[0];
  return cellXfs ? all(cellXfs, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    return BUILT_IN_DATES.has(id) || custom.get(id) === true;
  }) : [];
}

const two = (n: number): string => String(n).padStart(2, '0');

/** An Excel day number as "2026-11-21", with the time when it has one. */
function dateText(serial: number): string {
  // Day 25569 is 1 January 1970. Excel counts 1900 as a leap year; every date after February 1900 is right this way.
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const day = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  const hasTime = Math.abs(serial - Math.round(serial)) > 1e-9;
  return hasTime ? `${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` : day;
}

/** The text of a shared or inline string: every <t>, without the reading hints East Asian text can carry. */
function stringText(node: Element): string {
  return all(node, 't')
    .filter((t) => t.parentElement?.tagName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

/** The path of the first sheet, as the workbook lists its sheets. */
function firstSheetPath(files: Record<string, Uint8Array>): string | null {
  const workbook = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (workbook && rels) {
    const first = all(xml(strFromU8(workbook)), 'sheet')[0];
    const relId = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = all(xml(strFromU8(rels)), 'Relationship').find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target');
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (files[path]) return path;
    }
  }
  // A workbook written without the usual list still has its sheets in the usual place.
  return Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

export function readXlsxTable(bytes: Uint8Array): CsvTable {
  if (bytes.byteLength > XLSX_MAX_BYTES) throw new Error(WORKBOOK_TOO_BIG);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error(NOT_A_WORKBOOK);
  }
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw new Error(NOT_A_WORKBOOK);

  const shared = files['xl/sharedStrings.xml'] ? all(xml(strFromU8(files['xl/sharedStrings.xml'])), 'si').map(stringText) : [];
  const isDate = dateStyles(files['xl/styles.xml'] ? strFromU8(files['xl/styles.xml']) : undefined);

  const table: string[][] = [];
  for (const row of all(xml(strFromU8(files[sheetPath])), 'row')) {
    if (table.length > XLSX_MAX_ROWS) break;
    const cells: string[] = [];
    let next = 0;
    for (const cell of all(row, 'c')) {
      const ref = cell.getAttribute('r');
      const column = ref ? columnOf(ref) : next;
      next = column + 1;
      const type = cell.getAttribute('t');
      const raw = all(cell, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = stringText(cell);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = '';
      else if (!type || type === 'n') value = raw !== '' && isDate[Number(cell.getAttribute('s') ?? -1)] ? dateText(Number(raw)) : raw;
      else value = raw;
      while (cells.length < column) cells.push('');
      cells[column] = value.trim();
    }
    if (cells.some((c) => c !== '')) table.push(cells);
  }
  if (table.length === 0) throw new Error(EMPTY_SHEET);

  const [headers, ...rows] = table;
  return { headers: headers.map((h) => h ?? ''), rows: rows.map((r) => Array.from({ length: Math.max(r.length, headers.length) }, (_, i) => r[i] ?? '')) };
}

/** True for a file the import should read as a workbook. */
export const isXlsxFile = (name: string): boolean => /\.xlsx$/i.test(name);
