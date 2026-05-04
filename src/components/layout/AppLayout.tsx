import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ProjectChromeProvider } from '@/context/ProjectChromeContext';
import { ClockGate } from '@/components/auth/ClockGate';

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
  return (
    <ProjectChromeProvider>
      <ClockGate>
        <div className="flex h-screen bg-background pt-12 md:pt-0 overflow-x-hidden">
          <Sidebar />
          <Suspense
            fallback={
              <div className="flex-1 min-w-0 flex items-center justify-center">
                <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </ClockGate>
    </ProjectChromeProvider>
  );
};

export default AppLayout;
