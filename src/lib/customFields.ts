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
