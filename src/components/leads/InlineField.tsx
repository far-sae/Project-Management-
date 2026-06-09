import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface InlineFieldProps {
  label: string;
  value: string | number | null | undefined;
  type?: 'text' | 'number' | 'textarea' | 'date';
  editable: boolean;
  onSave: (next: string | number | null) => Promise<void> | void;
  render?: (v: string | number | null | undefined) => React.ReactNode;
  placeholder?: string;
}

/**
 * Click-to-edit field. Read mode shows the value (or a muted dash) with a
 * pencil affordance on hover when `editable`. Edit mode (click) renders the
 * appropriate input; Enter/blur saves, Esc cancels. Saves show a spinner;
 * errors toast + revert. When `!editable` it is purely read-only.
 */
export const InlineField: React.FC<InlineFieldProps> = ({
  label,
  value,
  type = 'text',
  editable,
  onSave,
  render,
  placeholder,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // When entering edit mode, initialise the draft from the current value.
  const startEdit = () => {
    if (!editable || saving) return;
    const initial =
      value == null ? '' : type === 'date' ? String(value) : String(value);
    setDraft(initial);
    setEditing(true);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const coerce = (raw: string): string | number | null => {
    if (type === 'number') {
      if (raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    }
    return raw.trim() === '' ? null : raw;
  };

  const commit = async () => {
    if (!editing) return;
    const next = coerce(draft);
    // No-op if nothing changed.
    const prev = value == null ? null : type === 'number' ? Number(value) : String(value);
    const sameAsOriginal =
      (next === null && (prev === null || prev === ''))
      || String(next) === String(prev ?? '');
    if (sameAsOriginal) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
      // Revert to original value — editing stays open so user can retry or cancel.
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (type !== 'textarea' && e.key === 'Enter') {
      e.preventDefault();
      void commit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  // ── Read mode ────────────────────────────────────────────────────────────
  if (!editing) {
    const displayNode = render
      ? render(value)
      : value == null || value === ''
        ? <span className="text-muted-foreground">—</span>
        : <span>{String(value)}</span>;

    return (
      <div className="grid grid-cols-[140px_1fr] items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-right">
          {label}
        </span>
        <span
          className={cn(
            'text-foreground',
            editable && 'group inline-flex items-center gap-1 cursor-pointer rounded hover:bg-muted/60 -ml-1 pl-1 pr-1 py-0.5 transition-colors',
          )}
          onClick={editable ? startEdit : undefined}
          title={editable ? `Click to edit ${label}` : undefined}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') startEdit(); } : undefined}
        >
          <span className="truncate">{displayNode}</span>
          {editable && (
            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-70 shrink-0 transition-opacity" />
          )}
        </span>
      </div>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-right pt-2">
        {label}
      </span>
      <div className="relative flex items-start gap-1">
        {type === 'textarea' ? (
          <Textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            disabled={saving}
            className="text-sm min-h-[60px]"
          />
        ) : (
          <Input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={saving}
            className="text-sm h-8"
          />
        )}
        {saving && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-2 top-2 pointer-events-none" />
        )}
      </div>
    </div>
  );
};
