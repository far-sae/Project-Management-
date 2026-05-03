import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { ProjectChromeProvider } from '@/context/ProjectChromeContext';

// Layout route for every authenticated page. The sidebar mounts once here and
// stays mounted across navigation, so projects/subscriptions stay loaded and
// there is no full-screen flash between routes. The page-area Suspense
// fallback is a small inline spinner inside <main>, not a full-viewport one.
export const AppLayout: React.FC = () => {
  return (
    <ProjectChromeProvider>
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
    </ProjectChromeProvider>
  );
};

export default AppLayout;
