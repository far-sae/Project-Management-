import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Handshake, TrendingUp, CheckCircle2, XCircle, Users,
  Building2, Trophy, DollarSign, Loader2,
} from 'lucide-react';
import {
  useCrmDeals, useCrmDealStages, useCrmContacts, useCrmCompanies, useCrmActivities,
} from '@/hooks/useCrmHub';
import type { CrmDeal } from '@/types/crmHub';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtCurrency = (n: number) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(n);
  } catch { return `$${Math.round(n)}`; }
};

const STAGE_PIE_COLORS = ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#64748b'];

interface KpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  hint?: string;
}

const Kpi: React.FC<KpiProps> = ({ label, value, icon: Icon, tint, hint }) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1 truncate">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </CardContent>
  </Card>
);

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'short', year: '2-digit' });
};

export const CrmReportsPage: React.FC = () => {
  const { items: deals, loading: dealsLoading } = useCrmDeals();
  const { items: stages, loading: stagesLoading } = useCrmDealStages();
  const { items: contacts } = useCrmContacts();
  const { items: companies } = useCrmCompanies();
  const { items: activities } = useCrmActivities(50);

  const loading = dealsLoading || stagesLoading;

  const openDeals = useMemo(() => deals.filter((d) => d.status === 'open'), [deals]);
  const wonDeals = useMemo(() => deals.filter((d) => d.status === 'won'), [deals]);
  const lostDeals = useMemo(() => deals.filter((d) => d.status === 'lost'), [deals]);

  const openValue = openDeals.reduce((s, d) => s + d.value, 0);
  const wonValue = wonDeals.reduce((s, d) => s + d.value, 0);
  const weightedPipeline = openDeals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
  const winRate = (wonDeals.length + lostDeals.length) > 0
    ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100)
    : 0;

  const dealsByStage = useMemo(() => {
    return stages.map((s, i) => {
      const stageDeals = deals.filter((d) => d.stageId === s.id);
      return {
        name: s.name,
        count: stageDeals.length,
        value: stageDeals.reduce((sum, d) => sum + d.value, 0),
        fill: STAGE_PIE_COLORS[i % STAGE_PIE_COLORS.length],
      };
    });
  }, [deals, stages]);

  const wonByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of wonDeals) {
      const k = monthKey(d.updatedAt);
      map.set(k, (map.get(k) ?? 0) + d.value);
    }
    // Ensure the current + prior 5 months are always shown, even if empty.
    const now = new Date();
    const rows: { month: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(dt);
      rows.push({ month: key, label: monthLabel(key), value: map.get(key) ?? 0 });
    }
    return rows;
  }, [wonDeals]);

  const topDeals = useMemo(
    () => [...openDeals].sort((a, b) => b.value - a.value).slice(0, 5),
    [openDeals],
  );

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const recentActivity = activities.slice(0, 6);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pipeline health, revenue trends, and what's changing across the CRM.
          </p>
        </div>

        {/* KPI ROW */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Open pipeline" value={fmtCurrency(openValue)} icon={Handshake} tint="bg-primary/10 text-primary" hint={`${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'}`} />
          <Kpi label="Weighted pipeline" value={fmtCurrency(weightedPipeline)} icon={TrendingUp} tint="bg-blue-500/10 text-blue-500" hint="value × probability" />
          <Kpi label="Won revenue" value={fmtCurrency(wonValue)} icon={Trophy} tint="bg-emerald-500/10 text-emerald-500" hint={`${wonDeals.length} won deal${wonDeals.length === 1 ? '' : 's'}`} />
          <Kpi label="Win rate" value={`${winRate}%`} icon={CheckCircle2} tint="bg-amber-500/10 text-amber-500" hint={`vs ${lostDeals.length} lost`} />
        </div>

        {/* Secondary counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Contacts" value={String(contacts.length)} icon={Users} tint="bg-slate-500/10 text-slate-500" />
          <Kpi label="Companies" value={String(companies.length)} icon={Building2} tint="bg-slate-500/10 text-slate-500" />
          <Kpi label="Deals lost" value={String(lostDeals.length)} icon={XCircle} tint="bg-destructive/10 text-destructive" />
          <Kpi label="Avg deal size" value={fmtCurrency(openDeals.length ? openValue / openDeals.length : 0)} icon={DollarSign} tint="bg-slate-500/10 text-slate-500" />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pipeline by stage</CardTitle>
            </CardHeader>
            <CardContent>
              {dealsByStage.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No stages yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dealsByStage} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number, name: string) => name === 'value' ? fmtCurrency(v) : v}
                      labelStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="count" name="Deals" radius={[4, 4, 0, 0]}>
                      {dealsByStage.map((s, i) => (
                        <Cell key={i} fill={s.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pipeline value split</CardTitle>
            </CardHeader>
            <CardContent>
              {dealsByStage.every((s) => s.value === 0) ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  Nothing to plot yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={dealsByStage.filter((s) => s.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={80}
                      innerRadius={40}
                      paddingAngle={2}
                    >
                      {dealsByStage.map((s, i) => (
                        <Cell key={i} fill={s.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Won revenue (last 6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={wonByMonth} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
                <Tooltip formatter={(v: number) => fmtCurrency(v)} labelStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#f97316' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top open deals + recent activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Top open deals</CardTitle>
            </CardHeader>
            <CardContent>
              {topDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No open deals.</p>
              ) : (
                <div className="space-y-2">
                  {topDeals.map((d: CrmDeal) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted/40">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {stageById.get(d.stageId)?.name ?? '—'} · {d.probability}%
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-primary shrink-0">
                        {fmtCurrency(d.value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Nothing recent.</p>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/40">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm capitalize">
                          {a.type.replace(/_/g, ' ')}
                        </div>
                        {a.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{a.description}</div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {a.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
};

export default CrmReportsPage;
