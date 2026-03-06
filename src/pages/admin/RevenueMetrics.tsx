import React, { useState, useEffect } from 'react';
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

interface RevenueData {
  monthlyRevenue: { month: string; revenue: number; subscriptions: number }[];
  tierBreakdown: { name: string; value: number; color: string }[];
  regionRevenue: { region: string; revenue: number }[];
}

export const RevenueMetrics: React.FC = () => {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulating data fetch - in production this would come from Stripe/Firebase
    const fetchData = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const monthlyRevenue = [
        { month: 'Aug', revenue: 4200, subscriptions: 42 },
        { month: 'Sep', revenue: 5100, subscriptions: 51 },
        { month: 'Oct', revenue: 6300, subscriptions: 63 },
        { month: 'Nov', revenue: 7800, subscriptions: 78 },
        { month: 'Dec', revenue: 8500, subscriptions: 85 },
        { month: 'Jan', revenue: 9200, subscriptions: 92 },
      ];

      const tierBreakdown = [
        { name: 'Premium', value: 45, color: '#f97316' },
        { name: 'Standard', value: 35, color: '#22c55e' },
        { name: 'Economy', value: 20, color: '#3b82f6' },
      ];

      const regionRevenue = [
        { region: 'North America', revenue: 42000 },
        { region: 'Europe', revenue: 28000 },
        { region: 'Asia', revenue: 18000 },
        { region: 'South America', revenue: 8000 },
        { region: 'Other', revenue: 4000 },
      ];

      setData({ monthlyRevenue, tierBreakdown, regionRevenue });
      setLoading(false);
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
  const revenueChange = currentMonth && previousMonth
    ? ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue * 100).toFixed(1)
    : 0;
  const isPositive = Number(revenueChange) >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Monthly Recurring Revenue (MRR)</CardTitle>
          <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>{isPositive ? '+' : ''}{revenueChange}%</span>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data?.monthlyRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip
                formatter={(value, name) => [
                  name === 'revenue' ? `$${value}` : value,
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
                name="Revenue ($)"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by Tier</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data?.tierBreakdown}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}%`}
              >
                {data?.tierBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value}%`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-4">
            {data?.tierBreakdown.map((tier) => (
              <div key={tier.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: tier.color }}
                />
                <span className="text-sm text-gray-600">{tier.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by Region</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data?.regionRevenue} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(value) => `$${value / 1000}k`} />
              <YAxis dataKey="region" type="category" width={100} />
              <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
              <Bar dataKey="revenue" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
                ${currentMonth?.revenue.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-green-600 font-medium">ARR</p>
              <p className="text-2xl font-bold text-green-700">
                ${((currentMonth?.revenue || 0) * 12).toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600 font-medium">Avg. Revenue/User</p>
              <p className="text-2xl font-bold text-blue-700">
                ${currentMonth ? Math.round(currentMonth.revenue / currentMonth.subscriptions) : 0}
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-sm text-purple-600 font-medium">Total Subscribers</p>
              <p className="text-2xl font-bold text-purple-700">
                {currentMonth?.subscriptions || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RevenueMetrics;
