import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { InlineField } from './InlineField';
import {
  setCustomField,
  removeCustomField,
} from '@/lib/customFields';

type FieldType = 'text' | 'number' | 'date';

interface Props {
  fields: Record<string, unknown>;
  editable: boolean;
  onChange: (next: Record<string, unknown>) => Promise<void> | void;
}

/**
 * Renders per-lead custom properties. Each row has an inline-editable value
 * and (when editable) a remove button. Below the rows there is an "+ Add
 * property" form that captures a name, type, and initial value.
 */
export const CustomPropertiesEditor: React.FC<Props> = ({
  fields,
  editable,
  onChange,
}) => {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<FieldType>('text');
  const [newValue, setNewValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const entries = Object.entries(fields);

  const handleValueSave = async (key: string, next: string | number | null) => {
    await onChange(setCustomField(fields, key, next));
  };

  const handleRemove = async (key: string) => {
    await onChange(removeCustomField(fields, key));
  };

  const coerceNewValue = (): unknown => {
    if (newType === 'number') {
      const n = Number(newValue);
      return newValue.trim() === '' ? null : Number.isNaN(n) ? null : n;
    }
    return newValue.trim() === '' ? null : newValue;
  };

  const handleAdd = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      toast.error('Property name cannot be blank');
      return;
    }
    if (trimmedName in fields) {
      toast.error(`A property named "${trimmedName}" already exists`);
      return;
    }
    setSubmitting(true);
    try {
      await onChange(setCustomField(fields, trimmedName, coerceNewValue()));
      setNewName('');
      setNewType('text');
      setNewValue('');
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add property');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between border-b pb-1.5 mb-2">
        <h3 className="text-sm font-semibold">Custom properties</h3>
        {editable && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add property
          </button>
        )}
      </div>

      {entries.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">
          No custom properties yet.
          {editable && ' Click "+ Add property" to define one.'}
        </p>
      )}

      {entries.map(([key, val]) => (
        <div key={key} className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            <InlineField
              label={key}
              value={val == null ? null : typeof val === 'number' ? val : String(val)}
              type={
                typeof val === 'number' ? 'number'
                  : typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val) ? 'date'
                  : 'text'
              }
              editable={editable}
              onSave={(next) => handleValueSave(key, next)}
            />
          </div>
          {editable && (
            <button
              type="button"
              onClick={() => void handleRemove(key)}
              className="text-muted-foreground hover:text-destructive p-1 mt-0.5 shrink-0"
              title={`Remove "${key}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      {editable && adding && (
        <div className="rounded-md border p-3 space-y-2 bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            New property
          </p>
          <Input
            placeholder="Property name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            disabled={submitting}
            className="text-sm h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); }
              if (e.key === 'Escape') { setAdding(false); }
            }}
          />
          <div className="flex items-center gap-2">
            <Select
              value={newType}
              onValueChange={(v) => { setNewType(v as FieldType); setNewValue(''); }}
              disabled={submitting}
            >
              <SelectTrigger className="w-[110px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type={newType === 'number' ? 'number' : newType === 'date' ? 'date' : 'text'}
              placeholder={
                newType === 'number' ? 'Value (number)'
                : newType === 'date' ? 'Date'
                : 'Value'
              }
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              disabled={submitting}
              className="text-sm h-8 flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); }
                if (e.key === 'Escape') { setAdding(false); }
              }}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setAdding(false); setNewName(''); setNewType('text'); setNewValue(''); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleAdd()} disabled={submitting}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
