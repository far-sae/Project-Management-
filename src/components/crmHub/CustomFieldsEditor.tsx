import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CUSTOM_FIELD_LIMIT, CUSTOM_FIELD_NAME_MAX, CUSTOM_FIELD_VALUE_MAX,
  customFieldLabel, newCustomFieldRow, type CustomFieldRow,
} from '@/lib/customFields';
import { defFor, fieldKey, type FieldDef } from '@/lib/crmFieldTypes';

/** How many already-used names are offered as one-click buttons. */
const SUGGESTION_LIMIT = 6;

interface CustomFieldsEditorProps {
  rows: CustomFieldRow[];
  onChange: (rows: CustomFieldRow[]) => void;
  /** Stored keys in use on other leads, offered so the same names get reused. */
  suggestions?: string[];
  /** The workspace's typed fields: these get a number box, a date box or a list instead of a text box. */
  defs?: FieldDef[];
  /** A sentence to show when the rows cannot be saved as they are. */
  error?: string | null;
  disabled?: boolean;
}

/**
 * The "Custom fields" part of a lead form: any number of name and value
 * pairs. Names already used on other leads are one click away, so the same
 * field is spelled the same on every lead.
 */
export const CustomFieldsEditor: React.FC<CustomFieldsEditorProps> = ({
  rows, onChange, suggestions = [], defs = [], error, disabled,
}) => {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<string | null>(null);

  // A new row takes the cursor: its name, or its value when the name is filled in.
  useEffect(() => {
    if (!focus) return;
    inputs.current.get(focus)?.focus();
    setFocus(null);
  }, [focus]);

  const taken = new Set(rows.map((r) => fieldKey(r.name)));
  // The workspace's own typed fields first, then names used on other leads; each once.
  const offered = [...defs.map((d) => d.name), ...suggestions.map((key) => customFieldLabel(key))]
    .filter((label, i, all) => !taken.has(fieldKey(label)) && all.findIndex((other) => fieldKey(other) === fieldKey(label)) === i)
    .slice(0, SUGGESTION_LIMIT);
  const full = rows.length >= CUSTOM_FIELD_LIMIT;

  const add = (name = '') => {
    const row = newCustomFieldRow(name);
    onChange([...rows, row]);
    setFocus(`${row.id}:${name ? 'value' : 'name'}`);
  };
  const patch = (id: string, change: Partial<CustomFieldRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const hold = (key: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(key, el);
    else inputs.current.delete(key);
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Custom fields">
      <div>
        <p className="text-sm font-medium text-foreground">Custom fields</p>
        <p className="text-xs text-muted-foreground">
          Anything else worth keeping about this lead, like a budget or an industry.
        </p>
      </div>

      {rows.map((row, i) => (
        <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            ref={hold(`${row.id}:name`)}
            value={row.name}
            onChange={(e) => patch(row.id, { name: e.target.value })}
            placeholder="Name"
            aria-label={`Custom field ${i + 1} name`}
            maxLength={CUSTOM_FIELD_NAME_MAX}
            autoComplete="off"
            disabled={disabled}
          />
          {(() => {
            const def = defFor(defs, row.name);
            if (def?.kind === 'choice' && def.options.length > 0) {
              // What is written stays offered even when it is no longer one of the choices, so it is never lost by opening the form.
              const known = def.options.some((o) => o.toLowerCase() === row.value.trim().toLowerCase());
              return (
                <select
                  value={row.value}
                  onChange={(e) => patch(row.id, { value: e.target.value })}
                  aria-label={`Custom field ${i + 1} value`}
                  disabled={disabled}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">Choose…</option>
                  {!known && row.value.trim() !== '' && <option value={row.value}>{row.value}</option>}
                  {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              );
            }
            return (
              <Input
                ref={hold(`${row.id}:value`)}
                type={def?.kind === 'date' ? 'date' : 'text'}
                inputMode={def?.kind === 'number' ? 'decimal' : undefined}
                value={row.value}
                onChange={(e) => patch(row.id, { value: e.target.value })}
                placeholder={def?.kind === 'number' ? 'A number' : 'Value'}
                aria-label={`Custom field ${i + 1} value`}
                maxLength={CUSTOM_FIELD_VALUE_MAX}
                autoComplete="off"
                disabled={disabled}
              />
            );
          })()}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label={`Remove custom field ${row.name.trim() || i + 1}`}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
            disabled={disabled}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Add custom field"
          onClick={() => add()}
          disabled={disabled || full}
        >
          <Plus aria-hidden />Add field
        </Button>
        {!full && offered.map((label) => (
          <button
            key={label}
            type="button"
            aria-label={`Add field ${label}`}
            onClick={() => add(label)}
            disabled={disabled}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-solid hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="h-3 w-3" aria-hidden />{label}
          </button>
        ))}
      </div>
      {full && (
        <p className="text-xs text-muted-foreground">A lead can have up to {CUSTOM_FIELD_LIMIT} custom fields.</p>
      )}
    </div>
  );
};

export default CustomFieldsEditor;
