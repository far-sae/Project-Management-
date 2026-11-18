import React, { useId } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { HrPerson } from '../types';

/** One line in a box's list. */
export const BOX_ROW =
  'flex min-h-11 items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0';

/** Bordered box with a title row and a list (or empty state) underneath. */
export const SectionBox: React.FC<{
  title: string;
  /** Muted text or a link on the right of the title row. */
  meta?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, meta, children }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border px-4 py-2">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </section>
  );
};

/** "Open Leave" style link in a box's title row. */
export const SectionLink: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="-m-1 rounded p-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    {children}
  </button>
);

export const SectionEmpty: React.FC<{ icon: React.ElementType; title: string; hint?: string }> = ({
  icon: Icon,
  title,
  hint,
}) => (
  <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
    <Icon className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
    <p className="text-sm font-medium text-foreground">{title}</p>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const SectionSpinner: React.FC = () => (
  <div className="flex justify-center py-8">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
  </div>
);

export const SectionError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
    <p className="min-w-0 text-sm text-destructive">{message}</p>
    <Button type="button" size="sm" variant="outline" onClick={onRetry}>
      Retry
    </Button>
  </div>
);

/**
 * What a box shows instead of its list while its data is loading or could
 * not be loaded. Returns null when the list can be shown.
 */
export function sectionState(source: {
  loading: boolean;
  error: string | null;
  refresh: () => unknown;
}): React.ReactNode | null {
  if (source.error) return <SectionError message={source.error} onRetry={() => void source.refresh()} />;
  if (source.loading) return <SectionSpinner />;
  return null;
}

/** Shown for a leave request or document whose owner has left the organization. */
export const FORMER_MEMBER = 'Former member';

export const personName = (person: HrPerson | undefined): string =>
  person ? person.displayName.trim() || person.email || 'Member' : FORMER_MEMBER;

/** 24px avatar with the person's initial as fallback. */
export const PersonAvatar: React.FC<{ person: HrPerson | undefined; className?: string }> = ({
  person,
  className,
}) => (
  <Avatar className={cn('h-6 w-6 shrink-0', className)}>
    <AvatarImage src={person?.photoURL || undefined} alt="" />
    <AvatarFallback className="text-xs font-semibold">
      {person ? personName(person).charAt(0).toUpperCase() : '?'}
    </AvatarFallback>
  </Avatar>
);
