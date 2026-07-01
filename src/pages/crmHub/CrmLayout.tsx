import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Contact, Building2, Handshake, ListChecks, Waypoints, Tag,
  PieChart as PieIcon, CalendarRange, LayoutDashboard, Settings as SettingsIcon,
} from 'lucide-react';

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
  { to: '/crm/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/crm/activity', label: 'Activity', icon: Waypoints },
  { to: '/crm/calendar', label: 'Calendar', icon: CalendarRange },
  { to: '/crm/reports', label: 'Reports', icon: PieIcon },
  { to: '/crm/tags', label: 'Tags', icon: Tag },
  { to: '/crm/settings', label: 'Settings', icon: SettingsIcon },
];

export const CrmLayout: React.FC = () => (
  <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
    <div className="border-b border-border bg-card/60 backdrop-blur-sm">
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-md bg-primary/15 text-primary flex items-center justify-center">
            <Handshake className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">CRM</h2>
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

export default CrmLayout;
