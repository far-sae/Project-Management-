import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { isAppOwner } from '@/lib/app-owner';

/** Only the organization owner (and the app owner) may open the wrapped page. */
export const OwnerOnlyGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { isOwner, loading } = useOrganization();
  if (!user) return null;
  if (isOwner || isAppOwner(user.userId)) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }
  return <Navigate to="/tasks" replace />;
};
