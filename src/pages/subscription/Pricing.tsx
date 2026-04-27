import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { PricingTiers } from '@/components/subscription/PricingTiers';
import { CheckoutForm } from '@/components/subscription/CheckoutForm';
import { SubscriptionTier, BillingCycle } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Shield, Zap, Clock, HeartHandshake, Loader2 } from 'lucide-react';
import { supabase } from '@/services/supabase/config';
import { toast } from 'sonner';
import { SUPPORT_EMAIL } from '@/lib/support-email';

export const Pricing: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { trialInfo, subscription, refreshSubscription } = useSubscription();
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md mx-auto border-border">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Applying your subscription</h3>
              <p className="text-sm text-muted-foreground">You’ll be redirected to the dashboard in a moment.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedPlan) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
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
    <div className="min-h-screen bg-background text-foreground">
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
            <div className="bg-primary/15 text-primary border border-primary/20 px-4 py-2 rounded-full text-sm font-medium">
              {trialInfo.daysRemaining} days left in trial
            </div>
          )}
        </div>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start with a 28-day free trial (no credit card required). After 28 days, if you don&apos;t subscribe, you&apos;ll automatically move to the free Starter plan. Use the monthly/yearly switch above the plans to see prices for each billing period. Basic and Advanced are paid through Stripe; you&apos;ll get an email when you buy and when your plan renews. Cancel anytime.
            {(subscription?.tier === 'starter' || subscription?.status === 'expired') && subscription?.tier !== undefined && (
              <span className="block text-sm text-primary font-medium mt-3">
                On Starter or cancelled? Upgrade or re-subscribe to Basic or Advanced below anytime.
              </span>
            )}
          </p>
        </div>

        <PricingTiers onSelectPlan={handleSelectPlan} />

        <div className="mt-16">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">
            Why Choose TaskCalendar?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={index}
                  className="bg-card text-card-foreground border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-16 bg-card border border-border rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Questions? We&apos;re here to help.
          </h2>
          <p className="text-muted-foreground mb-6">
            Contact our support team for any questions about our plans or features.
          </p>
          <Button variant="outline" asChild>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=TaskCalendar%20—%20Plan%20question`}>
              Contact Support
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
