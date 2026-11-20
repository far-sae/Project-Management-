// The small control for when a step starts: straight away, after days with no reply, on a reply, or when the deal is won.
import React, { useEffect, useState } from 'react';
import { DEFAULT_NO_REPLY_DAYS, MAX_NO_REPLY_DAYS, START_CHOICES, startOfKind, type StartKind } from '@/lib/automation/draft';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StepStart } from '../../../../api/_automation/shared/types';

export interface StartControlProps {
  value: StepStart;
  onChange: (next: StepStart) => void;
  /** Names the control for screen readers: "When step 2 starts". */
  label: string;
  disabled?: boolean;
}

export const StartControl: React.FC<StartControlProps> = ({ value, onChange, label, disabled }) => {
  const days = value.type === 'no_reply_days' ? value.days : DEFAULT_NO_REPLY_DAYS;
  // What is typed is kept as text, so the box can be emptied while a new number is written.
  const [typed, setTyped] = useState(String(days));
  useEffect(() => { setTyped(String(days)); }, [days]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.type} disabled={disabled} onValueChange={(kind) => onChange(startOfKind(kind as StartKind, days))}>
        <SelectTrigger aria-label={label} className="w-auto min-w-[11rem] md:h-7 md:text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {START_CHOICES.map((choice) => <SelectItem key={choice.kind} value={choice.kind}>{choice.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {value.type === 'no_reply_days' && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Days</span>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_NO_REPLY_DAYS}
            value={typed}
            disabled={disabled}
            aria-label={`${label}: days with no reply`}
            className="w-16 tabular-nums md:h-7 md:text-xs"
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() && Number.isFinite(n) && n >= 1) onChange(startOfKind('no_reply_days', n));
            }}
            onBlur={() => setTyped(String(days))}
          />
        </label>
      )}
    </div>
  );
};

export default StartControl;
