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
  conversionByDay: { day: string; count: number; }[];
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
          .select('user_id, trial_ends_at')
          .eq('status', 'trial')
          .order('trial_ends_at', { ascending: true });

        if (subError) throw subError;

        // Fetch matching user profiles
        const userIds = (subs || []).map(s => s.user_id);
        let trialUsers: TrialUser[] = [];

        if (userIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('user_profiles')
            .select('id, display_name, email, photo_url')
            .in('id', userIds);

          if (profileError) throw profileError;

          trialUsers = (subs || []).map(sub => {
            const profile = profiles?.find(p => p.id === sub.user_id);
            const endDate = resolveTrialEndDate(sub.trial_ends_at);
            return {
              userId: sub.user_id,
              displayName: profile?.display_name || 'Unknown',
              email: profile?.email || '',
              photoURL: profile?.photo_url || '',
              daysRemaining: calcDaysRemaining(endDate),
            };
          });
        }

        // Real funnel: Active Trials, Trials Ending Soon (≤7 days), Converted (active paid)
        const { count: activePaidCount } = await supabase
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .neq('plan', 'trial');
        const trialsEndingSoon = trialUsers.filter(u => u.daysRemaining <= 7).length;
        const funnelData = [
          { name: 'Active in Trial', value: trialUsers.length, fill: '#3b82f6' },
          { name: 'Ending in 7 days', value: trialsEndingSoon, fill: '#f97316' },
          { name: 'Converted (paid)', value: activePaidCount ?? 0, fill: '#22c55e' },
        ].filter(d => d.value > 0);

        // Real: trials by days-remaining bucket (0-7, 8-14, 15-21, 22-28)
        const buckets = [
          { range: '0-7 days', min: 0, max: 7 },
          { range: '8-14 days', min: 8, max: 14 },
          { range: '15-21 days', min: 15, max: 21 },
          { range: '22-28 days', min: 22, max: 28 },
        ];
        const conversionByDay = buckets.map(b => ({
          day: b.range,
          count: trialUsers.filter(u => u.daysRemaining >= b.min && u.daysRemaining <= b.max).length,
        }));

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

  const conversionRate = data?.funnelData && data.funnelData.length >= 2
    ? (data.funnelData[0].value > 0
        ? Math.round((data.funnelData[data.funnelData.length - 1].value / data.funnelData[0].value) * 100)
        : 0)
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
            {conversionRate > 0 && (
              <Badge variant="outline">{conversionRate}% conversion</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.funnelData && data.funnelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <FunnelChart>
                <Tooltip formatter={(value) => value.toLocaleString()} />
                <Funnel data={data.funnelData} dataKey="value" nameKey="name" isAnimationActive>
                  {data.funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                  <LabelList position="center" fill="#fff" stroke="none" dataKey="name" />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 py-12">No trial data yet</p>
          )}
        </CardContent>
      </Card>

      {/* Trials by days remaining */}
      <Card>
        <CardHeader>
          <CardTitle>Trials by Days Remaining</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.conversionByDay && data.conversionByDay.some(d => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.conversionByDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" name="Trials" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-500 py-12">No trial data yet</p>
          )}
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
