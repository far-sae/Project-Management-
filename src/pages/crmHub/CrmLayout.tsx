import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Contact, Building2, Handshake, ListChecks, Waypoints, Tag,
  PieChart as PieIcon, CalendarRange, LayoutDashboard, Settings as SettingsIcon,
  Layers,
} from 'lucide-react';
import { CrmCurrencyProvider } from '@/context/CrmCurrencyContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';

interface Tab {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { to: '/crm/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/crm/contacts', label: 'Leads', icon: Contact },
  { to: '/crm/companies', label: 'Business', icon: Building2 },
  { to: '/crm/deals', label: 'Contract', icon: Handshake },
  { to: '/crm/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/crm/activity', label: 'Activity', icon: Waypoints },
  { to: '/crm/calendar', label: 'Calendar', icon: CalendarRange },
  { to: '/crm/reports', label: 'Reports', icon: PieIcon },
  { to: '/crm/tags', label: 'Tags', icon: Tag },
  { to: '/crm/settings', label: 'Settings', icon: SettingsIcon },
];

export const CrmLayout: React.FC = () => (
  <CrmCurrencyProvider>
    <CrmLayoutInner />
  </CrmCurrencyProvider>
);

const CrmLayoutInner: React.FC = () => {
  const { selected, isAll, isUnassigned } = useSelectedWorkspace();
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
