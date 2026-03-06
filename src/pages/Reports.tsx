import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BarChart3, TrendingUp, CheckCircle, Clock, Loader2, ArrowRight,
  Users, Briefcase, Timer, LayoutDashboard, FolderKanban, Lock,
  DollarSign, FileText, RefreshCw, AlertTriangle, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/AuthContext';
import { useProjects } from '@/hooks/useProjects';
import { useAllTasks } from '@/hooks/useAllTasks';
import { useUserComments } from '@/hooks/useComments';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { DEFAULT_COLUMNS } from '@/types';
import { getOrganizationContracts, Contract } from '@/services/supabase/contracts';
import { format } from 'date-fns';

const ALL_WORKSPACES_ID = '__all__';

// Currency symbols mapping
const CURRENCY_SYMBOLS: Record<string, { symbol: string, name: string; }> = {
  USD: { symbol: '$', name: 'US Dollar' },
  GBP: { symbol: '£', name: 'British Pound' },
  EUR: { symbol: '€', name: 'Euro' },
  INR: { symbol: '₹', name: 'Indian Rupee' },
  AED: { symbol: 'د.إ', name: 'UAE Dirham' },
};

export const Reports: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects } = useProjects();
  const { tasks, loading } = useAllTasks();
  const { comments } = useUserComments(user?.userId ?? null);
  const { organization } = useOrganization();
  const { hasFeature } = useSubscription();

  const { workspaces, DEFAULT_WORKSPACE_ID: RAW_DEFAULT_WS_ID } = useWorkspaces();
  const DEFAULT_WORKSPACE_ID = RAW_DEFAULT_WS_ID || '__default__';

  // Tab state
  const [activeTab, setActiveTab] = useState<'projects' | 'business'>('projects');
  const [reportWorkspaceId, setReportWorkspaceId] = useState<string>(ALL_WORKSPACES_ID);

  // Business reports state
  const [businessContracts, setBusinessContracts] = useState<Contract[]>([]);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL'); // 'ALL' or specific currency

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => { } });

  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');

  // Fetch business data when tab changes
  useEffect(() => {
    if (activeTab === 'business' && orgId && !orgId.startsWith('local-')) {
      fetchBusinessData();
    }
  }, [activeTab, orgId]);

  const fetchBusinessData = async () => {
    if (!orgId) return;

    setBusinessLoading(true);
    setBusinessError(null);
    const toastId = toast.loading('Fetching business reports...');

    try {
      const contracts = await getOrganizationContracts(orgId);
      setBusinessContracts(contracts);
      toast.success(`Loaded ${contracts.length} contracts`, { id: toastId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch contracts';
      setBusinessError(errorMsg);
      toast.error('Failed to load business data', {
        description: errorMsg,
        id: toastId,
      });
    } finally {
      setBusinessLoading(false);
    }
  };

  // Workspace list for filter
  const workspaceListForSelect = useMemo(() => {
    const list = [...workspaces];
    if (!list.some((w) => w.workspaceId === DEFAULT_WORKSPACE_ID)) {
      list.unshift({
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: 'Default',
        organizationId: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as (typeof workspaces)[0]);
    }
    return list;
  }, [workspaces]);

  // Filter projects by workspace
  const filteredProjects = useMemo(() => {
    if (reportWorkspaceId === ALL_WORKSPACES_ID) return projects;
    if (reportWorkspaceId === DEFAULT_WORKSPACE_ID) {
      return projects.filter(
        (p) => !(p as any).workspaceId || (p as any).workspaceId === '' || (p as any).workspaceId === DEFAULT_WORKSPACE_ID
      );
    }
    return projects.filter((p) => (p as any).workspaceId === reportWorkspaceId);
  }, [projects, reportWorkspaceId, DEFAULT_WORKSPACE_ID]);

  const filteredProjectIds = useMemo(() => new Set(filteredProjects.map((p) => p.projectId)), [filteredProjects]);
  const filteredTasks = useMemo(
    () => tasks.filter((t) => filteredProjectIds.has(t.projectId)),
    [tasks, filteredProjectIds]
  );

  // Project metrics
  const totalProjects = filteredProjects.length;
  const totalTasks = filteredTasks.length;
  const completedTasks = filteredTasks.filter((t) => t.status === 'done').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Status counts
  const statusCounts: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    DEFAULT_COLUMNS.forEach((col) => { counts[col.id] = 0; });
    filteredTasks.forEach((t) => { if (counts[t.status] !== undefined) counts[t.status]++; });
    return counts;
  }, [filteredTasks]);

  const statusLabels: Record<string, string> = {
    undefined: 'Undefined', todo: 'To-do', inprogress: 'In Progress',
    done: 'Done', needreview: 'Need Review',
  };

  // Tasks by user
  const tasksByUser = useMemo(() => {
    const map = new Map<string, { displayName: string; count: number; done: number; }>();
    filteredTasks.forEach((t) => {
      if (t.assignees?.length) {
        t.assignees.forEach((a) => {
          const cur = map.get(a.userId) || { displayName: a.displayName || 'Unknown', count: 0, done: 0 };
          cur.count++;
          if (t.status === 'done') cur.done++;
          map.set(a.userId, cur);
        });
      }
    });
    return Array.from(map.entries()).map(([userId, data]) => ({ userId, ...data }));
  }, [filteredTasks]);

  // Time logged
  const timeLoggedMinutes = useMemo(() => {
    const taskIds = new Set(filteredTasks.map((t) => t.taskId));
    return (comments || []).reduce((sum, c) => (taskIds.has(c.taskId) ? sum + (c.timeSpentMinutes ?? 0) : sum), 0);
  }, [comments, filteredTasks]);

  // Workspace stats
  const workspaceStats = useMemo(() => {
    const withDefault = [...workspaces];
    if (!withDefault.some((w) => w.workspaceId === DEFAULT_WORKSPACE_ID)) {
      withDefault.unshift({ workspaceId: DEFAULT_WORKSPACE_ID, name: 'Default', organizationId: '', createdAt: new Date(), updatedAt: new Date() });
    }
    return withDefault.map((ws) => {
      const wsProjects = projects.filter(
        (p) => (p as { workspaceId?: string; }).workspaceId === ws.workspaceId ||
          (!(p as { workspaceId?: string; }).workspaceId && ws.workspaceId === DEFAULT_WORKSPACE_ID)
      );
      const wsProjectIds = new Set(wsProjects.map((p) => p.projectId));
      const wsTasks = tasks.filter((t) => wsProjectIds.has(t.projectId));
      return {
        workspaceId: ws.workspaceId, name: ws.name,
        projectCount: wsProjects.length, taskCount: wsTasks.length,
        completedCount: wsTasks.filter((t) => t.status === 'done').length,
      };
    });
  }, [workspaces, projects, tasks]);

  // Recent tasks
  const recentTasks = useMemo(
    () => [...filteredTasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8),
    [filteredTasks]
  );

  // Business metrics calculations with multi-currency support
  const businessMetrics = useMemo(() => {
    const contracts = businessContracts;

    // Get unique currencies
    const currencies = Array.from(new Set(contracts.map(c => c.currency || 'USD')));

    // Filter contracts by selected currency
    const filteredContracts = selectedCurrency === 'ALL'
      ? contracts
      : contracts.filter(c => (c.currency || 'USD') === selectedCurrency);

    // Basic stats
    const totalContracts = filteredContracts.length;
    const totalValue = filteredContracts.reduce((sum, c) => sum + (c.value || 0), 0);
    const avgValue = totalContracts > 0 ? totalValue / totalContracts : 0;

    // By status
    const byStatus = {
      draft: filteredContracts.filter(c => c.status === 'draft').length,
      pending: filteredContracts.filter(c => c.status === 'pending').length,
      accepted: filteredContracts.filter(c => c.status === 'accepted').length,
      expired: filteredContracts.filter(c => c.status === 'expired').length,
    };

    // By currency (for all contracts)
    const byCurrency = contracts.reduce((acc, c) => {
      const curr = c.currency || 'USD';
      if (!acc[curr]) {
        acc[curr] = {
          count: 0,
          value: 0,
          symbol: CURRENCY_SYMBOLS[curr]?.symbol || '$'
        };
      }
      acc[curr].count += 1;
      acc[curr].value += c.value || 0;
      return acc;
    }, {} as Record<string, { count: number; value: number; symbol: string; }>);

    // By client (filtered by selected currency)
    const byClient = filteredContracts.reduce((acc, c) => {
      const client = c.client;
      if (!acc[client]) {
        acc[client] = { count: 0, value: 0 };
      }
      acc[client].count += 1;
      acc[client].value += c.value || 0;
      return acc;
    }, {} as Record<string, { count: number; value: number; }>);

    const topClients = Object.entries(byClient)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Expiring soon
    const today = new Date();
    const next30Days = new Date();
    next30Days.setDate(today.getDate() + 30);

    const expiringSoon = filteredContracts.filter(c =>
      c.status === 'accepted' &&
      c.endDate &&
      new Date(c.endDate) >= today &&
      new Date(c.endDate) <= next30Days
    );

    // Get the current currency symbol
    const currentSymbol = selectedCurrency === 'ALL'
      ? '$'
      : CURRENCY_SYMBOLS[selectedCurrency]?.symbol || '$';

    return {
      totalContracts,
      totalValue,
      avgValue,
      byStatus,
      byCurrency,
      topClients,
      expiringSoon,
      currencies,
      currentSymbol,
      selectedCurrency,
    };
  }, [businessContracts, selectedCurrency]);

  // Feature gate
  if (!hasFeature('reports')) {
    return (
      <div className="flex h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-500">Productivity insights and analytics</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Reports & Analytics</h2>
            <p className="text-gray-500 mb-2 max-w-md">
              Get productivity insights — task overview, workload per user, time tracking, and workspace dashboards.
            </p>
            <p className="text-sm text-orange-600 font-medium mb-6">
              Available on Basic plan and above
            </p>
            <Button
              className="bg-gradient-to-r from-orange-500 to-red-500"
              onClick={() => navigate('/pricing')}
            >
              Upgrade to Basic
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
            <p className="text-gray-500">
              {activeTab === 'projects'
                ? 'Productivity insights – task overview, workload, time tracking, and workspace dashboard'
                : 'Business metrics – contracts, values, and client insights'}
            </p>
          </div>

          {/* Workspace filter (only for projects tab) */}
          {activeTab === 'projects' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Workspace</span>
              <Select value={reportWorkspaceId} onValueChange={setReportWorkspaceId}>
                <SelectTrigger className="w-[220px] bg-white">
                  <SelectValue placeholder="All workspaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_WORKSPACES_ID}>All workspaces</SelectItem>
                  {workspaceListForSelect.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-b mb-6">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'projects'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Project Analytics
            </button>
            <button
              onClick={() => setActiveTab('business')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'business'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              Business Reports
            </button>
          </div>
        </div>

        {/* Project Analytics Tab */}
        {activeTab === 'projects' && (
          <>
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-500">Total Projects</CardTitle>
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalProjects}</div>
                      <p className="text-xs text-gray-500">{reportWorkspaceId === ALL_WORKSPACES_ID ? 'Active projects' : 'In selected workspace'}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-500">Total Tasks</CardTitle>
                      <Clock className="w-4 h-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalTasks}</div>
                      <p className="text-xs text-gray-500">{reportWorkspaceId === ALL_WORKSPACES_ID ? 'Across all projects' : 'In selected workspace'}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-500">Completed</CardTitle>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{completedTasks}</div>
                      <p className="text-xs text-gray-500">Tasks completed</p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-gray-500">Completion Rate</CardTitle>
                      <TrendingUp className="w-4 h-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{completionRate}%</div>
                      <p className="text-xs text-gray-500">Overall progress</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Time Tracking Card */}
                <Card className="mb-6 border-0 shadow-md bg-gradient-to-br from-slate-50 to-white">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Timer className="w-5 h-5 text-orange-500" />
                      <CardTitle>Time tracking</CardTitle>
                    </div>
                    <p className="text-sm text-gray-500">Time logged in comments</p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <div className="text-3xl font-bold text-gray-900">
                        {Math.floor(timeLoggedMinutes / 60)}h {timeLoggedMinutes % 60}m
                      </div>
                      <p className="text-sm text-gray-500">total from your comments</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Task Overview and User Workload */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <LayoutDashboard className="w-5 h-5 text-orange-500" />
                        <CardTitle>Task overview</CardTitle>
                      </div>
                      <p className="text-sm text-gray-500">Recent activity</p>
                    </CardHeader>
                    <CardContent>
                      {recentTasks.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4">No tasks yet</p>
                      ) : (
                        <ul className="space-y-2">
                          {recentTasks.map((t) => (
                            <li
                              key={t.taskId}
                              onClick={() => navigate(`/project/${t.projectId}`)}
                              className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-gray-50 border border-transparent hover:border-gray-200"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900 truncate">{t.title}</p>
                                <p className="text-xs text-gray-500">
                                  {t.assignees?.length ? t.assignees.map((a) => a.displayName).join(', ') : 'Unassigned'} · {statusLabels[t.status] || t.status}
                                </p>
                              </div>
                              <div className="w-2 h-2 rounded-full shrink-0 ml-2" style={{ backgroundColor: DEFAULT_COLUMNS.find((c) => c.id === t.status)?.color || '#9E9E9E' }} />
                              <ArrowRight className="w-4 h-4 text-gray-400 shrink-0 ml-2" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-500" />
                        <CardTitle>Tasks by user</CardTitle>
                      </div>
                      <p className="text-sm text-gray-500">Workload per assignee</p>
                    </CardHeader>
                    <CardContent>
                      {tasksByUser.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4">No assigned tasks</p>
                      ) : (
                        <div className="space-y-3">
                          {tasksByUser.map(({ userId, displayName, count, done }) => {
                            const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                            const donePct = count > 0 ? Math.round((done / count) * 100) : 0;
                            return (
                              <div key={userId} className="flex items-center justify-between p-3 rounded-lg bg-gray-50/80 hover:bg-gray-100/80 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-sm shrink-0">
                                    {displayName.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-medium text-gray-900 truncate">{displayName}</p>
                                    <p className="text-xs text-gray-500">{count} tasks · {donePct}% done</p>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="font-semibold text-gray-900">{count}</span>
                                  <span className="text-xs text-gray-500 ml-1">({pct}%)</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Workspace Dashboard */}
                <Card className="mb-6 border-0 shadow-md bg-white">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-purple-500" />
                      <CardTitle>Workspace dashboard</CardTitle>
                    </div>
                    <p className="text-sm text-gray-500">Projects and tasks per workspace</p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {workspaceStats.map((ws) => {
                        const rate = ws.taskCount > 0 ? Math.round((ws.completedCount / ws.taskCount) * 100) : 0;
                        return (
                          <div key={ws.workspaceId} onClick={() => navigate('/dashboard')} className="p-4 rounded-xl border border-gray-200 hover:border-orange-200 hover:bg-orange-50/30 cursor-pointer transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <FolderKanban className="w-4 h-4 text-purple-500" />
                              <span className="font-medium text-gray-900">{ws.name}</span>
                            </div>
                            <div className="flex gap-4 text-sm">
                              <span className="text-gray-600">{ws.projectCount} projects</span>
                              <span className="text-gray-600">{ws.taskCount} tasks</span>
                            </div>
                            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-purple-500 to-orange-500 rounded-full" style={{ width: `${rate}%` }} />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{rate}% complete</p>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Organization Members */}
                {organization?.members && organization.members.length > 0 && (
                  <Card className="mb-6 border-0 shadow-md bg-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-green-500" />
                        <CardTitle>Users</CardTitle>
                      </div>
                      <p className="text-sm text-gray-500">Organization members</p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-3">
                        {organization.members.map((m: { userId: string; displayName?: string; email?: string; role?: string; }) => {
                          const workload = tasksByUser.find((w) => w.userId === m.userId);
                          return (
                            <div key={m.userId} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium text-sm">
                                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{m.displayName || m.email || 'Unknown'}</p>
                                <p className="text-xs text-gray-500">{workload?.count ?? 0} tasks · {m.role || 'member'}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Project Progress and Task Distribution */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader>
                      <CardTitle>Project progress</CardTitle>
                      <p className="text-sm text-gray-500">Completion by project</p>
                    </CardHeader>
                    <CardContent>
                      {filteredProjects.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                          <p>{reportWorkspaceId === ALL_WORKSPACES_ID ? 'No projects to display' : 'No projects in this workspace'}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {filteredProjects.map((project) => {
                            const progress = project.stats.totalTasks > 0
                              ? Math.round((project.stats.completedTasks / project.stats.totalTasks) * 100) : 0;
                            return (
                              <div key={project.projectId} onClick={() => navigate(`/project/${project.projectId}`)} className="cursor-pointer hover:bg-gray-50 rounded-lg p-2 -mx-2 transition-colors">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-medium">{project.name}</span>
                                  <span className="text-sm text-gray-500">{progress}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{project.stats.completedTasks} of {project.stats.totalTasks} tasks completed</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-md bg-white">
                    <CardHeader>
                      <CardTitle>Task distribution</CardTitle>
                      <p className="text-sm text-gray-500">Tasks by status</p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {DEFAULT_COLUMNS.map((col) => {
                          const count = statusCounts[col.id] ?? 0;
                          const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                          return (
                            <div key={col.id} onClick={() => navigate('/dashboard')} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                                <span>{statusLabels[col.id] || col.title}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{count}</span>
                                <span className="text-xs text-gray-500">({pct}%)</span>
                                <ArrowRight className="w-4 h-4 text-gray-400" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </>
        )}

        {/* Business Reports Tab */}
        {activeTab === 'business' && (
          <>
            {businessError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error loading business data</AlertTitle>
                <AlertDescription>{businessError}</AlertDescription>
              </Alert>
            )}
            {businessLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
              </div>
            ) : businessContracts.length === 0 ? (
              <div className="text-center py-16 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">No contracts yet</p>
                <p className="text-sm">Create contracts to see business metrics</p>
                <Button
                  className="mt-4 bg-gradient-to-r from-orange-500 to-red-500"
                  onClick={() => navigate('/contracts')}
                >
                  Go to Contracts
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header with Currency Filter and Refresh */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="All Currencies" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Currencies</SelectItem>
                        {businessMetrics.currencies.map((currency) => (
                          <SelectItem key={currency} value={currency}>
                            {CURRENCY_SYMBOLS[currency]?.symbol || '$'} {currency} - {CURRENCY_SYMBOLS[currency]?.name || currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-gray-500">
                      Showing {businessMetrics.selectedCurrency === 'ALL' ? 'all currencies' : businessMetrics.selectedCurrency}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchBusinessData}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </Button>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Total Contracts</p>
                          <p className="text-2xl font-bold">{businessMetrics.totalContracts}</p>
                        </div>
                        <FileText className="w-8 h-8 text-blue-500 opacity-75" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Total Value</p>
                          <p className="text-2xl font-bold">
                            {businessMetrics.currentSymbol}{businessMetrics.totalValue.toLocaleString()}
                          </p>
                        </div>
                        <DollarSign className="w-8 h-8 text-green-500 opacity-75" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Average Value</p>
                          <p className="text-2xl font-bold">
                            {businessMetrics.currentSymbol}{businessMetrics.avgValue.toLocaleString()}
                          </p>
                        </div>
                        <TrendingUp className="w-8 h-8 text-purple-500 opacity-75" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Active Contracts</p>
                          <p className="text-2xl font-bold text-green-600">
                            {businessMetrics.byStatus.accepted}
                          </p>
                        </div>
                        <CheckCircle className="w-8 h-8 text-green-500 opacity-75" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Status and Currency Distribution */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Contract Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[
                          { status: 'Draft', count: businessMetrics.byStatus.draft, color: 'bg-gray-400' },
                          { status: 'Pending', count: businessMetrics.byStatus.pending, color: 'bg-yellow-400' },
                          { status: 'Accepted', count: businessMetrics.byStatus.accepted, color: 'bg-green-400' },
                          { status: 'Expired', count: businessMetrics.byStatus.expired, color: 'bg-red-400' },
                        ].map((item) => (
                          <div key={item.status} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${item.color}`} />
                              <span>{item.status}</span>
                            </div>
                            <span className="font-medium">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>By Currency</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {Object.entries(businessMetrics.byCurrency).map(([currency, data]) => (
                          <div key={currency} className="flex items-center justify-between">
                            <span>{data.symbol} {currency}</span>
                            <div className="text-right">
                              <span className="font-medium block">{data.count} contracts</span>
                              <span className="text-sm text-gray-500">
                                {data.symbol}{data.value.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Top Clients */}
                {businessMetrics.topClients.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Top Clients by Value ({businessMetrics.selectedCurrency === 'ALL' ? 'All Currencies' : businessMetrics.selectedCurrency})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {businessMetrics.topClients.map((client) => (
                          <div key={client.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium">{client.name}</p>
                              <p className="text-sm text-gray-500">{client.count} contracts</p>
                            </div>
                            <p className="font-bold text-orange-600">
                              {businessMetrics.currentSymbol}{client.value.toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Expiring Soon Alert */}
                {businessMetrics.expiringSoon.length > 0 && (
                  <Card className="border-yellow-200 bg-yellow-50">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-yellow-600" />
                        <CardTitle className="text-yellow-800">Contracts Expiring Soon</CardTitle>
                      </div>
                      <p className="text-sm text-yellow-700">
                        {businessMetrics.expiringSoon.length} contract(s) expiring in the next 30 days
                      </p>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {businessMetrics.expiringSoon.slice(0, 5).map((contract) => {
                          const currencySymbol = CURRENCY_SYMBOLS[contract.currency || 'USD']?.symbol || '$';
                          return (
                            <div key={contract.contractId} className="flex items-center justify-between p-2 bg-white rounded border border-yellow-200">
                              <div>
                                <p className="font-medium">{contract.title}</p>
                                <p className="text-sm text-gray-500">{contract.client}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-yellow-700">
                                  {format(new Date(contract.endDate!), 'MMM d, yyyy')}
                                </p>
                                {contract.value && (
                                  <p className="text-xs text-gray-500">
                                    {currencySymbol}{contract.value.toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => !open && setConfirmDialog({ ...confirmDialog, open: false })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog({ ...confirmDialog, open: false });
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Reports;