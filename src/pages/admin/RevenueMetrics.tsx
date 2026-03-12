import React, { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { DEFAULT_PRICING } from '@/types/subscription';

interface RevenueData {
  monthlyRevenue: { month: string; revenue: number; subscriptions: number }[];
  tierBreakdown: { name: string; value: number; color: string }[];
  usersByCountry: { region: string; users: number }[];
}

const PLAN_COLORS: Record<string, string> = {
  starter: '#94a3b8',
  basic: '#22c55e',
  advanced: '#f97316',
  premium: '#a855f7',
};

const PLAN_MONTHLY: Record<string, number> = {
  starter: 0,
  basic: DEFAULT_PRICING.tiers.basic.monthly,
  advanced: DEFAULT_PRICING.tiers.advanced.monthly,
  premium: DEFAULT_PRICING.tiers.premium.monthly || 0,
};

export const RevenueMetrics: React.FC = () => {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: subs, error: subError } = await supabase
          .from('subscriptions')
          .select('user_id, plan, status, billing_cycle, current_period_start');

        if (subError) throw subError;

        const activePaid = (subs || []).filter(
          s => (s.status === 'active' || s.status === 'starter') && s.plan && s.plan !== 'trial'
        );

        // Tier breakdown (real)
        const tierCounts: Record<string, number> = { starter: 0, basic: 0, advanced: 0, premium: 0 };
        activePaid.forEach(s => {
          const plan = (s.plan || 'starter').toLowerCase();
          tierCounts[plan] = (tierCounts[plan] ?? 0) + 1;
        });
        const tierBreakdown = Object.entries(tierCounts)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value,
            color: PLAN_COLORS[name] || '#94a3b8',
          }));

        // Monthly revenue (estimated from active subs by current_period_start month)
        const monthMap = new Map<string, { revenue: number; count: number }>();
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          d.setDate(1);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString().slice(0, 7);
          monthMap.set(key, { revenue: 0, count: 0 });
        }
        activePaid.forEach(s => {
          const periodStart = s.current_period_start ? new Date(s.current_period_start) : new Date();
          const key = periodStart.toISOString().slice(0, 7);
          const existing = monthMap.get(key);
          if (existing) {
            const plan = (s.plan || 'starter').toLowerCase();
            const monthly = PLAN_MONTHLY[plan] ?? 0;
            const isYearly = (s.billing_cycle || '').toLowerCase() === 'yearly';
            existing.revenue += isYearly ? (monthly * 12) / 12 : monthly;
            existing.count += 1;
          }
        });
        const monthlyRevenue = Array.from(monthMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => ({
            month: new Date(key + '-01').toLocaleDateString('en-US', { month: 'short' }),
            revenue: Math.round(v.revenue * 100) / 100,
            subscriptions: v.count,
          }));

        // Users by country (real - from user_profiles of subscribed users)
        const userIds = activePaid.map(s => s.user_id);
        let usersByCountry: { region: string; users: number }[] = [];
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('id, country')
            .in('id', userIds);
          const countryCounts = new Map<string, number>();
          (profiles || []).forEach(p => {
            const c = (p.country || 'Other').toUpperCase();
            countryCounts.set(c, (countryCounts.get(c) || 0) + 1);
          });
          usersByCountry = Array.from(countryCounts.entries())
            .map(([region, users]) => ({ region, users }))
            .sort((a, b) => b.users - a.users);
        }

        setData({ monthlyRevenue, tierBreakdown, usersByCountry });
      } catch (error) {
        console.error('Revenue fetch error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const currentMonth = data?.monthlyRevenue[data.monthlyRevenue.length - 1];
  const previousMonth = data?.monthlyRevenue[data.monthlyRevenue.length - 2];
  const revenueChange = currentMonth && previousMonth && previousMonth.revenue > 0
    ? ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue * 100).toFixed(1)
    : 0;
  const isPositive = Number(revenueChange) >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Estimated Monthly Recurring Revenue (MRR)</CardTitle>
          {previousMonth && previousMonth.revenue > 0 && (
            <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{isPositive ? '+' : ''}{revenueChange}%</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {data?.monthlyRevenue && data.monthlyRevenue.some(m => m.revenue > 0 || m.subscriptions > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip
                  formatter={(value, name) => [
                    name === 'revenue' ? `${DEFAULT_PRICING.currencySymbol}${value}` : value,
                    name === 'revenue' ? 'Revenue' : 'Subscriptions'
                  ]}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ fill: '#f97316' }}
                  name={`Revenue (${DEFAULT_PRICING.currencySymbol})`}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="subscriptions"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: '#22c55e' }}
                  name="Subscriptions"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 py-12">No subscription revenue data yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscriptions by Plan</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.tierBreakdown && data.tierBreakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={data.tierBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {data.tierBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => value} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-4 flex-wrap">
                {data.tierBreakdown.map((tier) => (
                  <div key={tier.name} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: tier.color }}
                    />
                    <span className="text-sm text-gray-600">{tier.name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-gray-500 py-12">No paid subscriptions yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscribers by Country</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.usersByCountry && data.usersByCountry.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.usersByCountry} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="region" type="category" width={50} />
                <Tooltip />
                <Bar dataKey="users" fill="#f97316" radius={[0, 4, 4, 0]} name="Subscribers" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 py-12">No subscriber country data yet</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Revenue Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-orange-50 rounded-lg">
              <p className="text-sm text-orange-600 font-medium">Current MRR</p>
              <p className="text-2xl font-bold text-orange-700">
                {DEFAULT_PRICING.currencySymbol}{(currentMonth?.revenue ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-green-600 font-medium">ARR</p>
              <p className="text-2xl font-bold text-green-700">
                {DEFAULT_PRICING.currencySymbol}{((currentMonth?.revenue ?? 0) * 12).toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600 font-medium">Avg. Revenue/User</p>
              <p className="text-2xl font-bold text-blue-700">
                {currentMonth && currentMonth.subscriptions > 0
                  ? `${DEFAULT_PRICING.currencySymbol}${Math.round(currentMonth.revenue / currentMonth.subscriptions)}`
                  : '—'}
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-sm text-purple-600 font-medium">Paid Subscribers</p>
              <p className="text-2xl font-bold text-purple-700">
                {currentMonth?.subscriptions ?? 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
