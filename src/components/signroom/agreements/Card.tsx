import React, { useId } from 'react';
import { cn } from '@/lib/utils';

/** A titled, bordered card: the same shape the CRM pages use. */
export const Card: React.FC<{
  title: React.ReactNode;
  /** One muted line under the title. */
  note?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, note, action, className, children }) => {
  const headingId = useId();
  return (
    <section className={cn('overflow-hidden rounded-lg border border-border bg-card', className)} aria-labelledby={headingId}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
};

/** A quiet information line with an icon, for things the person should know but not act on. */
export const Notice: React.FC<{
  icon?: React.ReactNode;
  tone?: 'neutral' | 'danger';
  role?: 'status' | 'alert';
  className?: string;
  children: React.ReactNode;
}> = ({ icon, tone = 'neutral', role, className, children }) => (
  <div
    role={role}
    className={cn(
      'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
      tone === 'danger'
        ? 'border-destructive/30 bg-destructive-soft text-destructive-soft-foreground'
        : 'border-border bg-secondary/50 text-muted-foreground',
      className,
    )}
  >
    {icon && <span className="mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4" aria-hidden>{icon}</span>}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

/** A labelled native checkbox with room for a second line. */
export const CheckRow: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ checked, onChange, disabled, required, className, children }) => (
  <label className={cn('flex min-h-[44px] items-start gap-2.5 py-2 text-sm md:min-h-0 md:py-1', disabled && 'opacity-60', className)}>
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      checked={checked}
      disabled={disabled}
      required={required}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="min-w-0">{children}</span>
  </label>
);
