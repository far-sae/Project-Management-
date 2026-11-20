// Small pieces the workspace rules cards share: a switch with its words, a problem sentence, the row buttons of a list.
import React, { useId } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export const HINT = 'text-xs text-muted-foreground';
export const SUB_TITLE = 'text-sm font-medium text-foreground';

/** What is wrong with the field above it. Renders nothing while all is well. */
export const Problem: React.FC<{ id?: string; children?: string }> = ({ id, children }) =>
  children ? <p id={id} className="text-xs text-destructive">{children}</p> : null;

/** A switch with its name on the left and, under the name, what it means. */
export const SwitchRow: React.FC<{
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}> = ({ label, hint, checked, onChange, disabled, className }) => {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="leading-5">{label}</Label>
        {hint && <p id={`${id}-hint`} className={HINT}>{hint}</p>}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5"
      />
    </div>
  );
};

/** Move up, move down and remove, for one row of a list. `what` names the row: "column 2", "task 1". */
export const RowButtons: React.FC<{
  what: string;
  first: boolean;
  last: boolean;
  /** False when the row may not be removed (the last column of a board). */
  removable?: boolean;
  disabled?: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}> = ({ what, first, last, removable = true, disabled, onMove, onRemove }) => (
  <div className="flex shrink-0 items-center">
    <Button type="button" variant="ghost" size="icon" aria-label={`Move ${what} up`} disabled={disabled || first} onClick={() => onMove(-1)}>
      <ArrowUp aria-hidden />
    </Button>
    <Button type="button" variant="ghost" size="icon" aria-label={`Move ${what} down`} disabled={disabled || last} onClick={() => onMove(1)}>
      <ArrowDown aria-hidden />
    </Button>
    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${what}`} disabled={disabled || !removable} onClick={onRemove}>
      <X aria-hidden />
    </Button>
  </div>
);
