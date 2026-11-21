// Excel workbooks (.xlsx) are read into the same table a CSV gives.
import { describe, expect, it } from 'vitest';
import { strToU8 as encode, zipSync } from 'fflate';
import { EMPTY_SHEET, NOT_A_WORKBOOK, isXlsxFile, readXlsxTable } from '@/lib/xlsx';

// The test page and the encoder each have their own Uint8Array; the zip writer only knows the page's.
const strToU8 = (text: string): Uint8Array => new Uint8Array(encode(text));

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** A small workbook, built the way Excel builds one. */
function workbook(sheetRows: string, extra: { shared?: string[]; styles?: string; sheetPath?: string; listed?: boolean } = {}): Uint8Array {
  const path = extra.sheetPath ?? 'worksheets/sheet1.xml';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    [`xl/${path}`]: strToU8(`<?xml version="1.0"?><worksheet ${NS}><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  if (extra.listed !== false) {
    files['xl/workbook.xml'] = strToU8(`<?xml version="1.0"?><workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId7"/></sheets></workbook>`);
    files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="x" Target="${path}"/></Relationships>`);
  }
  if (extra.shared) {
    files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst ${NS}>${extra.shared.join('')}</sst>`);
  }
  if (extra.styles) files['xl/styles.xml'] = strToU8(`<?xml version="1.0"?><styleSheet ${NS}>${extra.styles}</styleSheet>`);
  return zipSync(files);
}

const si = (text: string) => `<si><t>${text}</t></si>`;

describe('reading an Excel workbook', () => {
  it('reads headings and rows, whichever way a text is stored', () => {
    const table = readXlsxTable(workbook(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="inlineStr"><is><t>priya@harbour.example</t></is></c><c r="C2"><v>12</v></c></row>'
      + '<row r="3"><c r="A3" t="str"><v>Tom Okafor</v></c><c r="B3" t="s"><v>4</v></c><c r="C3" t="b"><v>1</v></c></row>',
      { shared: [si('Name'), si('Email'), si('Seats'), si('Priya Nair'), '<si><r><t>tom@</t></r><r><t>fieldway.example</t></r><rPh><t>ignored</t></rPh></si>'] },
    ));
    expect(table.headers).toEqual(['Name', 'Email', 'Seats']);
    expect(table.rows).toEqual([
      ['Priya Nair', 'priya@harbour.example', '12'],
      ['Tom Okafor', 'tom@fieldway.example', 'TRUE'],
    ]);
  });

  it('keeps every value under its own heading when cells in between are empty', () => {
    const table = readXlsxTable(workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Email</t></is></c><c r="C1" t="inlineStr"><is><t>Phone</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>Elena Rossi</t></is></c><c r="C2" t="inlineStr"><is><t>020 7946 0958</t></is></c></row>'
      + '<row r="3"></row>'
      + '<row r="4"><c r="B4" t="inlineStr"><is><t>jon@example.com</t></is></c></row>',
    ));
    expect(table.rows).toEqual([['Elena Rossi', '', '020 7946 0958'], ['', 'jon@example.com', '']]);
  });

  it('writes a date as a date, not as Excel’s day number', () => {
    const styles = '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>'
      + '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs>';
    const table = readXlsxTable(workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Added</t></is></c><c r="B1" t="inlineStr"><is><t>Meeting</t></is></c><c r="C1" t="inlineStr"><is><t>Value</t></is></c></row>'
      // 46347 is 21 November 2026; .5 is midday.
      + '<row r="2"><c r="A2" s="1"><v>46347</v></c><c r="B2" s="2"><v>46347.5</v></c><c r="C2" s="3"><v>46347</v></c></row>',
      { styles },
    ));
    expect(table.rows).toEqual([['2026-11-21', '2026-11-21 12:00', '46347']]);
  });

  it('finds the first sheet where the workbook says it is, or in the usual place', () => {
    const rows = '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sam</t></is></c></row>';
    expect(readXlsxTable(workbook(rows, { sheetPath: 'worksheets/data.xml' })).rows).toEqual([['Sam']]);
    expect(readXlsxTable(workbook(rows, { listed: false })).rows).toEqual([['Sam']]);
  });

  it('says in plain words when the file is not a workbook, or the sheet is empty', () => {
    expect(() => readXlsxTable(strToU8('Name,Email\nSam,sam@example.com'))).toThrow(NOT_A_WORKBOOK);
    expect(() => readXlsxTable(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(NOT_A_WORKBOOK);
    expect(() => readXlsxTable(workbook(''))).toThrow(EMPTY_SHEET);
  });

  it('knows a workbook by its name', () => {
    expect(isXlsxFile('Leads November.XLSX')).toBe(true);
    expect(isXlsxFile('leads.xls')).toBe(false);
    expect(isXlsxFile('leads.csv')).toBe(false);
  });
});
