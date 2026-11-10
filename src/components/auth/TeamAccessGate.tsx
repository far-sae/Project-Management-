import React, { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { isAppOwner } from '@/lib/app-owner';
import { managedProjects } from '@/lib/projectManagers';

/**
 * Team page access: organization admins (page permission) — or anyone who
 * runs at least one project (its owner or a project admin). Those people
 * manage the people on THEIR projects only; the Team page limits them to
 * those projects, and the database enforces it (can_manage_project_members).
 */
export const TeamAccessGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { canAccessPage, permissionsLoading } = useOrganization();
  const { projects, loading: projectsLoading } = useProjects();

  const managesProjects = useMemo(
    () => managedProjects(projects, user?.userId).length > 0,
    [projects, user?.userId],
  );

  if (!user) return null;
  if (isAppOwner(user.userId)) return <>{children}</>;
  if (!permissionsLoading && canAccessPage('team')) return <>{children}</>;
  if (permissionsLoading || projectsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }
  if (managesProjects) return <>{children}</>;
  return <Navigate to="/tasks" replace />;
};
