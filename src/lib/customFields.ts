import { toCustomKey } from '@/lib/crmImport';

/**
 * Pure helpers for manipulating the `lead.customFields` record.
 * All functions return a NEW object — they never mutate the input.
 */

/**
 * Set (add or overwrite) a key in the custom fields record.
 */
export function setCustomField(
  fields: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...fields, [key]: value };
}

/**
 * Remove a key from the custom fields record.
 * Returns the original object if the key does not exist.
 */
export function removeCustomField(
  fields: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const next = { ...fields };
  delete next[key];
  return next;
}

/**
 * Rename a key in the custom fields record, preserving the value.
 * No-op (returns original) when:
 *   - `newKey` is blank / whitespace
 *   - `newKey` already exists in the record
 *   - `oldKey` does not exist in the record
 */
export function renameCustomField(
  fields: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  const trimmed = newKey.trim();
  if (!trimmed) return fields;
  if (trimmed === oldKey) return fields;
  if (!(oldKey in fields)) return fields;
  if (trimmed in fields) return fields;

  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    next[k === oldKey ? trimmed : k] = v;
  }
  return next;
}

// ─── Custom fields on a CRM lead, as typed into a form ───────────
// Stored on the lead as { key: value }. The key is the name in lowercase
// with underscores (the same rule the CSV import uses).

export const CUSTOM_FIELD_NAME_MAX = 40;
export const CUSTOM_FIELD_VALUE_MAX = 500;
export const CUSTOM_FIELD_LIMIT = 30;

/** One line in the form. `key` is set for a field the lead already has. */
export interface CustomFieldRow {
  id: string;
  key?: string;
  name: string;
  value: string;
}

/** A stored key the way people read it: "budget_range" → "Budget Range". */
export const customFieldLabel = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

let rowSeq = 0;
const nextRowId = (): string => `cf-${++rowSeq}`;

export const newCustomFieldRow = (name = ''): CustomFieldRow => ({ id: nextRowId(), name, value: '' });

export function customFieldRows(fields: Record<string, string> | null | undefined): CustomFieldRow[] {
  return Object.entries(fields ?? {}).map(([key, value]) => ({
    id: nextRowId(),
    key,
    name: customFieldLabel(key),
    value: String(value ?? ''),
  }));
}

/** A field whose name was left alone keeps its stored key, whatever its spelling. */
const rowKey = (row: CustomFieldRow): string =>
  row.key !== undefined && row.name.trim() === customFieldLabel(row.key) ? row.key : toCustomKey(row.name);

/**
 * What to store for the typed rows. A row with no value is left out, so
 * clearing a value removes the field. `error` is a sentence for the person.
 */
export function readCustomFieldRows(
  rows: CustomFieldRow[],
): { fields: Record<string, string>; error: string | null } {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    const value = row.value.trim();
    if (!value) continue;
    if (!row.name.trim()) return { fields: {}, error: 'Give every custom field a name.' };
    const key = rowKey(row);
    if (key in fields) {
      return { fields: {}, error: `Two custom fields have the same name: ${row.name.trim()}.` };
    }
    fields[key] = value;
  }
  return { fields, error: null };
}

/** Every field name in use on the given leads, most used first. */
export function knownCustomFieldKeys(
  records: Array<Record<string, string> | null | undefined>,
): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const key of Object.keys(record ?? {})) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}
