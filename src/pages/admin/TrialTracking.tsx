import React, { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, FunnelChart,
  Funnel, LabelList, Cell,
} from 'recharts';
import { Loader2, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface TrialUser {
  userId: string;
  displayName: string;
  email: string;
  photoURL?: string;
  daysRemaining: number;
}

interface TrialData {
  trialUsers: TrialUser[];
  funnelData: { name: string; value: number; fill: string; }[];
  conversionByDay: { day: number; conversions: number; trials: number; }[];
}

// ── Trial end date helper ─────────────────────────────────
const resolveTrialEndDate = (trialEndDate: unknown): Date => {
  if (trialEndDate instanceof Date) return trialEndDate;
  if (
    trialEndDate &&
    typeof trialEndDate === 'object' &&
    'toDate' in trialEndDate &&
    typeof (trialEndDate as { toDate: unknown; }).toDate === 'function'
  ) {
    return (trialEndDate as { toDate: () => Date; }).toDate();
  }
  // Default: 28 days from now
  return new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
};

const calcDaysRemaining = (endDate: Date): number =>
  Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

export const TrialTracking: React.FC = () => {
  const [data, setData] = useState<TrialData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // ── Fetch trial users from Supabase ─────────────────
        // Replaces the removed Firebase/Firestore dependency
        const { data: subs, error: subError } = await supabase
          .from('subscriptions')
          .select('user_id, trial_end_date')
          .eq('status', 'trial')
          .order('trial_end_date', { ascending: true });

        if (subError) throw subError;

        // Fetch matching user profiles
        const userIds = (subs || []).map(s => s.user_id);
        let trialUsers: TrialUser[] = [];

        if (userIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('user_profiles')
            .select('user_id, display_name, email, photo_url')
            .in('user_id', userIds);

          if (profileError) throw profileError;

          trialUsers = (subs || []).map(sub => {
            const profile = profiles?.find(p => p.user_id === sub.user_id);
            const endDate = resolveTrialEndDate(sub.trial_end_date);
            return {
              userId: sub.user_id,
              displayName: profile?.display_name || 'Unknown',
              email: profile?.email || '',
              photoURL: profile?.photo_url || '',
              daysRemaining: calcDaysRemaining(endDate),
            };
          });
        }

        // Demo funnel data (replace with Stripe in production)
        const funnelData = [
          { name: 'Started Trial', value: 1000, fill: '#3b82f6' },
          { name: 'Active in Trial', value: 750, fill: '#22c55e' },
          { name: 'Reached Day 14', value: 500, fill: '#f97316' },
          { name: 'Converted', value: 350, fill: '#a855f7' },
        ];

        // Demo conversion by day (replace with Stripe in production)
        const conversionByDay = [
          { day: 1, conversions: 5, trials: 100 },
          { day: 4, conversions: 8, trials: 95 },
          { day: 7, conversions: 12, trials: 87 },
          { day: 10, conversions: 15, trials: 75 },
          { day: 14, conversions: 18, trials: 60 },
          { day: 21, conversions: 22, trials: 42 },
          { day: 28, conversions: 35, trials: 20 },
        ];

        setData({ trialUsers, funnelData, conversionByDay });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to load trial data'
        );
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

  const urgentTrials = data?.trialUsers.filter(u => u.daysRemaining <= 2) || [];
  const activeTrials = data?.trialUsers.filter(u => u.daysRemaining > 2) || [];

  const conversionRate = data?.funnelData
    ? Math.round((data.funnelData[3].value / data.funnelData[0].value) * 100)
    : 0;

  const getStatusIcon = (daysRemaining: number) => {
    if (daysRemaining <= 1) return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (daysRemaining <= 3) return <Clock className="w-4 h-4 text-orange-500" />;
    return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Funnel Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Trial Conversion Funnel</span>
            <Badge variant="outline">{conversionRate}% conversion</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <FunnelChart>
              <Tooltip formatter={(value) => value.toLocaleString()} />
              <Funnel data={data?.funnelData} dataKey="value" nameKey="name" isAnimationActive>
                {data?.funnelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
                <LabelList position="center" fill="#fff" stroke="none" dataKey="name" />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Conversion by day */}
      <Card>
        <CardHeader>
          <CardTitle>Conversion by Trial Day</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data?.conversionByDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tickFormatter={(v) => `Day ${v}`} />
              <YAxis />
              <Tooltip labelFormatter={(v) => `Day ${v}`} />
              <Bar dataKey="conversions" fill="#22c55e" name="Conversions" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Urgent trials */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Urgent: Trials Ending Soon ({urgentTrials.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {urgentTrials.length === 0 ? (
            <p className="text-center text-gray-500 py-4">No urgent trials</p>
          ) : (
            <div className="space-y-3">
              {urgentTrials.map((user) => (
                <div key={user.userId} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={user.photoURL} />
                      <AvatarFallback className="bg-red-100 text-red-700">
                        {user.displayName?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-gray-900">{user.displayName}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusIcon(user.daysRemaining)}
                    <Badge variant="destructive">
                      {user.daysRemaining === 0
                        ? 'Expires today'
                        : `${user.daysRemaining} day${user.daysRemaining !== 1 ? 's' : ''} left`}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active trials */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Active Trials ({activeTrials.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {activeTrials.slice(0, 10).map((user) => (
              <div key={user.userId} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors">
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
                <div className="flex items-center gap-4">
                  <div className="w-32">
                    <Progress value={((28 - user.daysRemaining) / 28) * 100} className="h-2" />
                    <p className="text-xs text-gray-500 mt-1 text-right">
                      Day {28 - user.daysRemaining} of 28
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(user.daysRemaining)}
                    <span className="text-sm text-gray-600">{user.daysRemaining} days left</span>
                  </div>
                </div>
              </div>
            ))}
            {activeTrials.length === 0 && (
              <p className="text-center text-gray-500 py-8">No active trials</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TrialTracking;
