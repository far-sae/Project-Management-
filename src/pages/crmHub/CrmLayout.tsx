import React, { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Contact, Building2, Handshake, ListChecks, Waypoints, Tag,
  LayoutDashboard, Settings as SettingsIcon, Loader2,
  Layers,
} from 'lucide-react';
import { CrmCurrencyProvider } from '@/context/CrmCurrencyContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { useProjects } from '@/hooks/useProjects';
import { Button } from '@/components/ui/button';

interface Tab {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { to: '/crm/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/crm/contacts', label: 'Contacts', icon: Contact },
  { to: '/crm/companies', label: 'Companies', icon: Building2 },
  { to: '/crm/deals', label: 'Deals', icon: Handshake },
  { to: '/crm/tasks', label: 'Follow-ups', icon: ListChecks },
  { to: '/crm/activity', label: 'Activity', icon: Waypoints },
  { to: '/crm/tags', label: 'Tags', icon: Tag },
  { to: '/crm/settings', label: 'Settings', icon: SettingsIcon },
];

export const CrmLayout: React.FC = () => (
  <CrmCurrencyProvider>
    <CrmLayoutInner />
  </CrmCurrencyProvider>
);

const CrmLayoutInner: React.FC = () => {
  const { selected, isAll, isUnassigned, select, DEFAULT_WORKSPACE_ID, workspaces, loading } = useSelectedWorkspace();
  const { projects, loading: projectsLoading } = useProjects();

  useEffect(() => {
    if (loading || (!isAll && !isUnassigned)) return;
    const target = workspaces.find((workspace) => workspace.workspaceId === DEFAULT_WORKSPACE_ID)
      ?? workspaces[0];
    if (target) select(target.workspaceId);
  }, [DEFAULT_WORKSPACE_ID, isAll, isUnassigned, loading, select, workspaces]);

  if (loading || !selected) {
    return (
      <div className="flex-1 grid place-items-center bg-background">
        <div className="text-center text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2" />
          {workspaces.length === 0 && !loading ? 'Create a workspace to open CRM.' : 'Opening workspace CRM...'}
        </div>
      </div>
    );
  }
  const hasProject = projects.some((project) => project.workspaceId === selected.workspaceId);
  if (!projectsLoading && !hasProject) {
    return <div className="flex-1 grid place-items-center p-6"><div className="max-w-md text-center"><Layers className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h2 className="text-xl font-semibold">Create this workspace’s first project</h2><p className="mt-2 text-sm text-muted-foreground">CRM becomes available after the workspace has a delivery project, keeping contacts, deals and work in one flow.</p><Button asChild className="mt-4"><Link to="/dashboard">Open Project Management</Link></Button></div></div>;
  }
  const scopeLabel = isAll
    ? 'All workspaces'
    : isUnassigned
    ? 'Unassigned'
    : selected?.name ?? '—';
  return (
  <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
    <div className="border-b border-border bg-card/60 backdrop-blur-sm">
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-primary/15 text-primary flex items-center justify-center">
              <Handshake className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">CRM</h2>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground" title="Change workspace from the sidebar workspace switcher">
            <Layers className="w-3 h-3" />
            <span>Scope:</span>
            <span className="font-medium text-foreground truncate max-w-[16rem]">{scopeLabel}</span>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <Outlet />
    </div>
  </div>
  );
};

export default CrmLayout;
