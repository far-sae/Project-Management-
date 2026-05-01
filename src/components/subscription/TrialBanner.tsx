import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/context/SubscriptionContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { Clock, CreditCard, X, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TrialBannerProps {
  onDismiss?: () => void;
  variant?: 'inline' | 'full';
  className?: string;
}

export const TrialBanner: React.FC<TrialBannerProps> = ({
  onDismiss,
  variant = 'inline',
  className,
}) => {
  const { trialInfo, isSubscribed, loading, subscription } = useSubscription();
  const { isAdmin: isOrgAdminOrOwner } = useOrganization();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // ── Guards ────────────────────────────────────────────────
  if (loading || !isVisible) return null;
  if (isSubscribed) return null;  // paid plan
  if (subscription?.status === 'starter') return null;  // already on starter
  if (!subscription) return null;  // no subscription row yet
  if (!trialInfo?.isInTrial && trialInfo?.daysRemaining !== 0) return null;
  if (dismissed) return null;
  // Hide subscription nudges from regular members — only the owner pays for
  // the workspace, so showing them an "Upgrade" CTA is confusing and pushes
  // them toward paying separately.
  if (!isOrgAdminOrOwner && !isAppOwner(user?.userId)) return null;

  const daysRemaining = trialInfo?.daysRemaining ?? 0;
  const isExpired = daysRemaining <= 0;
  const isUrgent = daysRemaining <= 3 && !isExpired;
  const isHealthy = daysRemaining > 7;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  // ── EXPIRED STATE ─────────────────────────────────────────
  if (isExpired) {
    return (
      <div className={cn(
        'relative overflow-hidden bg-gradient-to-r from-gray-700 to-gray-900',
        className
      )}>
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-white shrink-0" />
              <p className="text-white font-medium text-sm">
                Your Advanced trial has ended. You're now on the free Starter plan.
                Upgrade anytime to restore full access.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => navigate('/pricing')}
                className="bg-white text-gray-900 hover:bg-gray-100 font-medium"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Upgrade Now
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8"
                onClick={handleDismiss}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── FULL VARIANT (top banner) ─────────────────────────────
  if (variant === 'full') {
    return (
      <div className={cn(
        'relative overflow-hidden',
        isUrgent
          ? 'bg-gradient-to-r from-red-500 to-orange-500'
          : 'bg-gradient-to-r from-orange-500 to-yellow-500',
        className
      )}>
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-white shrink-0" />
              <p className="text-white font-medium text-sm">
                {isUrgent ? (
                  <>
                    ⚠️ Advanced trial ends in{' '}
                    <strong>{daysRemaining} day{daysRemaining !== 1 ? 's' : ''}</strong>!
                    Upgrade now to keep full access.
                  </>
                ) : (
                  <>
                    🚀 You have{' '}
                    <strong>{daysRemaining} days</strong>{' '}
                    left on your free <strong>Advanced trial</strong>.
                    Upgrade before it ends to keep all features.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => navigate('/pricing')}
                className="bg-white text-orange-600 hover:bg-orange-50 font-medium"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Upgrade Now
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8"
                onClick={handleDismiss}
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── INLINE VARIANT (sidebar / card) ──────────────────────
  return (
    <div className={cn(
      'flex items-center justify-between p-3 rounded-lg gap-2',
      isUrgent
        ? 'bg-red-50 border border-red-200'
        : isHealthy
          ? 'bg-green-50 border border-green-200'
          : 'bg-orange-50 border border-orange-200',
      className
    )}>
      <div className="flex items-center gap-2 min-w-0">
        {isHealthy
          ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          : <Clock className={cn('w-4 h-4 shrink-0', isUrgent ? 'text-red-600' : 'text-orange-600')} />
        }
        <div className="min-w-0">
          <p className={cn(
            'text-sm font-medium truncate',
            isUrgent ? 'text-red-800' : isHealthy ? 'text-green-800' : 'text-orange-800'
          )}>
            {isUrgent ? '⚠️ ' : ''}{daysRemaining} day{daysRemaining !== 1 ? 's' : ''} left
          </p>
          <p className={cn(
            'text-xs truncate',
            isUrgent ? 'text-red-600' : isHealthy ? 'text-green-600' : 'text-orange-600'
          )}>
            Advanced trial
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="link"
          size="sm"
          className={cn(
            'text-xs p-0 h-auto font-medium',
            isUrgent ? 'text-red-600' : 'text-orange-600'
          )}
          onClick={() => navigate('/pricing')}
        >
          Upgrade
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-gray-400 hover:text-gray-600"
          onClick={handleDismiss}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};

export default TrialBanner;
