import React from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons / selects on the right; wraps under the title on narrow screens. */
  actions?: React.ReactNode;
  className?: string;
}

/** Title row at the top of a page body: heading, one-line description, actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, className }) => (
  <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
    <div className="min-w-0 flex-1 basis-72">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description && (
        <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
