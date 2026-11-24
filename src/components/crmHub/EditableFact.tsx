// One fact in a details panel that can be changed where it stands: a pencil
// opens a box in its place, with Save, Cancel and (when there is something to
// remove) Remove. No other window is opened for a one-line change.
import React, { useState } from 'react';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { publicMessage } from '@/lib/publicError';

export type FactKind = 'text' | 'url' | 'email' | 'tel' | 'number';

interface Props {
  label: string;
  /** What is stored now, as text. "" when nothing is. */
  value: string;
  /** How the fact is shown while it is not being changed (a link, a formatted number, ...). */
  children: React.ReactNode;
  kind?: FactKind;
  placeholder?: string;
  /** Saves the new value. Null takes the fact away. */
  onSave: (next: string | null) => Promise<void>;
}

/** Why what was typed cannot be saved, or null when it can. */
export function factProblem(kind: FactKind, typed: string): string | null {
  const value = typed.trim();
  if (!value) return null;
  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'This does not look like an email address.';
  if (kind === 'number' && !(Number.isFinite(Number(value.replace(/,/g, ''))) && Number(value.replace(/,/g, '')) >= 0)) return 'Type a number, for example 250000.';
  if (kind === 'url' && (/\s/.test(value) || !/\./.test(value))) return 'This does not look like a web address.';
  if (kind === 'tel' && !/^[+()\d\s.-]{5,25}$/.test(value)) return 'This does not look like a phone number.';
  return null;
}

export const EditableFact: React.FC<Props> = ({ label, value, children, kind = 'text', placeholder, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `fact-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const problem = editing ? factProblem(kind, typed) : null;

  const save = async (next: string | null) => {
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (error) {
      toast.error(publicMessage(error, `${label} could not be saved. Please try again.`));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (problem) return;
    const next = kind === 'number' ? typed.trim().replace(/,/g, '') : typed.trim();
    if (next === value.trim()) { setEditing(false); return; }
    void save(next || null);
  };

  return (
    <div className="group flex flex-col gap-0.5">
      <dt className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <label htmlFor={editing ? id : undefined}>{label}</label>
        {!editing && (
          <Button
            variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground opacity-70 hover:opacity-100 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            aria-label={`Edit ${label.toLowerCase()}`} onClick={() => { setTyped(value); setEditing(true); }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
      </dt>
      <dd className="min-w-0 break-words text-sm text-foreground">
        {!editing ? children : (
          <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Input
              id={id} autoFocus value={typed} disabled={busy} placeholder={placeholder}
              type={kind === 'email' ? 'email' : kind === 'tel' ? 'tel' : 'text'} inputMode={kind === 'number' ? 'decimal' : undefined}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            />
            {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
            <div className="flex flex-wrap items-center gap-1">
              <Button type="submit" size="sm" disabled={busy || problem !== null}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}Save
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}><X aria-hidden />Cancel</Button>
              {value.trim() !== '' && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void save(null)} aria-label={`Remove ${label.toLowerCase()}`}>
                  <Trash2 aria-hidden />Remove
                </Button>
              )}
            </div>
          </form>
        )}
      </dd>
    </div>
  );
};

export default EditableFact;
