import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import {
  Users2, Building2, Briefcase, Trophy, AlertOctagon, BarChart3, CalendarClock,
  Activity as ActivityIcon, Loader2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  useCrmContacts, useCrmCompanies, useCrmDeals, useCrmDealStages,
  useCrmTasks, useCrmActivities,
} from '@/hooks/useCrmHub';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { useCrmCurrency } from '@/context/CrmCurrencyContext';

interface KpiProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
}

const Kpi: React.FC<KpiProps> = ({ label, value, icon: Icon, to }) => (
  <Link to={to} className="group block">
    <Card className="transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-black">{value}</p>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  </Link>
);

export const CrmDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: deals, loading: dealsLoading } = useCrmDeals();
  const { items: stages, loading: stagesLoading } = useCrmDealStages();
  const { items: tasks } = useCrmTasks();
  const { items: activities } = useCrmActivities(10);
  const { format: fmtCurrency } = useCrmCurrency();

  const loading = dealsLoading || stagesLoading;

  const open = useMemo(() => deals.filter((d) => d.status === 'open'), [deals]);
  const won = useMemo(() => deals.filter((d) => d.status === 'won'), [deals]);
  const lost = useMemo(() => deals.filter((d) => d.status === 'lost'), [deals]);

  const pipelineValue = open.reduce((s, d) => s + d.value, 0);
  const forecast = open.reduce((s, d) => s + (d.value * d.probability) / 100, 0);

  const now = new Date();
  const overdueTasks = tasks.filter((t) => t.status !== 'completed' && t.dueDate && t.dueDate < now);
  const upcomingTasks = tasks
    .filter((t) => t.status !== 'completed' && t.dueDate && t.dueDate >= now)
    .slice(0, 5);

  const stageChart = useMemo(() => {
    return stages.map((s) => {
      const list = deals.filter((d) => d.stageId === s.id);
      return {
        stage: s.name,
        value: list.reduce((sum, d) => sum + d.value, 0),
        count: list.length,
      };
    });
  }, [deals, stages]);

  const revenueChart = useMemo(() => {
    const months: { month: string; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      months.push({ month: d.toLocaleString(undefined, { month: 'short' }), revenue: 0 });
    }
    won.forEach((d) => {
      const date = d.expectedCloseDate ? new Date(d.expectedCloseDate) : d.updatedAt;
      const label = date.toLocaleString(undefined, { month: 'short' });
      const item = months.find((m) => m.month === label);
      if (item) item.revenue += d.value;
    });
    return months;
  }, [won]);

  const firstName = user?.displayName?.split(' ')[0];

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const kpis: (KpiProps & { hint?: string })[] = [
    { label: 'Contacts', value: contacts.length, icon: Users2, to: '/crm/contacts' },
    { label: 'Companies', value: companies.length, icon: Building2, to: '/crm/companies' },
    { label: 'Open deals', value: open.length, icon: Briefcase, to: '/crm/deals' },
    { label: 'Won deals', value: won.length, icon: Trophy, to: '/crm/deals' },
    { label: 'Lost deals', value: lost.length, icon: AlertOctagon, to: '/crm/deals' },
    { label: 'Pipeline value', value: fmtCurrency(pipelineValue), icon: BarChart3, to: '/crm/deals' },
    { label: 'Forecast', value: fmtCurrency(forecast), icon: BarChart3, to: '/crm/reports' },
    { label: 'Overdue tasks', value: overdueTasks.length, icon: CalendarClock, to: '/crm/tasks' },
  ];

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening in your pipeline today.
          </p>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {kpis.map((k) => (
            <Kpi key={k.label} label={k.label} value={k.value} icon={k.icon} to={k.to} />
          ))}
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deals by stage</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {stageChart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  No stages yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stageChart} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
                    <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {stageChart.map((_, i) => (
                        <Cell key={i} fill="hsl(var(--primary))" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Monthly revenue (Won)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled — enjoy the calm.</p>
              ) : upcomingTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {t.dueDate?.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize shrink-0">{t.priority}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : activities.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <ActivityIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate capitalize">{a.description ?? a.type.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
};

export default CrmDashboardPage;
