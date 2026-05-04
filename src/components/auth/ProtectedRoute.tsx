import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { Loader2 } from 'lucide-react';

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
  // Only block on auth — subscription/org load in the background to avoid
  // full-page unmount/remount flashes on every state transition.
  if (authLoading) {
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
  // Don't redirect while subscription is still loading — avoids flash to /pricing
  if (requireSubscription && !canAccessFeatures && !subLoading && !orgLoading) {
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

  // The clock-in gate used to wrap children here, but ProtectedRoute is the
  // per-route `element` so it (and the gate) re-mounted on every navigation.
  // That made `useTimeTracking()` re-fetch and flash the full-screen
  // "Loading your workspace…" spinner each time the user clicked a sidebar
  // link. The gate is now hoisted into AppLayout so it mounts once for the
  // whole authenticated session.
  return <>{children}</>;
};

export default ProtectedRoute;
