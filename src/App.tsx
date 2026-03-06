import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';
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
import { AcceptInvite } from '@/pages/AcceptInvite';
import { Pricing } from '@/pages/subscription/Pricing';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loader2Icon } from 'lucide-react';
import { Toaster } from './components/ui/sonner';


const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2Icon className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return <Navigate to={user ? '/dashboard' : '/login'} replace />;
};

export default function App() {
  const router = createBrowserRouter(
    [
      {
        element: <Outlet />,
        errorElement: <ErrorBoundary />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/signup', element: <Signup /> },
          { path: '/pricing', element: <Pricing /> },
          { path: '/accept-invite/:token', element: <AcceptInvite /> },
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
          { path: '/', element: <RootRedirect /> },
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
    <AuthProvider>
      <OrganizationProvider>
        <SubscriptionProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
          <Toaster position='bottom-right' />
        </SubscriptionProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}
