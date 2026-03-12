import React, { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { User } from '@/types';
import { toast } from 'sonner';

interface UserData {
  users: User[];
  chartData: { date: string; users: number; active: number; }[];
}

export const UserAnalytics: React.FC = () => {
  const [data, setData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch users from Supabase instead of Firebase
        const { data: supabaseUsers, error } = await supabase
          .from('user_profiles')
          .select('*')
          .limit(10)
          .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch subscriptions for status badges
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('user_id, status');
        const subByUser = new Map((subs || []).map(s => [s.user_id, s]));

        const users = (supabaseUsers || []).map((user) => ({
          userId: user.id,
          displayName: user.display_name || user.full_name || 'User',
          email: user.email || '',
          photoURL: user.photo_url || user.avatar_url,
          country: user.country || 'US',
          subscription: subByUser.get(user.id) ? { status: subByUser.get(user.id)!.status } : { status: 'trial' },
        })) as unknown as User[];

        // Real chart data: new users and active (updated_at) per day for last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);
        const { data: allRecent } = await supabase
          .from('user_profiles')
          .select('created_at, updated_at')
          .or(`created_at.gte.${sevenDaysAgo.toISOString()},updated_at.gte.${sevenDaysAgo.toISOString()}`);

        const chartData: { date: string; users: number; active: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(0, 0, 0, 0);
          const next = new Date(d);
          next.setDate(next.getDate() + 1);
          const dayStart = d.toISOString();
          const dayEnd = next.toISOString();
          const newUsers = (allRecent || []).filter(
            u => new Date(u.created_at) >= d && new Date(u.created_at) < next
          ).length;
          const active = (allRecent || []).filter(
            u => u.updated_at && new Date(u.updated_at) >= d && new Date(u.updated_at) < next
          ).length;
          chartData.push({
            date: d.toLocaleDateString('en-US', { weekday: 'short' }),
            users: newUsers,
            active,
          });
        }

        setData({ users, chartData });
      } catch (error) {
        console.error('Error fetching user analytics:', error);
        toast.error('Failed to fetch analytics data');
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

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; }> = {
      trial: { label: 'Trial', variant: 'secondary' },
      active: { label: 'Active', variant: 'default' },
      cancelled: { label: 'Cancelled', variant: 'destructive' },
      expired: { label: 'Expired', variant: 'outline' },
    };
    const config = statusConfig[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>User Growth</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data?.chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="users"
                stackId="1"
                stroke="#f97316"
                fill="#fed7aa"
                name="New Users"
              />
              <Area
                type="monotone"
                dataKey="active"
                stackId="2"
                stroke="#22c55e"
                fill="#bbf7d0"
                name="Active Users"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.users.map((user) => (
              <div
                key={user.userId}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={user.photoURL} />
                    <AvatarFallback className="bg-orange-100 text-orange-700">
                      {user.displayName?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-gray-900">{user.displayName}</p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{user.country}</span>
                  {getStatusBadge(user.subscription?.status || 'trial')}
                </div>
              </div>
            ))}

            {(!data?.users || data.users.length === 0) && (
              <p className="text-center text-gray-500 py-8">No users found</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Daily Active Users</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data?.chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="active"
                stroke="#f97316"
                strokeWidth={2}
                dot={{ fill: '#f97316' }}
                name="Active Users"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserAnalytics;
