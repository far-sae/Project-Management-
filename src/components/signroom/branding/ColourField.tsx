// A colour, chosen with the browser's picker or typed as a hex code.
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FIELD } from '@/components/signroom/billing/shared';

const HEX = /^#[0-9a-f]{6}$/i;
const SWATCH = 'h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:h-8';

interface Props {
  id: string;
  label: string;
  /** "#rrggbb" */
  value: string;
  onValue: (hex: string) => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * The picker and the hex box show the same colour. A half-typed code is kept
 * in the box until it is a whole colour, and dropped if the box is left before then.
 */
export const ColourField: React.FC<Props> = ({ id, label, value, onValue, disabled, hint }) => {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className={FIELD}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id} type="color" className={SWATCH} disabled={disabled}
          value={value} onChange={(event) => { setTyped(null); onValue(event.target.value.toLowerCase()); }}
        />
        <Input
          aria-label={`${label} as a hex code`} className="w-28 tabular-nums" maxLength={7} spellCheck={false} disabled={disabled}
          value={typed ?? value}
          onChange={(event) => {
            const text = event.target.value.trim();
            if (HEX.test(text)) {
              setTyped(null);
              onValue(text.toLowerCase());
            } else {
              setTyped(text);
            }
          }}
          onBlur={() => setTyped(null)}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

export default ColourField;
