// The frame every automation screen sits in: the page body, the title row and the five sections.
import React from 'react';
import { NavLink } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';

export const AUTOMATION_SECTIONS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/crm/automation', label: 'Overview', end: true },
  { to: '/crm/automation/assistant', label: 'Assistant' },
  { to: '/crm/automation/agents', label: 'Agents' },
  { to: '/crm/automation/runs', label: 'Runs' },
  { to: '/crm/automation/rules', label: 'Workspace rules' },
];

/** The row of sections under the title. */
export const AutomationNav: React.FC = () => (
  <nav aria-label="Automation sections" className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto border-b border-border">
    {AUTOMATION_SECTIONS.map(({ to, label, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) => cn(
          'whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
      </NavLink>
    ))}
  </nav>
);

/**
 * One automation screen. Every screen under /crm/automation renders this as
 * its root, so the title, the sections and the spacing are the same on all of
 * them. `actions` are the buttons on the right of the title.
 */
export const AutomationPage: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, actions, children }) => (
  <main className="min-w-0 flex-1 overflow-y-auto bg-background">
    <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
      <PageHeader title={title} description={description} actions={actions} />
      <AutomationNav />
      {children}
    </div>
  </main>
);
