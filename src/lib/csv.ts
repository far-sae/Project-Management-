export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Comma, semicolon or tab: whichever splits the heading line into the most columns. */
function detectDelimiter(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Spreadsheets put this invisible mark at the start of the files they save. */
const BYTE_ORDER_MARK = 0xfeff;

export interface CsvTable {
  headers: string[];
  /** One array of cells per data row, in file order. Rows may be shorter than the headings. */
  rows: string[][];
}

/**
 * Reads a spreadsheet export into its heading row and data rows.
 * Handles what real files contain: a byte-order mark, Windows line ends,
 * semicolon or tab separators, and commas or line breaks inside quotes.
 */
export function parseCSVTable(text: string): CsvTable {
  const unmarked = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  const src = unmarked.replace(/\r\n?/g, '\n');
  const delimiter = detectDelimiter(src);
  const table: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      record.push(cell);
      cell = '';
    } else if (ch === '\n') {
      record.push(cell);
      table.push(record);
      record = [];
      cell = '';
    } else cell += ch;
  }
  record.push(cell);
  table.push(record);

  const filled = table.filter((cells) => cells.some((c) => c.trim()));
  if (!filled.length) return { headers: [], rows: [] };
  return { headers: filled[0]!.map((h) => h.trim()), rows: filled.slice(1) };
}

/** One object per row, keyed by heading. Cells under an empty heading are dropped. */
export function tableToRecords(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cells[i] ?? '';
    });
    return obj;
  });
}

export function parseCSV(text: string): Record<string, string>[] {
  const { headers, rows } = parseCSVTable(text);
  return tableToRecords(headers, rows);
}
