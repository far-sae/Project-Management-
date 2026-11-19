// Small pieces every invoice screen uses: the card, empty states, the status pill.
import React, { useId } from 'react';
import { FolderOpen } from 'lucide-react';
import type { Invoice } from '../../../../api/_signroom/shared/types';
import { isOverdue } from '@/lib/signroom/billing';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';

export const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
export const FIELD = 'flex min-w-0 flex-col gap-1.5';
export const TH = 'whitespace-nowrap px-3 py-2 text-left font-medium';
export const TH_RIGHT = 'whitespace-nowrap px-3 py-2 text-right font-medium';
export const TD = 'px-3 py-2';
export const TD_MONEY = 'whitespace-nowrap px-3 py-2 text-right tabular-nums';
export const TD_DATE = 'whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground';
export const ROW = 'border-b border-border last:border-b-0';
export const HEAD_ROW = 'border-b border-border text-xs text-muted-foreground';

/** A bordered card with a title row. */
export const Card: React.FC<{
  title: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, count, action, className, children }) => {
  const headingId = useId();
  return (
    <section className={cn(BOX, className)} aria-labelledby={headingId}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-1.5">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
          {count != null && <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
};

/** A dashed box that says there is nothing here, and what to do about it. */
export const EmptyState: React.FC<{ icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({
  icon, action, children,
}) => (
  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
    {icon}
    <p className="max-w-md text-sm text-muted-foreground">{children}</p>
    {action}
  </div>
);

/** Shown while "All workspaces" or "Unassigned" is selected: invoices always belong to one workspace. */
export const PickWorkspace: React.FC<{ what?: string; compact?: boolean }> = ({ what = 'its invoices', compact }) =>
  compact ? (
    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Pick a workspace in the sidebar to see {what}.</p>
  ) : (
    <EmptyState icon={<FolderOpen className="h-5 w-5 text-muted-foreground" aria-hidden />}>
      Pick a workspace in the sidebar to see {what}.
    </EmptyState>
  );

const STATUS_TONE: Record<Invoice['status'], StatusTone> = {
  Draft: 'neutral',
  Issued: 'info',
  'Part paid': 'warning',
  Paid: 'success',
  Voided: 'muted',
};

/** The invoice's status, with "Overdue" beside it while money is owed past the due date. */
export const InvoiceStatus: React.FC<{ invoice: Pick<Invoice, 'status' | 'dueDate'>; today: string }> = ({ invoice, today }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    <StatusPill tone={STATUS_TONE[invoice.status]}>{invoice.status}</StatusPill>
    {isOverdue(invoice, today) && <StatusPill tone="danger">Overdue</StatusPill>}
  </span>
);

/** A tick box with its words beside it. */
export const Tick: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  children: React.ReactNode;
}> = ({ checked, onChange, disabled, required, children }) => (
  <label className="flex items-start gap-2 text-sm text-foreground">
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      checked={checked}
      disabled={disabled}
      required={required}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="min-w-0">{children}</span>
  </label>
);

/** Hands a PDF to the browser to save under the given name. */
export function savePdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
