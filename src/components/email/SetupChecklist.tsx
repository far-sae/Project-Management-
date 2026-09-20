import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import type { Readiness, ReadinessStep } from '@/lib/email/readiness';

interface SetupChecklistProps {
  readiness: Readiness;
  /** Takes the person to Accounts, where all four steps are actually done. */
  onGoToAccounts: () => void;
  /** Hidden once everything is done, unless the person opened it themselves. */
  forceOpen?: boolean;
}

const icon = (state: ReadinessStep['state']) => {
  switch (state) {
    case 'done':
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case 'warning':
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />;
    default:
      return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />;
  }
};

/**
 * What still has to happen before this organization can send properly.
 *
 * It exists because the tabs are in the order they were built rather than the
 * order somebody does the work: Accounts — without which nothing sends at all
 * — sits near the end, and Compose will take a campaign from an organization
 * that has no mailbox. Somebody can get most of the way through writing before
 * anything tells them.
 *
 * It disappears once every step is done, rather than becoming a permanent
 * ornament. A checklist that is always there stops being read.
 */
export const SetupChecklist: React.FC<SetupChecklistProps> = ({
  readiness, onGoToAccounts, forceOpen,
}) => {
  const allDone = readiness.steps.every((s) => s.state === 'done');
  if (allDone && !forceOpen) return null;

  // Two different headlines, because "you cannot send" and "you can send but
  // you will not hear back" are different problems and lumping them together
  // makes the urgent one look optional.
  const blocked = !readiness.canSend;

  return (
    <Card className={blocked ? 'border-amber-300 dark:border-amber-800' : undefined}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-foreground">
              {blocked ? 'Nothing can be sent yet' : 'Finish setting up'}
            </p>
            <p className="text-sm text-muted-foreground">
              {blocked
                ? 'A campaign can be written, but it will not go anywhere until a mailbox is connected and verified.'
                : 'Sending works. These are the parts that decide whether it works well.'}
            </p>
          </div>
          <Button variant={blocked ? 'default' : 'outline'} size="sm" onClick={onGoToAccounts}>
            Go to Accounts
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <ol className="space-y-2">
          {readiness.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              {icon(step.state)}
              <div className="min-w-0">
                <p
                  className={
                    step.state === 'done'
                      ? 'text-sm text-muted-foreground line-through decoration-muted-foreground/40'
                      : 'text-sm font-medium text-foreground'
                  }
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
};
