import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { useSubscription } from '@/context/SubscriptionContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSubscription?: boolean;
  requireAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireSubscription = false,
  requireAdmin = false,
}) => {
  const { user, loading: authLoading } = useAuth();
  const { canAccessFeatures, loading: subLoading } = useSubscription();
  const location = useLocation();

  // ── Loading state ──────────────────────────────────
  if (authLoading || subLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto" />
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Not authenticated ──────────────────────────────
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ── Admin required ─────────────────────────────────
  const canAccessAdmin = user.role === 'admin' || isAppOwner(user.userId);
  if (requireAdmin && !canAccessAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // ── Subscription required ──────────────────────────
  if (requireSubscription && !canAccessFeatures && !subLoading) {
    return <Navigate to="/pricing" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
