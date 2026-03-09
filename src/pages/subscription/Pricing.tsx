import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { PricingTiers } from '@/components/subscription/PricingTiers';
import { CheckoutForm } from '@/components/subscription/CheckoutForm';
import { SubscriptionTier, BillingCycle } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Shield, Zap, Clock, HeartHandshake, Lock, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/services/supabase/config';
import { toast } from 'sonner';

export const Pricing: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { trialInfo, subscription, pricing, refreshSubscription } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<{
    tier: SubscriptionTier;
    billingCycle: BillingCycle;
  } | null>(null);
  const [verifyingAfterCheckout, setVerifyingAfterCheckout] = useState(false);

  // When user returns from Stripe (success URL), they land here with ?subscription=success&session_id=...
  // CheckoutForm is not mounted (selectedPlan is null), so we must verify and apply subscription here.
  useEffect(() => {
    const success = searchParams.get('subscription');
    const sessionId = searchParams.get('session_id');
    if (success !== 'success' || !sessionId || !user?.userId || verifyingAfterCheckout) return;

    let cancelled = false;
    const verify = async () => {
      setVerifyingAfterCheckout(true);
      const toastId = toast.loading('Applying your subscription...');
      try {
        for (let i = 0; i < 8; i++) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 1500));
          await refreshSubscription();
          const { data } = await supabase
            .from('subscriptions')
            .select('status, plan')
            .eq('user_id', user.userId)
            .maybeSingle();
          if (data?.status === 'active') {
            toast.success(`You're now on ${data.plan === 'basic' ? 'Basic' : data.plan === 'advanced' ? 'Advanced' : data.plan || 'your'} plan.`, { id: toastId });
            setSearchParams({}, { replace: true });
            navigate('/dashboard', { replace: true });
            return;
          }
        }
        toast.success('Subscription confirmed. Refreshing...', { id: toastId });
        setSearchParams({}, { replace: true });
        navigate('/dashboard', { replace: true });
      } catch {
        toast.error('Could not verify subscription. Try refreshing the page.', { id: toastId });
      } finally {
        if (!cancelled) setVerifyingAfterCheckout(false);
      }
    };
    verify();
    return () => { cancelled = true; };
  }, [searchParams, user?.userId, refreshSubscription, navigate, setSearchParams]);

  const handleSelectPlan = (tier: SubscriptionTier, billingCycle: BillingCycle) => {
    setSelectedPlan({ tier, billingCycle });
  };

  const handleCheckoutSuccess = () => {
    setSelectedPlan(null);
    navigate('/dashboard');
  };

  const benefits = [
    {
      icon: Zap,
      title: 'Boost Productivity',
      description: 'Organize tasks efficiently with our intuitive Kanban board',
    },
    {
      icon: Shield,
      title: 'Secure & Reliable',
      description: 'Your data is encrypted and backed up automatically',
    },
    {
      icon: Clock,
      title: 'Save Time',
      description: 'Streamline workflows and reduce time spent on management',
    },
    {
      icon: HeartHandshake,
      title: 'Collaborate Better',
      description: 'Work together seamlessly with your team in real-time',
    },
  ];

  // After Stripe redirect: show verifying state so subscription is applied before dashboard
  if (verifyingAfterCheckout) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center">
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin text-orange-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Applying your subscription</h3>
              <p className="text-sm text-gray-500">You’ll be redirected to the dashboard in a moment.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedPlan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 py-12 px-4">
        <div className="max-w-md mx-auto">
          <Button
            variant="ghost"
            onClick={() => setSelectedPlan(null)}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to plans
          </Button>

          <CheckoutForm
            tier={selectedPlan.tier}
            billingCycle={selectedPlan.billingCycle}
            onSuccess={handleCheckoutSuccess}
            onCancel={() => setSelectedPlan(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate(user ? '/dashboard' : '/')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {user ? 'Back to Dashboard' : 'Back'}
          </Button>

          {trialInfo?.isInTrial && (
            <div className="bg-orange-100 text-orange-800 px-4 py-2 rounded-full text-sm font-medium">
              {trialInfo.daysRemaining} days left in trial
            </div>
          )}
        </div>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Start with a 28-day free trial. No credit card required. After trial, all features are blocked until you subscribe. Payment via Stripe; you’ll get an email confirmation when you buy and when your plan renews (monthly or yearly).
            Cancel anytime.
          </p>
          {(subscription?.tier === 'starter' || subscription?.status === 'expired') && subscription?.tier !== undefined && (
            <p className="text-sm text-orange-600 mt-2 font-medium">
              On Starter or cancelled? You can upgrade or re-subscribe to Basic or Advanced below anytime.
            </p>
          )}
        </div>

        <PricingTiers onSelectPlan={handleSelectPlan} />

        {/* What's included by plan — service summary & locks (Basic vs Advanced) */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
            What's included by plan
          </h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Basic and Advanced plans are locked to the services below. Upgrade to unlock more.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(['starter', 'basic', 'advanced', 'premium'] as const).map((tier) => {
              const tierPricing = pricing.tiers[tier];
              const name = tier === 'starter' ? 'Starter' : tier === 'basic' ? 'Basic' : tier === 'advanced' ? 'Advanced' : 'Premium';
              return (
                <Card key={tier} className="bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{name}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-1.5 text-sm text-gray-600">
                      {tierPricing.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    {tier === 'basic' && (
                      <p className="mt-3 text-xs text-amber-600 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Team, Timeline & Contracts require Advanced or higher
                      </p>
                    )}
                    {tier === 'advanced' && (
                      <p className="mt-3 text-xs text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Includes all Basic services + collaboration & analytics
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">
            Why Choose TaskCalendar?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={index}
                  className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-orange-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{benefit.title}</h3>
                  <p className="text-sm text-gray-600">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-16 bg-white rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Questions? We're here to help.
          </h2>
          <p className="text-gray-600 mb-6">
            Contact our support team for any questions about our plans or features.
          </p>
          <Button variant="outline">Contact Support</Button>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
