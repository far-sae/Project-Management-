import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  TrendingUp, Target, Trophy, Percent,
} from 'lucide-react';
import { useDeals } from '@/hooks/useDeals';
import { formatDealMoney } from '@/services/supabase/deals';

const Stat: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon: React.ElementType;
  tone?: 'default' | 'primary' | 'success';
}> = ({ label, value, hint, icon: Icon, tone = 'default' }) => (
  <Card>
    <CardContent className="pt-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <p className="text-[11px] uppercase tracking-wider">{label}</p>
      </div>
      <p
        className={
          tone === 'primary'
            ? 'mt-1 text-xl font-bold text-primary'
            : tone === 'success'
              ? 'mt-1 text-xl font-bold text-emerald-600 dark:text-emerald-400'
              : 'mt-1 text-xl font-bold text-foreground'
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </CardContent>
  </Card>
);

/** Strip of KPI cards summarizing the sales pipeline. Sits at the top of the
 *  Pipeline tab so reps see the high-level numbers without leaving the page. */
export const PipelineAnalyticsCard: React.FC<{ currency?: string }> = ({
  currency,
}) => {
  const { analytics, deals } = useDeals();
  // Pick the most-used currency in the pipeline if not overridden, so totals
  // make sense for orgs that primarily price in EUR/INR/etc.
  const dominantCurrency =
    currency ??
    (deals.length > 0 ? deals[0].currency : 'USD');
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat
        label="Open pipeline"
        value={formatDealMoney(analytics.openValue, dominantCurrency)}
        hint={`Weighted: ${formatDealMoney(analytics.weightedOpenValue, dominantCurrency)}`}
        icon={Target}
        tone="primary"
      />
      <Stat
        label="Won this month"
        value={formatDealMoney(analytics.wonThisMonth, dominantCurrency)}
        hint={`${analytics.wonCount} won total`}
        icon={Trophy}
        tone="success"
      />
      <Stat
        label="Avg deal size"
        value={formatDealMoney(analytics.averageDealSize, dominantCurrency)}
        hint="across closed-won"
        icon={TrendingUp}
      />
      <Stat
        label="Win rate"
        value={`${Math.round(analytics.winRate * 100)}%`}
        hint={`${analytics.wonCount} won · ${analytics.lostCount} lost`}
        icon={Percent}
      />
    </div>
  );
};

export default PipelineAnalyticsCard;
