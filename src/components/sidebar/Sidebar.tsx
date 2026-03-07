import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  Users,
  Calendar,
  FileText,
  MessageSquare,
  BarChart3,
  FolderKanban,
  Settings,
  LogOut,
  CreditCard,
  Shield,
  GanttChartSquare,
  Lock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { Project, Task, TaskStatus } from '@/types';
import { QuickMenu } from './QuickMenu';
import { StatusFilters } from './StatusFilters';
import { MemberList } from './MemberList';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface SidebarProps {
  project?: Project | null;
  tasks?: Task[];
  selectedStatus?: TaskStatus | 'all';
  onStatusChange?: (status: TaskStatus | 'all') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  project,
  tasks = [],
  selectedStatus = 'all',
  onStatusChange,
}) => {
  const { user, signOut } = useAuth();
  const { trialInfo, hasFeature } = useSubscription();
  const navigate = useNavigate();

  const quickMenuItems = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
    { icon: CheckSquare, label: 'My Tasks', href: '/tasks' },
    { icon: Users, label: 'Team', href: '/team' },
  ];

  //Each item has an optional feature gate
  const bottomMenuItems = [
    { icon: Calendar, label: 'Calendar', href: '/calendar', feature: null },
    { icon: GanttChartSquare, label: 'Timeline Overview', href: '/timeline', feature: 'timeline_overview' },
    { icon: FileText, label: 'Contracts', href: '/contracts', feature: 'contracts' },
    { icon: FileText, label: 'Files', href: '/files', feature: 'file_attachments' },
    { icon: MessageSquare, label: 'Comments', href: '/comments', feature: null },
    { icon: BarChart3, label: 'Reports', href: '/reports', feature: 'reports' },
  ] as const;

  const taskCounts = useMemo(() => {
    const counts: Record<TaskStatus | 'all', number> = {
      all: tasks.length,
      undefined: 0,
      todo: 0,
      inprogress: 0,
      done: 0,
      needreview: 0,
    };
    tasks.forEach((task) => {
      if (counts[task.status] !== undefined) counts[task.status]++;
    });
    return counts;
  }, [tasks]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-2">
        <Link to="/dashboard" className="flex items-center gap-3 min-w-0">
          <img src="/logo.png" alt="TaskCalander" className="w-10 h-10 rounded-full object-contain shrink-0" />
          <div className="min-w-0">
            <h1 className="font-bold text-gray-900">TaskCalander</h1>
            <p className="text-xs text-gray-500">Task & project management</p>
          </div>
        </Link>
        <NotificationBell />
      </div>

      {trialInfo && trialInfo.isInTrial && (
        <div className="mx-4 mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-sm font-medium text-orange-800">
            Trial: {trialInfo.daysRemaining} days left
          </p>
          <Button
            variant="link"
            className="text-xs text-orange-600 p-0 h-auto"
            onClick={() => navigate('/pricing')}
          >
            <CreditCard className="w-3 h-3 mr-1" />
            Upgrade now
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <QuickMenu items={quickMenuItems} />

        {project && onStatusChange && (
          <StatusFilters
            selectedStatus={selectedStatus}
            onStatusChange={onStatusChange}
            taskCounts={taskCounts}
          />
        )}

        {project && project.members.length > 0 && (
          <MemberList members={project.members} />
        )}

        <Separator className="my-4" />

        <nav className="space-y-1">
          {bottomMenuItems.map((item) => {
            const Icon = item.icon;
            //  Check if this item requires a feature
            const locked = item.feature ? !hasFeature(item.feature as any) : false;

            return locked ? (
              // Show locked item — still visible but with lock icon, navigates to pricing
              <button
                key={item.href}
                onClick={() => navigate('/pricing')}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-50 transition-colors"
              >
                <Icon className="w-5 h-5" />
                <span className="flex-1 text-left">{item.label}</span>
                <Lock className="w-3 h-3" />
              </button>
            ) : (
              <Link
                key={item.href}
                to={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-200">
        {user?.role === 'admin' && (
          <Link
            to="/admin"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-purple-600 hover:bg-purple-50 transition-colors mb-2"
          >
            <Shield className="w-5 h-5" />
            <span>Admin Panel</span>
          </Link>
        )}

        <Link
          to="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </Link>

        <Separator className="my-3" />

        <div className="flex items-center gap-3">
          <Avatar className="w-9 h-9">
            <AvatarImage src={user?.photoURL} alt={user?.displayName} />
            <AvatarFallback className="bg-orange-100 text-orange-700">
              {user?.displayName?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.displayName}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 hover:text-red-500"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
