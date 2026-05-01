import React, { Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

// Eager — these are auth gates / public pages that load fast on their own.
import { Login } from '@/pages/auth/Login';
import { Signup } from '@/pages/auth/Signup';
import LandingPage from '@/pages/landing/LandingPage';

// Lazy — every authenticated/heavy page is fetched on demand. This shrinks the initial JS
// bundle from "everything" to "shell + landing/auth", which is the single biggest perf win
// for first paint and subsequent route warmth.
const Dashboard = React.lazy(() => import('@/pages/kanban/Dashboard').then((m) => ({ default: m.Dashboard })));
const ProjectView = React.lazy(() => import('@/pages/kanban/ProjectView').then((m) => ({ default: m.ProjectView })));
const MyTasks = React.lazy(() => import('@/pages/MyTasks').then((m) => ({ default: m.MyTasks })));
const Team = React.lazy(() => import('@/pages/Team').then((m) => ({ default: m.Team })));
const CalendarPage = React.lazy(() => import('@/pages/Calendar').then((m) => ({ default: m.Calendar })));
const Files = React.lazy(() => import('@/pages/Files').then((m) => ({ default: m.Files })));
const Comments = React.lazy(() => import('@/pages/Comments').then((m) => ({ default: m.Comments })));
const Contracts = React.lazy(() => import('@/pages/Contracts').then((m) => ({ default: m.Contracts })));
const Reports = React.lazy(() => import('@/pages/Reports').then((m) => ({ default: m.Reports })));
const TimelineOverview = React.lazy(() => import('@/pages/TimelineOverview').then((m) => ({ default: m.TimelineOverview })));
const Settings = React.lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })));
const Inbox = React.lazy(() => import('@/pages/Inbox').then((m) => ({ default: m.Inbox })));
const Workload = React.lazy(() => import('@/pages/Workload').then((m) => ({ default: m.Workload })));
const TimeTracking = React.lazy(() => import('@/pages/TimeTracking').then((m) => ({ default: m.TimeTracking })));
const ExpensesPage = React.lazy(() => import('@/pages/Expenses').then((m) => ({ default: m.Expenses })));
const HRPage = React.lazy(() => import('@/pages/HR').then((m) => ({ default: m.HR })));
const PayrollPage = React.lazy(() => import('@/pages/Payroll').then((m) => ({ default: m.Payroll })));
const AcceptInvite = React.lazy(() => import('@/pages/AcceptInvite').then((m) => ({ default: m.AcceptInvite })));
const Pricing = React.lazy(() => import('@/pages/subscription/Pricing').then((m) => ({ default: m.Pricing })));
const AdminDashboard = React.lazy(() => import('@/pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const AboutPage = React.lazy(() => import('@/pages/legal/AboutPage'));
const ContractsInfoPage = React.lazy(() => import('@/pages/legal/ContractsInfoPage'));
const PrivacyPolicyPage = React.lazy(() => import('@/pages/legal/PrivacyPolicyPage'));
const CookiePolicyPage = React.lazy(() => import('@/pages/legal/CookiePolicyPage'));
const TermsPage = React.lazy(() => import('@/pages/legal/TermsPage'));

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loader2Icon } from 'lucide-react';
import { Toaster } from './components/ui/sonner';
import CookieBanner from '@/components/landing/CookieBanner';
import { CommandPalette } from '@/components/command/CommandPalette';
import { CallProvider } from '@/components/calling/CallProvider';
import { CallOverlay } from '@/components/calling/CallOverlay';

const RouteFallback: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const lazyRoute = (node: React.ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
);


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
          { path: '/pricing', element: lazyRoute(<Pricing />) },
          { path: '/about', element: lazyRoute(<AboutPage />) },
          { path: '/contracts-info', element: lazyRoute(<ContractsInfoPage />) },
          { path: '/privacy', element: lazyRoute(<PrivacyPolicyPage />) },
          { path: '/cookies', element: lazyRoute(<CookiePolicyPage />) },
          { path: '/terms', element: lazyRoute(<TermsPage />) },
          { path: '/accept-invite/:token', element: lazyRoute(<AcceptInvite />) },
          { path: '/', element: <LandingPage /> },
          {
            path: '/dashboard',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Dashboard />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/project/:projectId',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<ProjectView />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/tasks',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<MyTasks />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/inbox',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Inbox />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/workload',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Workload />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/team',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Team />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/calendar',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<CalendarPage />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/files',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Files />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/comments',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Comments />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/contracts',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Contracts />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/time',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<TimeTracking />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/expenses',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<ExpensesPage />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/hr',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<HRPage />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/payroll',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<PayrollPage />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/reports',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Reports />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/timeline',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<TimelineOverview />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/settings',
            element: (
              <ProtectedRoute requireSubscription>
                {lazyRoute(<Settings />)}
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin',
            element: (
              <ProtectedRoute requireAdmin>
                {lazyRoute(<AdminDashboard />)}
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
              <CallProvider>
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
                <CallOverlay />
                <Toaster position='bottom-right' />
                <CookieBanner />
              </CallProvider>
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
