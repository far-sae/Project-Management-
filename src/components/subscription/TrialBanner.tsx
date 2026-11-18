import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/context/SubscriptionContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { Clock, X, CheckCircle } from 'lucide-react';
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
      <div className={cn('border-b bg-surface-2 text-[13px]', className)}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="font-medium text-foreground">
              Your Advanced trial has ended. You're now on the free Starter plan.
              Upgrade anytime to restore full access.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => navigate('/pricing')}>
              Upgrade Now
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── FULL VARIANT (top banner) ─────────────────────────────
  if (variant === 'full') {
    return (
      <div className={cn('border-b bg-surface-2 text-[13px]', className)}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Clock className={cn('h-4 w-4 shrink-0', isUrgent ? 'text-destructive' : 'text-muted-foreground')} />
            <p className="font-medium text-foreground">
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
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => navigate('/pricing')}>
              Upgrade Now
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
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
        ? 'bg-destructive-soft border border-destructive/30'
        : 'bg-surface-2 border border-border',
      className
    )}>
      <div className="flex items-center gap-2 min-w-0">
        {isHealthy
          ? <CheckCircle className="w-4 h-4 text-success shrink-0" />
          : <Clock className={cn('w-4 h-4 shrink-0', isUrgent ? 'text-destructive' : 'text-muted-foreground')} />
        }
        <div className="min-w-0">
          <p className={cn(
            'text-[13px] font-medium truncate',
            isUrgent ? 'text-destructive-soft-foreground' : 'text-foreground'
          )}>
            {isUrgent ? '⚠️ ' : ''}{daysRemaining} day{daysRemaining !== 1 ? 's' : ''} left
          </p>
          <p className={cn(
            'text-xs truncate',
            isUrgent ? 'text-destructive' : 'text-muted-foreground'
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
            isUrgent ? 'text-destructive' : 'text-foreground'
          )}
          onClick={() => navigate('/pricing')}
        >
          Upgrade
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-muted-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};

export default TrialBanner;
