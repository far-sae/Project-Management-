import React, { useState, useEffect } from 'react';
import { useSubscription } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';
import { SubscriptionTier, BillingCycle } from '@/types/subscription';
import { supabase } from '@/services/supabase/config';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2, Star, Zap, Mail, Users, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SUPPORT_EMAIL } from '@/lib/support-email';

interface PricingTiersProps {
  onSelectPlan?: (tier: SubscriptionTier, billingCycle: BillingCycle) => void;
  loading?: boolean;
}

const TIER_CONFIG = {
  starter: { name: 'Starter', description: 'Free forever, limited features', isPopular: false, icon: Gift },
  basic: { name: 'Basic', description: 'For students & individuals', isPopular: false, icon: Zap },
  advanced: { name: 'Advanced', description: 'For growing teams up to 10', isPopular: true, icon: Users },
  premium: { name: 'Premium', description: 'For large teams & enterprises', isPopular: false, icon: Star },
};

export const PricingTiers: React.FC<PricingTiersProps> = ({ onSelectPlan, loading }) => {
  const { pricing, subscription, refreshSubscription } = useSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [starterLoading, setStarterLoading] = useState(false);

  // Match toggle to the user’s current paid billing cycle so prices match their subscription
  useEffect(() => {
    if (subscription?.status === 'active' && subscription.billingCycle) {
      setBillingCycle(subscription.billingCycle);
    }
  }, [subscription?.status, subscription?.billingCycle]);

  const tiers: SubscriptionTier[] = ['starter', 'basic', 'advanced', 'premium'];

  // ── Assign Starter directly in DB (no Stripe) ──
  const handleStarterSelect = async () => {
    if (!user?.userId) return;
    setStarterLoading(true);
    try {
      const { error } = await supabase
        .from('subscriptions')
        .upsert({
          user_id: user.userId,
          status: 'starter',
          plan: 'starter',
          billing_cycle: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;
      await refreshSubscription();
      toast.success('You are now on the free Starter plan!');
      navigate('/dashboard');
    } catch (err) {
      toast.error('Failed to activate Starter plan. Please try again.');
    } finally {
      setStarterLoading(false);
    }
  };

  const handleSelectPlan = (tier: SubscriptionTier) => {
    if (tier === 'premium') {
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Premium Plan Enquiry&body=Hi, I would like to discuss the Premium plan for my team.`;
      return;
    }
    if (tier === 'starter') {
      handleStarterSelect();
      return;
    }
    setSelectedTier(tier);
    onSelectPlan?.(tier, billingCycle);
  };

  return (
    <div className="w-full max-w-6xl mx-auto">

      <div
        className="flex items-center justify-center gap-3 mb-8 text-foreground"
        role="group"
        aria-label="Billing period"
      >
        <Label className={cn('cursor-pointer', billingCycle === 'monthly' && 'font-semibold text-foreground')}>
          Monthly
        </Label>
        <Switch
          checked={billingCycle === 'yearly'}
          onCheckedChange={(c) => setBillingCycle(c ? 'yearly' : 'monthly')}
          aria-label="Toggle between monthly and yearly billing"
        />
        <Label className={cn('cursor-pointer', billingCycle === 'yearly' && 'font-semibold text-foreground')}>
          Yearly
          <span className="ml-2 text-xs bg-green-500/15 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-full">
            Save ~2 months
          </span>
        </Label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiers.map((tier) => {
          const config = TIER_CONFIG[tier];
          const tierPricing = pricing.tiers[tier];
          const isCurrentPlan = subscription?.tier === tier && subscription?.status === 'active'
            || (tier === 'starter' && subscription?.status === 'starter');
          const isSelected = selectedTier === tier && loading;
          const isPremium = tier === 'premium';
          const isStarter = tier === 'starter';

          const showPromo = !isStarter && !isPremium && billingCycle === 'monthly' && tierPricing.monthlyPromo !== null;
          const displayPrice = isPremium || isStarter
            ? null
            : billingCycle === 'yearly'
              ? tierPricing.yearly
              : showPromo
                ? tierPricing.monthlyPromo
                : tierPricing.monthly;

          const originalPrice = showPromo ? tierPricing.monthly : null;
          const Icon = config.icon;

          return (
            <Card
              key={tier}
              className={cn(
                'relative flex flex-col transition-shadow hover:shadow-lg bg-card text-card-foreground',
                config.isPopular && 'border-orange-500 border-2 dark:border-orange-500 shadow-lg',
                isStarter && 'border-border bg-muted/40 dark:bg-muted/20',
                !isStarter && !config.isPopular && 'dark:border-border/80',
                isCurrentPlan && 'ring-2 ring-green-500/70 dark:ring-green-500/50',
              )}
            >
              {/* Popular badge */}
              {config.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                    <Star className="w-3 h-3" /> Most Popular
                  </span>
                </div>
              )}

              {/* Current plan badge */}
              {isCurrentPlan && (
                <div className="absolute -top-3 right-3 z-10">
                  <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    ✓ Current
                  </span>
                </div>
              )}

              <CardHeader className="text-center pb-2">
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-2',
                  isStarter
                    ? 'bg-muted'
                    : config.isPopular
                      ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                      : 'bg-primary/10 text-primary'
                )}>
                  <Icon className={cn(
                    'w-5 h-5',
                    isStarter && 'text-muted-foreground',
                  )} />
                </div>
                <CardTitle className="text-xl">{config.name}</CardTitle>
                <CardDescription className="text-xs">{config.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 text-center px-4">
                {/* Price */}
                <div className="mb-3">
                  {isStarter ? (
                    <div className="text-4xl font-bold text-foreground">
                      Free
                      <p className="text-sm font-normal text-muted-foreground mt-1">forever</p>
                    </div>
                  ) : isPremium ? (
                    <div className="text-3xl font-bold text-foreground">
                      Custom
                      <p className="text-sm font-normal text-muted-foreground mt-1">contact us</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-center gap-2">
                        {originalPrice && (
                          <span className="text-lg text-muted-foreground line-through">
                            {pricing.currencySymbol}{originalPrice}
                          </span>
                        )}
                        <span className="text-4xl font-bold text-foreground" aria-live="polite">
                          {pricing.currencySymbol}{displayPrice}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {billingCycle === 'yearly' ? 'per year' : 'per month'}
                      </p>
                    </>
                  )}
                </div>

                {/* Promo badge */}
                {showPromo && (
                  <Badge className="mb-3 bg-green-500/15 text-green-800 dark:text-green-200 hover:bg-green-500/20 border border-green-500/20 text-xs">
                    🎉 {tier === 'basic' ? 'First 3 months offer' : 'First month offer'}
                  </Badge>
                )}

                {tier === 'advanced' && tierPricing.extraUserPrice && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 font-medium mb-2">
                    +{pricing.currencySymbol}{tierPricing.extraUserPrice}/member per month beyond 10
                    {billingCycle === 'yearly' && ' (seats add-on)'}
                  </p>
                )}

                {/* Features */}
                <ul className="space-y-2 text-left mt-4">
                  {tierPricing.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className={cn(
                        'w-4 h-4 flex-shrink-0 mt-0.5',
                        isStarter ? 'text-muted-foreground' : 'text-green-600 dark:text-green-500'
                      )} />
                      <span className={cn(
                        'text-sm',
                        isStarter ? 'text-muted-foreground' : 'text-foreground/90'
                      )}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="flex flex-col gap-2 pt-4 px-4">
                <Button
                  className={cn(
                    'w-full',
                    isStarter
                      ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      : config.isPopular
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-primary-foreground'
                        : isPremium
                          ? 'bg-foreground text-background hover:bg-foreground/90'
                          : ''
                  )}
                  variant={config.isPopular || isPremium || isStarter ? 'default' : 'outline'}
                  onClick={() => handleSelectPlan(tier)}
                  disabled={isCurrentPlan || (loading && !isPremium && !isStarter) || starterLoading}
                >
                  {isStarter && starterLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Activating...</>
                  ) : isSelected ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                  ) : isCurrentPlan ? (
                    '✓ Current Plan'
                  ) : isStarter ? (
                    'Use Free Plan'
                  ) : isPremium ? (
                    <><Mail className="w-4 h-4 mr-2" />Talk to Us</>
                  ) : (
                    'Get Started'
                  )}
                </Button>

                {/* Premium contact hint */}
                {isPremium && (
                  <p className="text-xs text-center text-muted-foreground">
                    Email us at{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
                      {SUPPORT_EMAIL}
                    </a>
                  </p>
                )}

                {tier === 'advanced' && (
                  <p className="text-xs text-center text-muted-foreground">
                    Need more than 10 members?{' '}
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => { window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Premium Plan Enquiry`; }}
                    >
                      Upgrade to Premium
                    </button>
                  </p>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto">
        🎁 <strong className="text-foreground">28-day free trial</strong> for all new users. No credit card required.
        After 28 days, you&apos;ll automatically move to the free Starter plan if you don&apos;t subscribe. Subscribe in monthly or
        yearly billing using the toggle above; upgrade to Basic or Advanced anytime.
      </p>
    </div>
  );
};

export default PricingTiers;
