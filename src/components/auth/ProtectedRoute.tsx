import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { Loader2 } from 'lucide-react';
import { ClockGate } from './ClockGate';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSubscription?: boolean;
  requireAdmin?: boolean;
  /** Restrict to organization owner + admin (not regular members). */
  requireOrgAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireSubscription = false,
  requireAdmin = false,
  requireOrgAdmin = false,
}) => {
  const { user, loading: authLoading } = useAuth();
  const { canAccessFeatures, loading: subLoading } = useSubscription();
  const { isAdmin: isOrgAdminOrOwner, loading: orgLoading } = useOrganization();
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

  // ── Org-admin required (Dashboard / HR / Payroll / Time / Expenses /
  //    Reports / Contracts / Team / Files / Comments / Inbox) ─────────
  // Do not render the route (or ClockGate) until org role is known — otherwise
  // restricted UI can flash before we redirect members to /tasks.
  if (requireOrgAdmin && orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500 mx-auto" />
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  // Wait for org info before deciding so we don't redirect during the
  // initial fetch race. Members land on /tasks (their personal home).
  if (requireOrgAdmin && !isOrgAdminOrOwner && !isAppOwner(user.userId)) {
    return <Navigate to="/tasks" replace />;
  }

  // ── Clock-in gate ──────────────────────────────────
  return <ClockGate>{children}</ClockGate>;
};

export default ProtectedRoute;
