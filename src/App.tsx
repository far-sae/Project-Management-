import React, { Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useParams } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
import { WorkspaceProvider } from '@/context/WorkspaceContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

// Public and authenticated pages are fetched on demand. This keeps the startup
// bundle to the app shell and loads page code only when a route needs it.
const Login = React.lazy(() => import('@/pages/auth/Login').then((m) => ({ default: m.Login })));
const Signup = React.lazy(() => import('@/pages/auth/Signup').then((m) => ({ default: m.Signup })));
const LandingPage = React.lazy(() => import('@/pages/landing/LandingPage'));
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
const CrmContactsPage = React.lazy(() => import('@/pages/crmHub/Contacts').then((m) => ({ default: m.CrmContactsPage })));
const CrmCompaniesPage = React.lazy(() => import('@/pages/crmHub/Companies').then((m) => ({ default: m.CrmCompaniesPage })));
const CrmDealsPage = React.lazy(() => import('@/pages/crmHub/Deals').then((m) => ({ default: m.CrmDealsPage })));
const CrmTasksPage = React.lazy(() => import('@/pages/crmHub/Tasks').then((m) => ({ default: m.CrmTasksPage })));
const CrmActivityPage = React.lazy(() => import('@/pages/crmHub/Activity').then((m) => ({ default: m.CrmActivityPage })));
const CrmTagsPage = React.lazy(() => import('@/pages/crmHub/Tags').then((m) => ({ default: m.CrmTagsPage })));
const CrmLayout = React.lazy(() => import('@/pages/crmHub/CrmLayout').then((m) => ({ default: m.CrmLayout })));
const CrmContactDetailPage = React.lazy(() => import('@/pages/crmHub/ContactDetail').then((m) => ({ default: m.CrmContactDetailPage })));
const CrmCompanyDetailPage = React.lazy(() => import('@/pages/crmHub/CompanyDetail').then((m) => ({ default: m.CrmCompanyDetailPage })));
const CrmDealDetailPage = React.lazy(() => import('@/pages/crmHub/DealDetail').then((m) => ({ default: m.CrmDealDetailPage })));
const CrmDashboardPage = React.lazy(() => import('@/pages/crmHub/Dashboard').then((m) => ({ default: m.CrmDashboardPage })));
const CrmSettingsPage = React.lazy(() => import('@/pages/crmHub/Settings').then((m) => ({ default: m.CrmSettingsPage })));
const EmailPage = React.lazy(() => import('@/pages/Email').then((m) => ({ default: m.Email })));
const SocialMediaPage = React.lazy(() => import('@/pages/SocialMedia').then((m) => ({ default: m.SocialMedia })));
const Pricing = React.lazy(() => import('@/pages/subscription/Pricing').then((m) => ({ default: m.Pricing })));
const AdminDashboard = React.lazy(() => import('@/pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const ProjectsDashboard = React.lazy(() => import('@/pages/dashboards/ProjectsDashboard').then((m) => ({ default: m.ProjectsDashboard })));
const AboutPage = React.lazy(() => import('@/pages/legal/AboutPage'));
const ContractsInfoPage = React.lazy(() => import('@/pages/legal/ContractsInfoPage'));
const PrivacyPolicyPage = React.lazy(() => import('@/pages/legal/PrivacyPolicyPage'));
const CookiePolicyPage = React.lazy(() => import('@/pages/legal/CookiePolicyPage'));
const TermsPage = React.lazy(() => import('@/pages/legal/TermsPage'));

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loader2Icon } from 'lucide-react';
import { Toaster } from './components/ui/sonner';
import CookieBanner from '@/components/landing/CookieBanner';
import { CallProvider } from '@/components/calling/CallProvider';
import { AppLayout } from '@/components/layout/AppLayout';
const CommandPalette = React.lazy(() =>
  import('@/components/command/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const CallOverlay = React.lazy(() =>
  import('@/components/calling/CallOverlay').then((m) => ({ default: m.CallOverlay })),
);
// Used for non-app routes (auth, landing, legal). Authenticated routes get
// their own scoped fallback inside <AppLayout> so the sidebar stays visible
// while the page area lazy-loads.
const RouteFallback: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Project view shares one route pattern (`/project/:projectId`) for every
// project, so React Router reuses the same component instance when the user
// switches between projects from the sidebar. That left old subscriptions
// (tasks, presence, chat) racing with the new ones and produced the "stuck"
// behaviour on mobile after the second click. Keying by `projectId` forces
// a clean unmount/remount so every per-project hook resets cleanly.
const KeyedProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  return <ProjectView key={projectId ?? 'no-project'} />;
};

const lazyRoute = (node: React.ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
);

// Inside <AppLayout>, the layout owns a single <Suspense> wrapping <Outlet>,
// so each authenticated route just needs the lazy component itself.
const lazyAppRoute = (node: React.ReactNode) => node;


const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // After OAuth roundtrip Supabase drops the user back at "/" — if they were
  // mid-invite-accept we need to send them to the accept page instead of the
  // dashboard, otherwise the token gets stranded and the project never links.
  const pendingInviteToken =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('pendingInviteToken') ||
        localStorage.getItem('pendingInviteToken')
      : null;

  if (pendingInviteToken) {
    return <Navigate to={`/accept-invite/${pendingInviteToken}`} replace />;
  }

  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
};

