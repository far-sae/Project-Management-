import React, { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Loader2, Layers } from 'lucide-react';
import { CrmCurrencyProvider } from '@/context/CrmCurrencyContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { cn } from '@/lib/utils';

/** In the order the work flows: a lead becomes a deal, a won deal becomes a project. */
const TABS: Array<{ to: string; label: string }> = [
  { to: '/crm/dashboard', label: 'Overview' },
  { to: '/crm/contacts', label: 'Leads' },
  { to: '/crm/companies', label: 'Companies' },
  { to: '/crm/deals', label: 'Deals' },
  { to: '/crm/tasks', label: 'Follow-ups' },
  { to: '/crm/activity', label: 'Activity' },
  { to: '/crm/tags', label: 'Tags' },
  { to: '/crm/settings', label: 'Settings' },
];

export const CrmLayout: React.FC = () => (
  <CrmCurrencyProvider>
    <CrmLayoutInner />
  </CrmCurrencyProvider>
);

const CrmLayoutInner: React.FC = () => {
  const { selected, isAll, isUnassigned, select, DEFAULT_WORKSPACE_ID, workspaces, loading } = useSelectedWorkspace();

  // The CRM always works inside one workspace: leads, deals and the projects
  // they turn into belong together.
  useEffect(() => {
    if (loading || (!isAll && !isUnassigned)) return;
    const target = workspaces.find((workspace) => workspace.workspaceId === DEFAULT_WORKSPACE_ID)
      ?? workspaces[0];
    if (target) select(target.workspaceId);
  }, [DEFAULT_WORKSPACE_ID, isAll, isUnassigned, loading, select, workspaces]);

  if (loading || !selected) {
    return (
      <div className="grid flex-1 place-items-center bg-background">
        <div className="text-center text-sm text-muted-foreground">
          {workspaces.length === 0 && !loading ? (
            'Create a workspace to use the CRM.'
          ) : (
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-border px-4 lg:px-6">
        <nav aria-label="CRM sections" className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto">
          {TABS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'inline-flex h-10 items-center whitespace-nowrap border-b-2 px-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div
          className="mb-2 hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
          title="Change workspace from the switcher in the sidebar"
        >
          <Layers className="h-3.5 w-3.5" />
          <span className="max-w-[14rem] truncate font-medium text-foreground">{selected.name}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};

export default CrmLayout;
