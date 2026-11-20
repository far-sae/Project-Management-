// "How much may the agents do alone?": three choices, and a plain question before the one where nobody looks.
import React, { useId, useState } from 'react';
import type { Autonomy } from '../../../../api/_automation/shared/types';
import { AUTONOMY_CHOICES } from '@/lib/automation/rules';
import { StatusPill } from '@/components/common/StatusPill';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/signroom/billing/shared';
import { cn } from '@/lib/utils';

interface Props {
  /** The workspace's name, for the sentences. */
  place: string;
  value: Autonomy;
  onChange: (value: Autonomy) => void;
  /** True when the workspace already runs fully automatic, so there is nothing new to agree to. */
  alreadyFull: boolean;
  disabled?: boolean;
}

export const AutonomyCard: React.FC<Props> = ({ place, value, onChange, alreadyFull, disabled }) => {
  const id = useId();
  const title = `How much may the agents do alone in ${place}?`;
  const [asking, setAsking] = useState(false);
  /** Said yes once on this visit: going back and forth between the choices does not ask again. */
  const [agreed, setAgreed] = useState(false);

  const pick = (next: Autonomy) => {
    if (next === 'full' && !alreadyFull && !agreed) setAsking(true);
    else onChange(next);
  };

  return (
    <Card title={title}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">You can still set this per agent. This is the limit for the whole workspace.</p>
        <div role="radiogroup" aria-label={title} className="flex flex-col gap-2">
          {AUTONOMY_CHOICES.map((choice) => {
            const checked = value === choice.value;
            return (
              <label
                key={choice.value}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                  checked ? 'border-foreground bg-muted' : 'border-border',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                  !disabled && !checked && 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-autonomy`}
                  value={choice.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => pick(choice.value)}
                  aria-labelledby={`${id}-${choice.value}`}
                  aria-describedby={`${id}-${choice.value}-note`}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span id={`${id}-${choice.value}`} className="text-sm font-semibold text-foreground">{choice.title}</span>
                  <span id={`${id}-${choice.value}-note`} className="text-sm text-muted-foreground">{choice.note}</span>
                  {choice.recommended && <StatusPill tone="neutral" dot={false} className="mt-1">Recommended to start</StatusPill>}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let the agents work fully on their own in {place}?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents will then email leads, mark deals won or lost and create projects without anyone looking first. You get a summary
              of each run afterwards. An agent set to ask first still asks. Nothing changes until you save the rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it as it is</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setAgreed(true); onChange('full'); }}>Yes, fully automatic</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default AutonomyCard;
