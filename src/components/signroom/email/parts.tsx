// Small pieces the email connection steps share: the step frame, a busy button, a line of help.
import React, { useId } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const HELP = 'text-xs text-muted-foreground';
export const PAIR = 'grid grid-cols-1 gap-3 sm:grid-cols-2';

/** One step of connecting: its name, where it sits in the sequence, and what comes after it. */
export const Step: React.FC<{
  title: string;
  step?: { n: number; of: number | null };
  /** What happens once this step is done. */
  next?: string;
  children: React.ReactNode;
}> = ({ title, step, next, children }) => {
  const headingId = useId();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">{title}</h3>
        {step && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {step.of ? `Step ${step.n} of ${step.of}` : `Step ${step.n}`}
          </span>
        )}
      </div>
      {children}
      {next && (
        <p className={cn(HELP, 'flex items-start gap-1.5')}>
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{next}</span>
        </p>
      )}
    </section>
  );
};

/** A button that shows it is working. */
export const BusyButton: React.FC<ButtonProps & { working: boolean }> = ({ working, children, ...props }) => (
  <Button {...props}>
    {working && <Loader2 className="animate-spin" aria-hidden />}
    {children}
  </Button>
);
