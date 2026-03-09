import React, { useState } from 'react';
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

const OWNER_EMAIL = 'smtkur31@gmail.com';

export const PricingTiers: React.FC<PricingTiersProps> = ({ onSelectPlan, loading }) => {
  const { pricing, subscription, refreshSubscription } = useSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [starterLoading, setStarterLoading] = useState(false);

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
      window.location.href = `mailto:${OWNER_EMAIL}?subject=Premium Plan Enquiry&body=Hi, I would like to discuss the Premium plan for my team.`;
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

      {/* Billing toggle — hide for starter/premium */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <Label className={cn(billingCycle === 'monthly' && 'font-semibold')}>Monthly</Label>
        <Switch
          checked={billingCycle === 'yearly'}
          onCheckedChange={(c) => setBillingCycle(c ? 'yearly' : 'monthly')}
        />
        <Label className={cn(billingCycle === 'yearly' && 'font-semibold')}>
          Yearly
          <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
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
                'relative flex flex-col transition-shadow hover:shadow-lg',
                config.isPopular && 'border-orange-500 border-2 shadow-lg',
                isStarter && 'border-gray-200 bg-gray-50',
                isCurrentPlan && 'ring-2 ring-green-400',
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
                  isStarter ? 'bg-gray-100' : config.isPopular ? 'bg-orange-100' : 'bg-blue-50'
                )}>
                  <Icon className={cn(
                    'w-5 h-5',
                    isStarter ? 'text-gray-500' : config.isPopular ? 'text-orange-600' : 'text-blue-600'
                  )} />
                </div>
                <CardTitle className="text-xl">{config.name}</CardTitle>
                <CardDescription className="text-xs">{config.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 text-center px-4">
                {/* Price */}
                <div className="mb-3">
                  {isStarter ? (
                    <div className="text-4xl font-bold text-gray-700">
                      Free
                      <p className="text-sm font-normal text-gray-400 mt-1">forever</p>
                    </div>
                  ) : isPremium ? (
                    <div className="text-3xl font-bold text-gray-700">
                      Custom
                      <p className="text-sm font-normal text-gray-400 mt-1">contact us</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-center gap-2">
                        {originalPrice && (
                          <span className="text-lg text-gray-400 line-through">
                            {pricing.currencySymbol}{originalPrice}
                          </span>
                        )}
                        <span className="text-4xl font-bold">
                          {pricing.currencySymbol}{displayPrice}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        /{billingCycle === 'yearly' ? 'year' : 'month'}
                      </p>
                    </>
                  )}
                </div>

                {/* Promo badge */}
                {showPromo && (
                  <Badge className="mb-3 bg-green-100 text-green-800 hover:bg-green-100 text-xs">
                    🎉 {tier === 'basic' ? 'First 3 months offer' : 'First month offer'}
                  </Badge>
                )}

                {/* Extra member note for Advanced */}
                {tier === 'advanced' && tierPricing.extraUserPrice && (
                  <p className="text-xs text-orange-600 font-medium mb-2">
                    +{pricing.currencySymbol}{tierPricing.extraUserPrice}/member beyond 10
                  </p>
                )}

                {/* Features */}
                <ul className="space-y-2 text-left mt-4">
                  {tierPricing.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className={cn(
                        'w-4 h-4 flex-shrink-0 mt-0.5',
                        isStarter ? 'text-gray-400' : 'text-green-500'
                      )} />
                      <span className={cn(
                        'text-sm',
                        isStarter ? 'text-gray-400' : 'text-gray-600'
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
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : config.isPopular
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white'
                        : isPremium
                          ? 'bg-gray-900 hover:bg-gray-700 text-white'
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
                  <p className="text-xs text-center text-gray-400">
                    Email us at{' '}
                    <a href={`mailto:${OWNER_EMAIL}`} className="text-orange-500 underline">
                      {OWNER_EMAIL}
                    </a>
                  </p>
                )}

                {/* Advanced upsell hint */}
                {tier === 'advanced' && (
                  <p className="text-xs text-center text-gray-400">
                    Need more than 10 members?{' '}
                    <button
                      className="text-orange-500 underline"
                      onClick={() => window.location.href = `mailto:${OWNER_EMAIL}?subject=Premium Plan Enquiry`}
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

      <p className="text-center text-sm text-gray-500 mt-8">
        🎁 <strong>28-day free trial</strong> for all new users. No credit card required.
        After 28 days, you'll automatically move to the free Starter plan if you don't subscribe. Upgrade to Basic or Advanced anytime.
      </p>
    </div>
  );
};

export default PricingTiers;
