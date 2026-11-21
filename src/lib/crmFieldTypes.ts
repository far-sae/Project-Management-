/**
 * Custom fields with a type. A workspace can say that "Budget" is a number,
 * "Renewal" a date and "Plan" one of a few choices; the lead form then shows
 * the right kind of box and checks what is typed. Pure functions only.
 *
 * The values are still kept as text on the lead, as before, so a field with no
 * type, or a type added later, never loses what was written.
 */
import type { CustomFieldRow } from '@/lib/customFields';

export const FIELD_KINDS = ['text', 'number', 'date', 'choice'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  choice: 'One of a list',
};

export interface FieldDef {
  id: string;
  name: string;
  kind: FieldKind;
  /** The choices, for a field that is one of a list. */
  options: string[];
}

export const FIELD_NAME_MAX = 40;
export const OPTION_MAX = 60;
export const OPTIONS_LIMIT = 30;
export const DEFS_LIMIT = 30;

/** Two names are the same field when they differ only in capitals, spaces or underscores. */
export const fieldKey = (name: string): string => name.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/** The definition a typed name belongs to, if the workspace has one. */
export function defFor(defs: FieldDef[], name: string): FieldDef | null {
  const key = fieldKey(name);
  return key ? defs.find((d) => fieldKey(d.name) === key) ?? null : null;
}

/** "Basic, Pro\nEnterprise" as a list of choices: trimmed, no repeats, no empties. */
export function readOptions(text: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const option = part.trim().slice(0, OPTION_MAX);
    if (!option || seen.has(option.toLowerCase())) continue;
    seen.add(option.toLowerCase());
    options.push(option);
    if (options.length >= OPTIONS_LIMIT) break;
  }
  return options;
}

const isNumber = (text: string): boolean => /^-?\d+([.,]\d+)?$/.test(text.replace(/[\s,](?=\d{3}\b)/g, ''));
const isDate = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00Z`).getTime());

/** Why this value does not fit the field, or null when it does. An empty value always fits. */
export function valueProblem(def: FieldDef, value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (def.kind === 'number' && !isNumber(text)) return `${def.name} must be a number.`;
  if (def.kind === 'date' && !isDate(text)) return `${def.name} must be a date.`;
  if (def.kind === 'choice' && def.options.length > 0 && !def.options.some((o) => o.toLowerCase() === text.toLowerCase())) {
    return `${def.name} must be one of: ${def.options.join(', ')}.`;
  }
  return null;
}

/** The first row that does not fit its field's type, as a sentence, or null. */
export function rowsProblem(defs: FieldDef[], rows: CustomFieldRow[]): string | null {
  for (const row of rows) {
    const def = defFor(defs, row.name);
    const problem = def ? valueProblem(def, row.value) : null;
    if (problem) return problem;
  }
  return null;
}

/** Why a new definition cannot be added, or null when it can. */
export function defProblem(defs: FieldDef[], name: string, kind: FieldKind, options: string[]): string | null {
  const clean = name.trim();
  if (!clean) return 'Give the field a name.';
  if (clean.length > FIELD_NAME_MAX) return `A field name can have ${FIELD_NAME_MAX} letters at most.`;
  if (defFor(defs, clean)) return `There is a field called ${defFor(defs, clean)?.name} already.`;
  if (defs.length >= DEFS_LIMIT) return `A workspace can have ${DEFS_LIMIT} typed fields at most.`;
  if (kind === 'choice' && options.length < 2) return 'Give at least two choices, with a comma between them.';
  return null;
}
