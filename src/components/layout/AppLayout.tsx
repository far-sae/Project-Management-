import React, { Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ProjectChromeProvider } from '@/context/ProjectChromeContext';
import { ClockGate } from '@/components/auth/ClockGate';

// Pending-invite escape hatch.
//
// Background: when an invitee signs in via Google, Supabase only honors
// `redirectTo` if the URL is in the project's allow-list. Many deployments
// only whitelist the site root, so the user gets dropped at "/" — or, for
// non-admin members, redirected on to "/tasks" by ProtectedRoute — and
// never reaches AcceptInvite. Their pendingInviteToken sits in localStorage
// untouched, the project they were invited to is invisible (sidebar empty,
// dashboard empty), and the invite quietly never completes.
//
// Fix: every authenticated render checks for a pendingInviteToken in
// storage. If one exists and we're not already on /accept-invite, we hand
// the user back to AcceptInvite so the auto-accept effect can run. The
// token is cleared by AcceptInvite itself on success/decline/expiry, so
// this can't loop.
const usePendingInviteRedirect = (): string | null => {
  const location = useLocation();
  if (typeof window === 'undefined') return null;
  if (location.pathname.startsWith('/accept-invite/')) return null;
  const token =
    sessionStorage.getItem('pendingInviteToken') ||
    localStorage.getItem('pendingInviteToken');
  if (!token) return null;
  return `/accept-invite/${token}`;
};

// Layout route for every authenticated page. The sidebar mounts once here and
// stays mounted across navigation, so projects/subscriptions stay loaded and
// there is no full-screen flash between routes. The page-area Suspense
// fallback is a small inline spinner inside <main>, not a full-viewport one.
//
// ClockGate is mounted once at this layer (instead of inside ProtectedRoute)
// so its `useTimeTracking` query runs a single time per session — putting it
// under ProtectedRoute previously made it remount on every navigation and
// flash a full-screen "Loading your workspace…" spinner between page clicks.
export const AppLayout: React.FC = () => {
  const inviteRedirect = usePendingInviteRedirect();
  if (inviteRedirect) {
    return <Navigate to={inviteRedirect} replace />;
  }

  return (
    <ProjectChromeProvider>
      <ClockGate>
        {/* h-screen + overflow-hidden pins the shell to the viewport so the
            sidebar stays fixed and only the routed content (<main>) scrolls. */}
        <div className="flex h-screen bg-background pt-12 md:pt-0 overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-w-0 h-full overflow-y-auto">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
        </div>
      </ClockGate>
    </ProjectChromeProvider>
  );
};

export default AppLayout;
