import React from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

import { Login } from '@/pages/auth/Login';
import { Signup } from '@/pages/auth/Signup';
import { Dashboard } from '@/pages/kanban/Dashboard';
import { ProjectView } from '@/pages/kanban/ProjectView';
import { MyTasks } from '@/pages/MyTasks';
import { Team } from '@/pages/Team';
import { Calendar } from '@/pages/Calendar';
import { Files } from '@/pages/Files';
import { Comments } from '@/pages/Comments';
import { Contracts } from '@/pages/Contracts';
import { Reports } from '@/pages/Reports';
import { TimelineOverview } from '@/pages/TimelineOverview';
import { Settings } from '@/pages/Settings';
import { Inbox } from '@/pages/Inbox';
import { Workload } from '@/pages/Workload';
import { AcceptInvite } from '@/pages/AcceptInvite';
import { Pricing } from '@/pages/subscription/Pricing';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import LandingPage from '@/pages/landing/LandingPage';
import AboutPage from '@/pages/legal/AboutPage';
import ContractsInfoPage from '@/pages/legal/ContractsInfoPage';
import PrivacyPolicyPage from '@/pages/legal/PrivacyPolicyPage';
import TermsPage from '@/pages/legal/TermsPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loader2Icon } from 'lucide-react';
import { Toaster } from './components/ui/sonner';
import CookieBanner from '@/components/landing/CookieBanner';
import { CommandPalette } from '@/components/command/CommandPalette';


const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
};

const RouterShell: React.FC = () => {
  const { user } = useAuth();
  return (
    <>
      <Outlet />
      {/* Command palette is global but only useful while authenticated */}
      {user && <CommandPalette />}
    </>
  );
};

export default function App() {
  const router = createBrowserRouter(
    [
      {
        element: <RouterShell />,
        errorElement: <ErrorBoundary />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/signup', element: <Signup /> },
          { path: '/pricing', element: <Pricing /> },
          { path: '/about', element: <AboutPage /> },
          { path: '/contracts-info', element: <ContractsInfoPage /> },
          { path: '/privacy', element: <PrivacyPolicyPage /> },
          { path: '/terms', element: <TermsPage /> },
          { path: '/accept-invite/:token', element: <AcceptInvite /> },
          { path: '/', element: <LandingPage /> },
          {
            path: '/dashboard',
            element: (
              <ProtectedRoute requireSubscription>
                <Dashboard />
              </ProtectedRoute>
            ),
          },
          {
            path: '/project/:projectId',
            element: (
              <ProtectedRoute requireSubscription>
                <ProjectView />
              </ProtectedRoute>
            ),
          },
          {
            path: '/tasks',
            element: (
              <ProtectedRoute requireSubscription>
                <MyTasks />
              </ProtectedRoute>
            ),
          },
          {
            path: '/inbox',
            element: (
              <ProtectedRoute requireSubscription>
                <Inbox />
              </ProtectedRoute>
            ),
          },
          {
            path: '/workload',
            element: (
              <ProtectedRoute requireSubscription>
                <Workload />
              </ProtectedRoute>
            ),
          },
          {
            path: '/team',
            element: (
              <ProtectedRoute requireSubscription>
                <Team />
              </ProtectedRoute>
            ),
          },
          {
            path: '/calendar',
            element: (
              <ProtectedRoute requireSubscription>
                <Calendar />
              </ProtectedRoute>
            ),
          },
          {
            path: '/files',
            element: (
              <ProtectedRoute requireSubscription>
                <Files />
              </ProtectedRoute>
            ),
          },
          {
            path: '/comments',
            element: (
              <ProtectedRoute requireSubscription>
                <Comments />
              </ProtectedRoute>
            ),
          },
          {
            path: '/contracts',
            element: (
              <ProtectedRoute requireSubscription>
                <Contracts />
              </ProtectedRoute>
            ),
          },
          {
            path: '/reports',
            element: (
              <ProtectedRoute requireSubscription>
                <Reports />
              </ProtectedRoute>
            ),
          },
          {
            path: '/timeline',
            element: (
              <ProtectedRoute requireSubscription>
                <TimelineOverview />
              </ProtectedRoute>
            ),
          },
          {
            path: '/settings',
            element: (
              <ProtectedRoute requireSubscription>
                <Settings />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin',
            element: (
              <ProtectedRoute requireAdmin>
                <AdminDashboard />
              </ProtectedRoute>
            ),
          },
          { path: '*', element: <RootRedirect /> },
        ],
      },
    ],
    {
      future: {
        v7_relativeSplatPath: true,
      },
    }
  );

  return (
    <ThemeProvider>
      <MotionGate>
        <AuthProvider>
          <OrganizationProvider>
            <SubscriptionProvider>
              <RouterProvider router={router} future={{ v7_startTransition: true }} />
              <Toaster position='bottom-right' />
              <CookieBanner />
            </SubscriptionProvider>
          </OrganizationProvider>
        </AuthProvider>
      </MotionGate>
    </ThemeProvider>
  );
}

const MotionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { reducedMotion } = useTheme();
  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  );
};