const RouterShell: React.FC = () => {
  const { user } = useAuth();
  return (
    <WorkspaceProvider>
      <Outlet />
      {/* Command palette is global but only useful while authenticated */}
      {user && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </WorkspaceProvider>
  );
};

// Router is created once at module level — NOT inside App() — so it is stable
// across re-renders. Previously it was recreated on every render, which caused
// the entire component tree to remount (the biggest performance issue).
const router = createBrowserRouter(
  [
    {
      element: <RouterShell />,
      errorElement: <ErrorBoundary />,
      children: [
        // Public lead-capture form pages — mounted OUTSIDE the authenticated
        // AppLayout so they render with no sidebar / no auth guard. Placed
        // first so they match before any catch-alls.
        { path: '/login', element: lazyRoute(<Login />) },
        { path: '/signup', element: lazyRoute(<Signup />) },
        { path: '/pricing', element: lazyRoute(<Pricing />) },
        { path: '/about', element: lazyRoute(<AboutPage />) },
        { path: '/contracts-info', element: lazyRoute(<ContractsInfoPage />) },
        { path: '/privacy', element: lazyRoute(<PrivacyPolicyPage />) },
        { path: '/cookies', element: lazyRoute(<CookiePolicyPage />) },
        { path: '/terms', element: lazyRoute(<TermsPage />) },
        { path: '/accept-invite/:token', element: lazyRoute(<AcceptInvite />) },
        { path: '/', element: lazyRoute(<LandingPage />) },
        {
          // All authenticated app routes share a single layout — the sidebar
          // mounts once here and stays mounted across navigation. Without
          // this, every page imported its own <Sidebar /> and the projects
          // list re-fetched / flashed on every click.
          element: <AppLayout />,
          children: [
            {
              path: '/dashboard',
              element: (
                <ProtectedRoute requireSubscription requirePage="dashboard">
                  {lazyAppRoute(<Dashboard />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/dashboard/projects',
              element: (
                <ProtectedRoute requireSubscription requirePage="projects_analytics">
                  {lazyAppRoute(<ProjectsDashboard />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/project/:projectId',
              element: (
                <ProtectedRoute requireSubscription requirePage="project_management">
                  {lazyAppRoute(<KeyedProjectView />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/tasks',
              element: (
                <ProtectedRoute requireSubscription requirePage="my_tasks">
                  {lazyAppRoute(<MyTasks />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/inbox',
              element: (
                <ProtectedRoute requireSubscription requirePage="inbox">
                  {lazyAppRoute(<Inbox />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/workload',
              element: (
                <ProtectedRoute requireSubscription requirePage="workload">
                  {lazyAppRoute(<Workload />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/team',
              element: (
                <ProtectedRoute requireSubscription requirePage="team">
                  {lazyAppRoute(<Team />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/calendar',
              element: (
                <ProtectedRoute requireSubscription requirePage="calendar">
                  {lazyAppRoute(<CalendarPage />)}
                </ProtectedRoute>
              ),
            },
            {
              // Files is now per-user personal storage — owner, admin, and
              // member each see only their own uploads. Viewers are blocked
              // inside the page itself (they're redirected to /tasks).
              path: '/files',
              element: (
                <ProtectedRoute requireSubscription requirePage="files">
                  {lazyAppRoute(<Files />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/comments',
              element: (
                <ProtectedRoute requireSubscription requirePage="comments">
                  {lazyAppRoute(<Comments />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/contracts',
              element: (
                <ProtectedRoute requireSubscription requirePage="contracts">
                  {lazyAppRoute(<Contracts />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/time',
              element: (
                <ProtectedRoute requireSubscription requirePage="hr">
                  {lazyAppRoute(<TimeTracking />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/expenses',
              element: (
                <ProtectedRoute requireSubscription requirePage="hr">
                  {lazyAppRoute(<ExpensesPage />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/hr',
              element: (
                <ProtectedRoute requireSubscription requirePage="hr">
                  {lazyAppRoute(<HRPage />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/payroll',
              element: (
                <ProtectedRoute requireSubscription requirePage="hr">
                  {lazyAppRoute(<PayrollPage />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/reports',
              element: (
                <ProtectedRoute requireSubscription requirePage="reports">
                  {lazyAppRoute(<Reports />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/crm',
              element: (
                <ProtectedRoute requireSubscription requireFeature="crm" requirePage="crm">
                  {lazyAppRoute(<CrmLayout />)}
                </ProtectedRoute>
              ),
              children: [
                { index: true, element: <Navigate to="/crm/dashboard" replace /> },
                { path: 'dashboard',    element: lazyAppRoute(<CrmDashboardPage />) },
                { path: 'reports',      element: <Navigate to="/reports" replace /> },
                { path: 'contacts',     element: lazyAppRoute(<CrmContactsPage />) },
                { path: 'contacts/:id', element: lazyAppRoute(<CrmContactDetailPage />) },
                { path: 'companies',    element: lazyAppRoute(<CrmCompaniesPage />) },
                { path: 'companies/:id', element: lazyAppRoute(<CrmCompanyDetailPage />) },
                { path: 'deals',        element: lazyAppRoute(<CrmDealsPage />) },
                { path: 'deals/:id',    element: lazyAppRoute(<CrmDealDetailPage />) },
                { path: 'tasks',        element: lazyAppRoute(<CrmTasksPage />) },
                { path: 'activity',     element: lazyAppRoute(<CrmActivityPage />) },
                { path: 'tags',         element: lazyAppRoute(<CrmTagsPage />) },
                { path: 'calendar',     element: <Navigate to="/calendar" replace /> },
                { path: 'settings',     element: lazyAppRoute(<CrmSettingsPage />) },
              ],
            },
            {
              path: '/email',
              element: (
                <ProtectedRoute requireSubscription requireFeature="email_campaigns" requirePage="email">
                  {lazyAppRoute(<EmailPage />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/social',
              element: (
                <ProtectedRoute requireSubscription requirePage="social">
                  {lazyAppRoute(<SocialMediaPage />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/timeline',
              element: (
                <ProtectedRoute requireSubscription requirePage="timeline">
                  {lazyAppRoute(<TimelineOverview />)}
                </ProtectedRoute>
              ),
            },
            {
              path: '/settings',
              element: (
                <ProtectedRoute requireSubscription requirePage="settings">
                  {lazyAppRoute(<Settings />)}
                </ProtectedRoute>
              ),
            },
          ],
        },
        {
          // Admin dashboard is its own self-contained shell — keep it outside
          // the app layout so it is not double-wrapped in the sidebar.
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

export default function App() {
  return (
    <ThemeProvider>
      <MotionGate>
        <AuthProvider>
          <OrganizationProvider>
            <SubscriptionProvider>
              <CallProvider>
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
                <Suspense fallback={null}>
                  <CallOverlay />
                </Suspense>
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
