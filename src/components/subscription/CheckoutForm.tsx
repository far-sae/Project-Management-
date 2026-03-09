import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SubscriptionTier, BillingCycle } from '@/types/subscription';
import { supabase } from '@/services/supabase/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CreditCard, Shield, Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface CheckoutFormProps {
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const CheckoutForm: React.FC<CheckoutFormProps> = ({
  tier, billingCycle, onSuccess, onCancel,
}) => {
  const { user } = useAuth();
  const { pricing, subscription, refreshSubscription } = useSubscription();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSubscription, setCheckingSubscription] = useState(false);

  // Check for successful subscription return
  useEffect(() => {
    const subscriptionSuccess = searchParams.get('subscription');
    const sessionId = searchParams.get('session_id');

    if (subscriptionSuccess === 'success' && sessionId) {
      handleSubscriptionSuccess();
    }
  }, [searchParams]);

  const handleSubscriptionSuccess = async () => {
    setCheckingSubscription(true);
    const toastId = toast.loading('Verifying your subscription...');

    try {
      // Poll up to 5 times, 2 seconds apart
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await refreshSubscription();

        // ✅ Read directly from Supabase, not stale state
        const { data } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', user?.userId)
          .maybeSingle();

        if (data?.status === 'active') {
          toast.success('Subscription activated successfully!', { id: toastId });
          navigate('/dashboard', { replace: true });
          onSuccess?.();
          return;
        }
      }

      // After 5 attempts still not active
      toast.error('Verification taking longer than expected. Check your email.', { id: toastId });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error('Failed to verify subscription.', { id: toastId });
    } finally {
      setCheckingSubscription(false);
    }
  };

  const tierPricing = pricing.tiers[tier];

  const tierNames: Record<SubscriptionTier, string> = {
    starter: 'Starter', basic: 'Basic', advanced: 'Advanced', premium: 'Premium',
  };

  const showPromo = billingCycle === 'monthly' && tierPricing.monthlyPromo !== null;
  const displayPrice = billingCycle === 'yearly' && tierPricing.yearly !== null
    ? tierPricing.yearly
    : showPromo ? tierPricing.monthlyPromo : tierPricing.monthly;
  const originalPrice = showPromo ? tierPricing.monthly : null;

  // ── Subscription tier guard ────────────────────────────────
  const TIER_RANK: Record<SubscriptionTier, number> = { starter: 0, basic: 1, advanced: 2, premium: 3 };
  const currentTier = subscription?.tier as SubscriptionTier | undefined;
  const isActiveSub = subscription?.status === 'active';
  const isSameTier = isActiveSub && currentTier === tier;
  const isDowngrade = isActiveSub && currentTier && TIER_RANK[currentTier] > TIER_RANK[tier];
  const isBlocked = isSameTier || isDowngrade;

  const blockReason = isSameTier
    ? `You're already on the ${tierNames[tier]} plan.`
    : isDowngrade
      ? `You're currently on ${tierNames[currentTier!]}. To downgrade, cancel your plan first in Settings.`
      : null;

  const getPriceId = (): string | null => {
    if (billingCycle === 'yearly') return tierPricing.stripePriceIdYearly ?? null;
    if (showPromo && tierPricing.stripePriceIdMonthlyPromo) return tierPricing.stripePriceIdMonthlyPromo;
    return tierPricing.stripePriceIdMonthly || null;
  };

  const handleCheckout = async () => {
    if (!user) { setError('Please sign in to continue'); return; }
    if (isBlocked) { toast.error(blockReason!); return; }

    const priceId = getPriceId();
    if (!priceId) {
      setError('This plan is not available for online checkout. Please contact support.');
      return;
    }

    setLoading(true);
    setError(null);
    const toastId = toast.loading('Redirecting to Stripe...');

    try {
      const origin = window.location.origin;

      // Refresh session so the Edge Function gets a valid JWT (avoids 401)
      await supabase.auth.refreshSession();
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

      const { data, error: fnError } = await supabase.functions.invoke(
        'create-checkout-session',
        {
          body: {
            priceId,
            tier,
            billingCycle,
            userId: user.userId,
            userEmail: user.email,
            // Add success URL with session_id parameter
            successUrl: `${origin}/pricing?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${origin}/pricing`,
          },
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      if (fnError) throw new Error(fnError.message);
      if (!data?.url) throw new Error('No checkout URL returned');

      toast.dismiss(toastId);
      window.location.href = data.url;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // If checking subscription after successful payment
  if (checkingSubscription) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Verifying Your Subscription
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Please wait while we confirm your payment with Stripe...
            </p>
            <Button
              variant="outline"
              onClick={() => navigate('/dashboard')}
              className="mt-2"
            >
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }


  if (tier === 'starter') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6 text-center py-8">
          <p className="text-gray-600">Starter is a free plan — no payment required.</p>
          <Button className="mt-4" onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (tier === 'premium') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6 text-center py-8">
          <p className="text-gray-600 mb-4">Premium is a custom enterprise plan.</p>
          <Button
            className="bg-gradient-to-r from-orange-500 to-red-500"
            onClick={() => window.location.href = 'mailto:support@yourdomain.com'}
          >
            Contact Sales
          </Button>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Complete Your Purchase
        </CardTitle>
        <CardDescription>Subscribe to {tierNames[tier]} plan</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Inline error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Tier block warning */}
        {blockReason && (
          <Alert variant="destructive">
            <AlertDescription>{blockReason}</AlertDescription>
          </Alert>
        )}

        {/* Price summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex justify-between items-center mb-1">
            <span className="font-medium">{tierNames[tier]} Plan</span>
            <div className="flex items-center gap-2">
              {originalPrice && (
                <span className="text-sm text-gray-400 line-through">
                  {pricing.currencySymbol}{originalPrice}
                </span>
              )}
              <span className="text-lg font-bold">
                {pricing.currencySymbol}{displayPrice}
              </span>
            </div>
          </div>
          {showPromo && (
            <p className="text-xs text-green-600 font-medium">
              🎉 Promo: {tierPricing.promoMonths} month{tierPricing.promoMonths > 1 ? 's' : ''} offer
            </p>
          )}
          <p className="text-sm text-gray-500">
            Billed {billingCycle === 'monthly' ? 'monthly' : 'annually'}
          </p>
        </div>

        {/* Features */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">What's included:</h4>
          <ul className="space-y-1">
            {tierPricing.features.slice(0, 5).map((feature, index) => (
              <li key={index} className="flex items-center gap-2 text-sm text-gray-600">
                <Check className="w-4 h-4 text-green-500 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Shield className="w-4 h-4" />
          <span>Secure payment powered by Stripe</span>
        </div>

        <p className="text-xs text-gray-500">
          Confirmation sent to <strong>{user?.email}</strong>.{' '}
          Auto-renews {billingCycle === 'monthly' ? 'monthly' : 'yearly'} — cancel anytime in Settings.
        </p>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button
          className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
          onClick={handleCheckout}
          disabled={loading || isBlocked}
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
          ) : isBlocked ? (
            isSameTier ? 'Current Plan' : 'Downgrade Not Available'
          ) : (
            <><CreditCard className="w-4 h-4 mr-2" />Start Subscription</>
          )}
        </Button>

        {!isBlocked && (
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              await refreshSubscription();
              toast.success('Subscription status refreshed');
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Status
          </Button>
        )}

        {onCancel && (
          <Button variant="ghost" className="w-full" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
        )}

        <p className="text-xs text-center text-gray-400">
          By subscribing, you agree to our Terms of Service. Cancel anytime.
        </p>
      </CardFooter>
    </Card>
  );
};

export default CheckoutForm;