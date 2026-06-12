import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** The field types a user can build for a custom item. */
export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'money';

/** A single user-defined field on a custom item. Persisted (as an array)
 *  under `customFields._fields` so the rest of the app — which reads plain
 *  string/number entries off `deal.customFields` — is unaffected. */
export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  /** Only present for `dropdown` — the user's own option list. */
  options?: string[];
  /** Only present for `money` — the chosen currency code. */
  currency?: string;
  /** Value matching the type: string (text/date/dropdown), number
   *  (number/money), boolean (checkbox). */
  value: string | number | boolean | null;
}

const FIELD_TYPE_OPTIONS: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'money', label: 'Money' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];

const FIELDS_KEY = '_fields';

const newId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
};

/** The default value for a freshly-picked field type. */
const defaultValueForType = (type: CustomFieldType): CustomFieldDef['value'] => {
  switch (type) {
    case 'number': return null;
    case 'money': return null;
    case 'checkbox': return false;
    default: return '';
  }
};

/**
 * Read the builder's field array out of a `customFields` record. Tolerates a
 * missing / malformed `_fields` (returns []). Each entry is normalised so the
 * UI always has a stable `id`, a sane `type`, and (for dropdowns) an options
 * array.
 */
export const readFields = (fields: Record<string, unknown> | null | undefined): CustomFieldDef[] => {
  const raw = (fields as Record<string, unknown> | undefined)?.[FIELDS_KEY];
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<CustomFieldType>(FIELD_TYPE_OPTIONS.map((o) => o.value));
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => {
      const type = allowed.has(f.type as CustomFieldType)
        ? (f.type as CustomFieldType)
        : 'text';
      const options = Array.isArray(f.options)
        ? (f.options as unknown[]).map((o) => String(o))
        : undefined;
      let value = f.value as CustomFieldDef['value'];
      if (type === 'checkbox') value = Boolean(value);
      else if (type === 'number' || type === 'money') value = value == null || value === '' ? null : Number(value);
      else value = value == null ? '' : String(value);
      const currency = typeof f.currency === 'string' && f.currency ? f.currency : 'USD';
      return {
        id: typeof f.id === 'string' ? f.id : newId(),
        label: typeof f.label === 'string' ? f.label : '',
        type,
        ...(type === 'dropdown' ? { options: options ?? [] } : {}),
        ...(type === 'money' ? { currency } : {}),
        value,
      } as CustomFieldDef;
    });
};

/**
 * Merge a builder field array back into a `customFields` record under
 * `_fields`, preserving every other key that already lives on the record
 * (e.g. importer free-text columns). Strips `_fields` when the array is empty
 * so a cleared builder doesn't leave a dangling key behind.
 */
export const writeFields = (
  fields: Record<string, unknown>,
  next: CustomFieldDef[],
): Record<string, unknown> => {
  const rest = { ...fields };
  delete rest[FIELDS_KEY];
  if (next.length === 0) return rest;
  return { ...rest, [FIELDS_KEY]: next };
};

interface Props {
  /** The full customFields record (the builder owns only the `_fields` key). */
  fields: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Currency seeded onto a newly-added Money field. Defaults to USD. */
  defaultCurrency?: string;
}

/**
 * Rich custom-fields builder for custom items. Each row is a user-defined
 * field with a label, a type (text/number/date/dropdown/checkbox), and a
 * value input matching the type. Dropdown fields let the user manage their
 * own option list. The whole array is persisted under `customFields._fields`.
 */
