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
  DollarSign, FileText, RefreshCw, AlertTriangle, AlertCircle, X,
  Sparkles, Brain, ShieldAlert, Lightbulb, MessageSquare, Send, Trophy,
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
import { removeOrganizationMember } from '@/services/supabase/organizations';
import { DEFAULT_COLUMNS } from '@/types';
import { getOrganizationContracts, Contract } from '@/services/supabase/contracts';
import { format } from 'date-fns';
import { getWorkspaceDisplayName } from '@/lib/workspaceDisplay';
import {
  generateReportInsights,
  answerReportQuestion,
  isAIEnabled,
  type ReportMetricsSnapshot,
  type ReportInsightsResponse,
  type AIError,
} from '@/services/ai';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';

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
  const { organization, refreshOrganization, isAdmin } = useOrganization();
  const { hasFeature } = useSubscription();

  const { workspaces, DEFAULT_WORKSPACE_ID: RAW_DEFAULT_WS_ID } = useWorkspaces();
  const DEFAULT_WORKSPACE_ID = RAW_DEFAULT_WS_ID || '__default__';

  // Tab state
  const [activeTab, setActiveTab] = useState<'projects' | 'business'>('projects');
  const [reportWorkspaceId, setReportWorkspaceId] = useState<string>(ALL_WORKSPACES_ID);
  // Filters tasks/contracts by their creation date. AI snapshot windows
  // (7d/14d) keep their absolute meaning — they're computed off `now`, not
  // off this filter — so insights still show "what happened in the last 7
  // days" even when the user is looking at a custom range above.
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);

  // Business reports state
  const [businessContracts, setBusinessContracts] = useState<Contract[]>([]);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('ALL'); // 'ALL' or specific currency

  // Remove member dialog state
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; displayName: string } | null>(null);
  const [removeMemberLoading, setRemoveMemberLoading] = useState(false);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => { } });

  // AI insights state
  const aiAvailable = isAIEnabled();
  const [aiInsights, setAiInsights] = useState<ReportInsightsResponse | null>(null);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiInsightsError, setAiInsightsError] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiAskLoading, setAiAskLoading] = useState(false);
  const [aiAskError, setAiAskError] = useState<string | null>(null);

  const orgId = organization?.organizationId || user?.organizationId || (user ? `local-${user.userId}` : '');

  // Refresh organization (members, etc.) on mount and when tab becomes visible so report shows current users
  useEffect(() => {
    refreshOrganization();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshOrganization({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshOrganization is stable enough; we want one subscription
  }, []);

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
    () =>
      tasks
        .filter((t) => filteredProjectIds.has(t.projectId))
        .filter((t) => inRange(new Date(t.createdAt), dateRange)),
    [tasks, filteredProjectIds, dateRange]
  );

  /** Per-project task counts within the same dateRange + workspace as `filteredTasks`. */
  const projectTaskStatsInRange = useMemo(() => {
    const map = new Map<string, { totalTasks: number; completedTasks: number }>();
    for (const t of filteredTasks) {
      const cur = map.get(t.projectId) ?? { totalTasks: 0, completedTasks: 0 };
      cur.totalTasks += 1;
      if (t.status === 'done') cur.completedTasks += 1;
      map.set(t.projectId, cur);
    }
    return map;
  }, [filteredTasks]);
  const totalProjects = filteredProjects.length;
  const totalTasks = filteredTasks.length;
  const completedTasks = filteredTasks.filter((t) => t.status === 'done').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

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
      withDefault.unshift({
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: 'Unassigned projects',
        organizationId: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return withDefault.map((ws) => {
      const wsProjects = projects.filter(
        (p) => (p as { workspaceId?: string; }).workspaceId === ws.workspaceId ||
          (!(p as { workspaceId?: string; }).workspaceId && ws.workspaceId === DEFAULT_WORKSPACE_ID)
      );
      const wsProjectIds = new Set(wsProjects.map((p) => p.projectId));
      const wsTasks = tasks
        .filter((t) => wsProjectIds.has(t.projectId))
        .filter((t) => inRange(new Date(t.createdAt), dateRange));
      return {
        workspaceId: ws.workspaceId,
        name: getWorkspaceDisplayName(ws),
        projectCount: wsProjects.length,
        taskCount: wsTasks.length,
        completedCount: wsTasks.filter((t) => t.status === 'done').length,
      };
    });
  }, [workspaces, projects, tasks, dateRange, DEFAULT_WORKSPACE_ID]);

  // Recent tasks
  const recentTasks = useMemo(
    () => [...filteredTasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 8),
    [filteredTasks]
  );

  /** Aggregated snapshot for the AI insight call. Recomputes when filters change. */
  const aiSnapshot = useMemo<ReportMetricsSnapshot>(() => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    const overdueTasks = filteredTasks.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() < now && t.status !== 'done',
    ).length;

    const stalledTasks = filteredTasks.filter(
      (t) => t.status !== 'done' && now - new Date(t.updatedAt).getTime() > fourteenDaysMs,
    ).length;

    const unassignedTasks = filteredTasks.filter(
      (t) => !t.assignees || t.assignees.length === 0,
    ).length;

    const highPriorityOpen = filteredTasks.filter(
      (t) => t.priority === 'high' && t.status !== 'done',
    ).length;

    const recentlyCompleted7d = filteredTasks.filter(
      (t) => t.status === 'done' && now - new Date(t.updatedAt).getTime() <= sevenDaysMs,
    ).length;

    const recentlyCreated7d = filteredTasks.filter(
      (t) => now - new Date(t.createdAt).getTime() <= sevenDaysMs,
    ).length;

    const byStatus: Record<string, number> = {};
    for (const t of filteredTasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }

    const byPriority = { high: 0, medium: 0, low: 0 } as { high: number; medium: number; low: number };
    for (const t of filteredTasks) {
      if (t.priority === 'high') byPriority.high++;
      else if (t.priority === 'low') byPriority.low++;
      else byPriority.medium++;
    }

    const topAssignees = [...tasksByUser]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((u) => ({ name: u.displayName, total: u.count, done: u.done }));

    const topProjects = filteredProjects
      .map((p) => {
        const scoped = projectTaskStatsInRange.get(p.projectId) ?? {
          totalTasks: 0,
          completedTasks: 0,
        };
        const total = scoped.totalTasks;
        const done = scoped.completedTasks;
        return {
          name: p.name,
          total,
          done,
          rate: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const workspaceLabel =
      reportWorkspaceId === ALL_WORKSPACES_ID
        ? 'All workspaces'
        : workspaces.find((w) => w.workspaceId === reportWorkspaceId)?.name || 'Workspace';

    return {
      workspaceLabel,
      totalProjects,
      totalTasks,
      completedTasks,
      completionRate,
      overdueTasks,
      stalledTasks,
      unassignedTasks,
      highPriorityOpen,
      timeLoggedMinutes,
      recentlyCompleted7d,
      recentlyCreated7d,
      byStatus,
      byPriority,
      topAssignees,
      topProjects,
    };
  }, [
    filteredTasks,
    filteredProjects,
    projectTaskStatsInRange,
    tasksByUser,
    totalProjects,
    totalTasks,
    completedTasks,
    completionRate,
    timeLoggedMinutes,
    reportWorkspaceId,
    workspaces,
  ]);

  const handleGenerateAiInsights = async () => {
    if (!user) return;
    setAiInsightsLoading(true);
    setAiInsightsError(null);
    try {
      const insights = await generateReportInsights(user.userId, aiSnapshot);
      setAiInsights(insights);
    } catch (err) {
      const aiErr = err as AIError;
      setAiInsightsError(aiErr.message || 'Failed to generate insights.');
    } finally {
      setAiInsightsLoading(false);
    }
  };

  const handleAskAi = async () => {
    if (!user || !aiQuestion.trim()) return;
    setAiAskLoading(true);
    setAiAskError(null);
    setAiAnswer(null);
    try {
      const answer = await answerReportQuestion(user.userId, aiSnapshot, aiQuestion);
      setAiAnswer(answer);
    } catch (err) {
      const aiErr = err as AIError;
      setAiAskError(aiErr.message || 'Could not answer that.');
    } finally {
      setAiAskLoading(false);
    }
  };

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
      <div className="flex h-screen bg-background pt-12 md:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Reports</h1>
            <p className="text-muted-foreground">Productivity insights and analytics</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-border rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Reports & Analytics</h2>
            <p className="text-muted-foreground mb-2 max-w-md">
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
    <div className="flex h-screen bg-background pt-12 md:pt-0">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Reports</h1>
            <p className="text-muted-foreground">
              {activeTab === 'projects'
                ? 'Productivity insights – task overview, workload, time tracking, and workspace dashboard'
                : 'Business metrics – contracts, values, and client insights'}
            </p>
          </div>

          {/* Workspace + date filters (only for projects tab) */}
          {activeTab === 'projects' && (
            <div className="flex items-center gap-2 flex-wrap">
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
              <span className="text-sm font-medium text-foreground">Workspace</span>
              <Select value={reportWorkspaceId} onValueChange={setReportWorkspaceId}>
                <SelectTrigger className="w-[220px] bg-background">
                  <SelectValue placeholder="All workspaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_WORKSPACES_ID}>All workspaces</SelectItem>
                  {workspaceListForSelect.map((w) => (
                    <SelectItem key={w.workspaceId} value={w.workspaceId}>
                      {getWorkspaceDisplayName(w)}
                    </SelectItem>
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
                : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              Project Analytics
            </button>
            <button
              onClick={() => setActiveTab('business')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${activeTab === 'business'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              Business Reports
            </button>
            <button
              onClick={() => navigate('/workload')}
              className="px-4 py-2 font-medium text-sm border-b-2 transition-colors border-transparent text-muted-foreground hover:text-foreground"
            >
              Workload →
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
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
                      <BarChart3 className="w-4 h-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalProjects}</div>
                      <p className="text-xs text-muted-foreground">{reportWorkspaceId === ALL_WORKSPACES_ID ? 'Active projects' : 'In selected workspace'}</p>
                    </CardContent>
                  </Card>
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Total Tasks</CardTitle>
                      <Clock className="w-4 h-4 text-orange-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{totalTasks}</div>
                      <p className="text-xs text-muted-foreground">{reportWorkspaceId === ALL_WORKSPACES_ID ? 'Across all projects' : 'In selected workspace'}</p>
                    </CardContent>
                  </Card>
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{completedTasks}</div>
                      <p className="text-xs text-muted-foreground">Tasks completed</p>
                    </CardContent>
                  </Card>
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">Completion Rate</CardTitle>
                      <TrendingUp className="w-4 h-4 text-purple-500" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{completionRate}%</div>
                      <p className="text-xs text-muted-foreground">Overall progress</p>
                    </CardContent>
                  </Card>
                </div>

                {/* AI Insights */}
                <Card className="mb-6 border bg-gradient-to-br from-violet-500/[0.06] via-card to-orange-500/[0.04] border-violet-500/30 shadow-md overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/30 text-violet-500 flex items-center justify-center">
                          <Brain className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-base">AI Insights</CardTitle>
                            <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-300 bg-violet-500/10 text-[10px] uppercase tracking-wider">
                              Beta
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            Executive summary, risks, and recommendations from your live metrics.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {aiInsights && (
                          <span className="text-[11px] text-muted-foreground hidden md:inline">
                            Generated {format(new Date(aiInsights.generatedAt), 'MMM d, p')}
                          </span>
                        )}
                        <Button
                          size="sm"
                          disabled={!aiAvailable || aiInsightsLoading || totalTasks === 0}
                          onClick={handleGenerateAiInsights}
                          className="bg-gradient-to-r from-violet-500 to-orange-500 text-white border-0 hover:opacity-90"
                        >
                          {aiInsightsLoading ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Analyzing…
                            </>
                          ) : aiInsights ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                              Regenerate
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                              Generate insights
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!aiAvailable && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>AI not configured</AlertTitle>
                        <AlertDescription>
                          Deploy the <code className="text-xs">ai-chat</code> Supabase Edge
                          Function and set <code className="text-xs">OPENAI_API_KEY</code> to
                          unlock AI insights.
                        </AlertDescription>
                      </Alert>
                    )}
                    {aiInsightsError && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Couldn't generate insights</AlertTitle>
                        <AlertDescription>{aiInsightsError}</AlertDescription>
                      </Alert>
                    )}
                    {!aiInsights && !aiInsightsLoading && !aiInsightsError && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[
                          { icon: Trophy, label: 'Wins', desc: 'What\'s working well right now' },
                          { icon: ShieldAlert, label: 'Risks', desc: 'Overdue, stalled, or unassigned' },
                          { icon: Lightbulb, label: 'Actions', desc: 'Concrete next steps for the team' },
                        ].map(({ icon: Icon, label, desc }) => (
                          <div
                            key={label}
                            className="rounded-lg border border-border/60 bg-card/60 p-3 flex items-start gap-2.5"
                          >
                            <Icon className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {aiInsightsLoading && (
                      <div className="space-y-3">
                        <div className="h-3 rounded bg-muted/70 animate-pulse w-3/4" />
                        <div className="h-3 rounded bg-muted/70 animate-pulse w-2/3" />
                        <div className="h-3 rounded bg-muted/70 animate-pulse w-5/6" />
                      </div>
                    )}
                    {aiInsights && (
                      <>
                        <div className="rounded-lg border border-border/60 bg-card/70 p-4">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                            Executive summary
                          </p>
                          <p className="text-sm leading-relaxed">{aiInsights.summary}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {aiInsights.highlights.map((h, idx) => {
                            const tone =
                              h.type === 'win'
                                ? { Icon: Trophy, ring: 'ring-emerald-500/30', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' }
                                : h.type === 'risk'
                                  ? { Icon: ShieldAlert, ring: 'ring-red-500/30', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10' }
                                  : h.type === 'forecast'
                                    ? { Icon: TrendingUp, ring: 'ring-blue-500/30', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' }
                                    : { Icon: Lightbulb, ring: 'ring-amber-500/30', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' };
                            const Icon = tone.Icon;
                            return (
                              <div
                                key={`${h.title}-${idx}`}
                                className={`rounded-lg border border-border/60 bg-card p-3 flex gap-2.5 ring-1 ${tone.ring}`}
                              >
                                <div className={`w-8 h-8 rounded-lg ${tone.bg} ${tone.text} flex items-center justify-center shrink-0`}>
                                  <Icon className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold leading-snug">{h.title}</p>
                                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{h.detail}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {aiInsights.forecast && (
                          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex gap-2.5">
                            <TrendingUp className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-300 mb-0.5">
                                Forecast
                              </p>
                              <p className="text-sm leading-relaxed">{aiInsights.forecast}</p>
                            </div>
                          </div>
                        )}
                        {aiInsights.recommendations.length > 0 && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                              Recommended next steps
                            </p>
                            <ol className="space-y-1.5">
                              {aiInsights.recommendations.map((rec, idx) => (
                                <li
                                  key={`${idx}-${rec.slice(0, 12)}`}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300 text-[11px] font-semibold shrink-0">
                                    {idx + 1}
                                  </span>
                                  <span className="leading-relaxed">{rec}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </>
                    )}

                    {/* Ask AI follow-up */}
                    <div className="pt-3 border-t border-border/60">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <MessageSquare className="w-3 h-3" />
                        Ask anything about your data
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          value={aiQuestion}
                          placeholder="e.g. Which person has the most overdue work?"
                          onChange={(e) => setAiQuestion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !aiAskLoading) {
                              e.preventDefault();
                              void handleAskAi();
                            }
                          }}
                          disabled={!aiAvailable || aiAskLoading}
                          className="flex-1"
                        />
                        <Button
                          size="default"
                          onClick={() => void handleAskAi()}
                          disabled={!aiAvailable || aiAskLoading || !aiQuestion.trim()}
                          variant="outline"
                        >
                          {aiAskLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Send className="w-3.5 h-3.5 mr-1.5" />
                              Ask
                            </>
                          )}
                        </Button>
                      </div>
                      {aiAskError && (
                        <p className="text-xs text-destructive mt-2">{aiAskError}</p>
                      )}
                      {aiAnswer && (
                        <div className="mt-3 rounded-lg border border-border/60 bg-card p-3">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                            Answer
                          </p>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiAnswer}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Time Tracking Card */}
                <Card className="mb-6 border border-border shadow-md bg-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Timer className="w-5 h-5 text-orange-500" />
                      <CardTitle>Time tracking</CardTitle>
                    </div>
                    <p className="text-sm text-muted-foreground">Time logged in comments</p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <div className="text-3xl font-bold text-foreground">
                        {Math.floor(timeLoggedMinutes / 60)}h {timeLoggedMinutes % 60}m
                      </div>
                      <p className="text-sm text-muted-foreground">total from your comments</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Task Overview and User Workload */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <LayoutDashboard className="w-5 h-5 text-orange-500" />
                        <CardTitle>Task overview</CardTitle>
                      </div>
                      <p className="text-sm text-muted-foreground">Recent activity</p>
                    </CardHeader>
                    <CardContent>
                      {recentTasks.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No tasks yet</p>
                      ) : (
                        <ul className="space-y-2">
                          {recentTasks.map((t) => (
                            <li
                              key={t.taskId}
                              onClick={() => navigate(`/project/${t.projectId}`)}
                              className="flex items-center justify-between p-3 rounded-lg cursor-pointer hover:bg-muted/50 border border-transparent hover:border-border"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground truncate">{t.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t.assignees?.length ? t.assignees.map((a) => a.displayName).join(', ') : 'Unassigned'} · {statusLabels[t.status] || t.status}
                                </p>
                              </div>
                              <div className="w-2 h-2 rounded-full shrink-0 ml-2" style={{ backgroundColor: DEFAULT_COLUMNS.find((c) => c.id === t.status)?.color || '#9E9E9E' }} />
                              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-500" />
                        <CardTitle>Tasks by user</CardTitle>
                      </div>
                      <p className="text-sm text-muted-foreground">Workload per assignee</p>
                    </CardHeader>
                    <CardContent>
                      {tasksByUser.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">No assigned tasks</p>
                      ) : (
                        <div className="space-y-3">
                          {tasksByUser.map(({ userId, displayName, count, done }) => {
                            const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                            const donePct = count > 0 ? Math.round((done / count) * 100) : 0;
                            return (
                              <div key={userId} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted/80 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium text-sm shrink-0">
                                    {displayName.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-medium text-foreground truncate">{displayName}</p>
                                    <p className="text-xs text-muted-foreground">{count} tasks · {donePct}% done</p>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="font-semibold text-foreground">{count}</span>
                                  <span className="text-xs text-muted-foreground ml-1">({pct}%)</span>
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
                <Card className="mb-6 border border-border shadow-md bg-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-5 h-5 text-purple-500" />
                      <CardTitle>Workspace dashboard</CardTitle>
                    </div>
                    <p className="text-sm text-muted-foreground">Projects and tasks per workspace</p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {workspaceStats.map((ws) => {
                        const rate = ws.taskCount > 0 ? Math.round((ws.completedCount / ws.taskCount) * 100) : 0;
                        return (
                          <div key={ws.workspaceId} onClick={() => navigate('/dashboard')} className="p-4 rounded-xl border border-border hover:border-orange-500/50 hover:bg-orange-500/10 cursor-pointer transition-all">
                            <div className="flex items-center gap-2 mb-2">
                              <FolderKanban className="w-4 h-4 text-purple-500" />
                              <span className="font-medium text-foreground">{ws.name}</span>
                            </div>
                            <div className="flex gap-4 text-sm">
                              <span className="text-muted-foreground">{ws.projectCount} projects</span>
                              <span className="text-muted-foreground">{ws.taskCount} tasks</span>
                            </div>
                            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-purple-500 to-orange-500 rounded-full" style={{ width: `${rate}%` }} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{rate}% complete</p>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Organization Members */}
                {organization?.members && organization.members.length > 0 && (
                  <Card className="mb-6 border border-border shadow-md bg-card">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-green-500" />
                        <CardTitle>Users</CardTitle>
                      </div>
                      <p className="text-sm text-muted-foreground">Organization members</p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-3">
                        {Array.from(
                          new Map(
                            organization.members.map((m: { userId: string; displayName?: string; email?: string; role?: string; }) => [m.userId, m])
                          ).values()
                        )
                          // Hide stale members that have no workload, but always keep the owner visible
                          .filter((m: { userId: string; }) => {
                            const workload = tasksByUser.find((w) => w.userId === m.userId);
                            const count = workload?.count ?? 0;
                            return count > 0 || m.userId === organization.ownerId;
                          })
                          .map((m: { userId: string; displayName?: string; email?: string; role?: string; }) => {
                          const workload = tasksByUser.find((w) => w.userId === m.userId);
                          return (
                            <div key={m.userId} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
                              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium text-sm">
                                {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-foreground text-sm">{m.displayName || m.email || 'Unknown'}</p>
                                <p className="text-xs text-muted-foreground">{workload?.count ?? 0} tasks · {m.role || 'member'}</p>
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
                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader>
                      <CardTitle>Project progress</CardTitle>
                      <p className="text-sm text-muted-foreground">Completion by project</p>
                    </CardHeader>
                    <CardContent>
                      {filteredProjects.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                          <p>{reportWorkspaceId === ALL_WORKSPACES_ID ? 'No projects to display' : 'No projects in this workspace'}</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {filteredProjects.map((project) => {
                            const scoped = projectTaskStatsInRange.get(project.projectId) ?? {
                              totalTasks: 0,
                              completedTasks: 0,
                            };
                            const progress = scoped.totalTasks > 0
                              ? Math.round((scoped.completedTasks / scoped.totalTasks) * 100) : 0;
                            return (
                              <div key={project.projectId} onClick={() => navigate(`/project/${project.projectId}`)} className="cursor-pointer hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-medium">{project.name}</span>
                                  <span className="text-sm text-muted-foreground">{progress}%</span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{scoped.completedTasks} of {scoped.totalTasks} tasks completed</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border border-border shadow-md bg-card">
                    <CardHeader>
                      <CardTitle>Team members</CardTitle>
                      <p className="text-sm text-muted-foreground">Organization members</p>
                    </CardHeader>
                    <CardContent>
                      {!organization?.members || organization.members.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                          <p>No team members yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {Array.from(
                            new Map(
                              organization.members.map((m: { userId: string; displayName?: string; email?: string; role?: string; }) => [m.userId, m])
                            ).values()
                          )
                            .filter((m: { userId: string }) => {
                              const workload = tasksByUser.find((w) => w.userId === m.userId);
                              const count = workload?.count ?? 0;
                              return count > 0 || m.userId === organization.ownerId;
                            })
                            .map((m: { userId: string; displayName?: string; email?: string; role?: string; }) => {
                            const workload = tasksByUser.find((w) => w.userId === m.userId);
                            const count = workload?.count ?? 0;
                            const isOwner = m.userId === organization.ownerId;
                            const displayName = m.displayName || m.email || 'Unknown';
                            return (
                              <div
                                key={m.userId}
                                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                              >
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => navigate('/team')}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/team'); } }}
                                  className="flex flex-1 items-center gap-3 cursor-pointer min-w-0"
                                >
                                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium text-sm shrink-0">
                                    {(m.displayName || m.email || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="font-medium">{displayName}</span>
                                    {isOwner && <span className="ml-2 text-xs text-orange-600 font-medium">Owner</span>}
                                    <p className="text-xs text-muted-foreground">{m.role || 'member'}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="font-medium">{count}</span>
                                  <span className="text-xs text-muted-foreground">tasks</span>
                                  {isAdmin && !isOwner ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setMemberToRemove({ userId: m.userId, displayName }); }}
                                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                                      aria-label={`Remove ${displayName} from organization`}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
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
              <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
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
                    <p className="text-sm text-muted-foreground">
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
                          <p className="text-sm text-muted-foreground">Total Contracts</p>
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
                          <p className="text-sm text-muted-foreground">Total Value</p>
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
                          <p className="text-sm text-muted-foreground">Average Value</p>
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
                          <p className="text-sm text-muted-foreground">Active Contracts</p>
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
                              <span className="text-sm text-muted-foreground">
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
                          <div key={client.name} className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                            <div>
                              <p className="font-medium">{client.name}</p>
                              <p className="text-sm text-muted-foreground">{client.count} contracts</p>
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
                            <div key={contract.contractId} className="flex items-center justify-between p-2 bg-card rounded border border-yellow-200/50">
                              <div>
                                <p className="font-medium">{contract.title}</p>
                                <p className="text-sm text-muted-foreground">{contract.client}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-yellow-700">
                                  {format(new Date(contract.endDate!), 'MMM d, yyyy')}
                                </p>
                                {contract.value && (
                                  <p className="text-xs text-muted-foreground">
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

      {/* Remove Member Dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{memberToRemove?.displayName}</strong> from the organization? They will lose access to all projects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMemberLoading} onClick={() => setMemberToRemove(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMemberLoading}
              onClick={async () => {
                if (!memberToRemove || !organization?.organizationId) return;
                setRemoveMemberLoading(true);
                try {
                  await removeOrganizationMember(organization.organizationId, memberToRemove.userId);
                  await refreshOrganization();
                  toast.success(`${memberToRemove.displayName} has been removed from the organization`);
                  setMemberToRemove(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to remove member');
                } finally {
                  setRemoveMemberLoading(false);
                }
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              {removeMemberLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Reports;