export const CustomFieldsBuilder: React.FC<Props> = ({ fields, onChange, defaultCurrency = 'USD' }) => {
  const defs = readFields(fields);

  const commit = (next: CustomFieldDef[]) => onChange(writeFields(fields, next));

  const addField = () => {
    commit([
      ...defs,
      { id: newId(), label: '', type: 'text', value: '' },
    ]);
  };

  const removeField = (id: string) => {
    commit(defs.filter((f) => f.id !== id));
  };

  const patchField = (id: string, patch: Partial<CustomFieldDef>) => {
    commit(defs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const changeType = (id: string, type: CustomFieldType) => {
    patchField(id, {
      type,
      value: defaultValueForType(type),
      // Seed an empty options list for dropdowns; a currency for money; drop
      // both otherwise.
      ...(type === 'dropdown' ? { options: [] } : { options: undefined }),
      ...(type === 'money' ? { currency: defaultCurrency } : { currency: undefined }),
    });
  };

  const setOption = (id: string, index: number, text: string) => {
    const f = defs.find((d) => d.id === id);
    if (!f) return;
    const options = [...(f.options ?? [])];
    options[index] = text;
    patchField(id, { options });
  };

  const addOption = (id: string) => {
    const f = defs.find((d) => d.id === id);
    if (!f) return;
    patchField(id, { options: [...(f.options ?? []), ''] });
  };

  const removeOption = (id: string, index: number) => {
    const f = defs.find((d) => d.id === id);
    if (!f) return;
    const removed = (f.options ?? [])[index];
    const options = (f.options ?? []).filter((_, i) => i !== index);
    // If the selected value was the removed option, clear it.
    const value = f.value === removed ? '' : f.value;
    patchField(id, { options, value });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b pb-1.5">
        <h3 className="text-sm font-semibold">Custom fields</h3>
        <button
          type="button"
          onClick={addField}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add field
        </button>
      </div>

      {defs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No custom fields yet. Click "Add field" to define your own
          text, number, money, date, dropdown, or checkbox fields.
        </p>
      )}

      {defs.map((f) => (
        <div key={f.id} className="rounded-md border p-3 space-y-2 bg-card">
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Label
              </Label>
              <Input
                value={f.label}
                placeholder="Field label"
                maxLength={80}
                onChange={(e) => patchField(f.id, { label: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div className="w-[130px] space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Type
              </Label>
              <Select
                value={f.type}
                onValueChange={(v) => changeType(f.id, v as CustomFieldType)}
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => removeField(f.id)}
              className="text-muted-foreground hover:text-destructive p-1 mt-6 shrink-0"
              title="Remove field"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Dropdown: let the user manage their own options. */}
          {f.type === 'dropdown' && (
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Options
              </Label>
              <div className="space-y-1.5">
                {(f.options ?? []).map((opt, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={opt}
                      placeholder={`Option ${i + 1}`}
                      maxLength={80}
                      onChange={(e) => setOption(f.id, i, e.target.value)}
                      className="h-8 text-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(f.id, i)}
                      className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                      title="Remove option"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addOption(f.id)}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add option
                </button>
              </div>
            </div>
          )}

          {/* Value input matching the field's type. */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Value
            </Label>
            {f.type === 'checkbox' ? (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(f.value)}
                  onChange={(e) => patchField(f.id, { value: e.target.checked })}
                  id={`cf-${f.id}`}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor={`cf-${f.id}`} className="text-sm font-normal">
                  {f.value ? 'Yes' : 'No'}
                </Label>
              </div>
            ) : f.type === 'money' ? (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={f.value == null ? '' : String(f.value)}
                  placeholder="Amount"
                  onChange={(e) => patchField(f.id, {
                    value: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  className="h-8 text-sm flex-1"
                />
                <Select
                  value={f.currency ?? defaultCurrency}
                  onValueChange={(v) => patchField(f.id, { currency: v })}
                >
                  <SelectTrigger className="h-8 text-sm w-[88px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : f.type === 'dropdown' ? (
              <Select
                value={f.value ? String(f.value) : ''}
                onValueChange={(v) => patchField(f.id, { value: v })}
                disabled={(f.options ?? []).filter((o) => o.trim()).length === 0}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select a value" />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? [])
                    .map((o) => o)
                    .filter((o) => o.trim().length > 0)
                    .map((o, i) => (
                      <SelectItem key={`${o}-${i}`} value={o}>{o}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={f.value == null ? '' : String(f.value)}
                placeholder={
                  f.type === 'number' ? 'Value (number)'
                  : f.type === 'date' ? 'Date'
                  : 'Value'
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  patchField(f.id, {
                    value: f.type === 'number'
                      ? (raw === '' ? null : Number(raw))
                      : raw,
                  });
                }}
                className="h-8 text-sm"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CustomFieldsBuilder;
