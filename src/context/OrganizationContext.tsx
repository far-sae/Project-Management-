import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { Organization, OrganizationMember } from '@/types/organization';
import { getOrganization } from '@/services/supabase/organizations';
import { supabase } from '@/services/supabase/config';

interface OrganizationContextType {
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  refreshOrganization: () => Promise<void>;
  isOwner: boolean;
  isAdmin: boolean;
  canInviteMembers: boolean;
  canManageBilling: boolean;
  canManageSettings: boolean;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: ReactNode; }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // Helper Functions
  // ============================================

  const getUserRole = () => {
    if (!user || !organization) return null;
    if (organization.ownerId === user.userId) return 'owner';
    const member = organization.members.find((m: OrganizationMember) => m.userId === user.userId);
    return member?.role || null;
  };


  // ============================================
  // Main fetch function
  // ============================================

  const fetchOrganization = async () => {
    if (authLoading || !user) return;

    setLoading(true);
    setError(null);

    try {
      let foundOrg: Organization | null = null;

      // 1. Always prefer latest org from user profile.
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.userId)
        .maybeSingle();

      const profileOrgId = profile?.organization_id?.replace('local-', '');
      if (profileOrgId) {
        foundOrg = await getOrganization(profileOrgId);
        if (foundOrg && foundOrg.ownerId === user.userId) {
          setOrganization(foundOrg);
          return;
        }
      }

      // 2. Fallback to user.organizationId from auth context
      const orgId = user.organizationId?.replace('local-', '') || user.userId;
      if (orgId && !orgId.startsWith('local-')) {
        foundOrg = await getOrganization(orgId);
        if (foundOrg) {
          setOrganization(foundOrg);
          return;
        }
      }

      // 3. Try by owner_id
      const { data: ownerOrgs, error: ownerOrgError } = await supabase
        .from('organizations')
        .select('organization_id')
        .eq('owner_id', user.userId)
        .order('created_at', { ascending: true })
        .limit(1);

      if (ownerOrgError) {
        console.warn('Failed to lookup owner organization:', ownerOrgError);
      }

      const ownerOrgId = ownerOrgs?.[0]?.organization_id ?? null;
      if (ownerOrgId) {
        foundOrg = await getOrganization(ownerOrgId);
        if (foundOrg) {
          setOrganization(foundOrg);
          return;
        }
      }

      // 4. Try by member
      const { data: memberOrgs, error: memberOrgError } = await supabase
        .from('organizations')
        .select('organization_id')
        .contains('members', [{ userId: user.userId }])
        .order('created_at', { ascending: true })
        .limit(1);

      if (memberOrgError) {
        console.warn('Failed to lookup membership organization:', memberOrgError);
      }

      const memberOrgId = memberOrgs?.[0]?.organization_id ?? null;
      if (memberOrgId) {
        foundOrg = await getOrganization(memberOrgId);
        if (foundOrg) {
          setOrganization(foundOrg);
          return;
        }
      }

      // Organization creation is centralized in AuthContext to avoid duplicate inserts.
      // This is expected during initial login - don't show error, just set loading
      console.log('Organization not found yet; AuthContext may still be creating it');
      setOrganization(null);
      setError(null); // Don't show error - this is a temporary state during login

    } catch (err) {
      console.error('❌ Failed to fetch organization:', err);
      setError('Failed to initialize organization');

      // Fallback to local-only organization (not in DB)
      setOrganization({
        organizationId: user.userId,
        name: `${user.displayName}'s Workspace`,
        slug: (user.displayName || 'user').toLowerCase().replace(/\s+/g, '-'),
        description: '',
        ownerId: user.userId,
        ownerEmail: user.email,
        ownerName: user.displayName,
        members: [{
          userId: user.userId,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL || '',
          role: 'owner',
          joinedAt: new Date(),
          status: 'active',
        }],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active',
        subscription: {
          tier: 'starter',
          seats: 1,
          startDate: new Date(),
          endDate: null,
          status: 'trial',
          autoRenew: true,
        },
        settings: {
          timezone: 'UTC',
          currency: 'USD',
          locale: 'en',
          branding: {},
          features: {
            aiEnabled: false,
            fileUploadsEnabled: false,
            advancedAnalytics: false,
          },
        },
        metrics: {
          totalProjects: 0,
          totalTasks: 0,
          totalMembers: 1,
          totalFiles: 0,
          storageUsed: 0,
          activeUsers: 1,
        },
        // country: 'US',
      });
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Computed values
  // ============================================

  const role = getUserRole();
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const canInviteMembers = isAdmin;
  const canManageBilling = isOwner;
  const canManageSettings = isAdmin;

  // ============================================
  // Effects
  // ============================================

  // Realtime subscription
  useEffect(() => {
    if (!organization?.organizationId) return;

    const channel = supabase
      .channel(`org-${organization.organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'organizations',
          filter: `organization_id=eq.${organization.organizationId}`,
        },
        () => {
          console.log('🔄 Organization updated - refreshing...');
          fetchOrganization();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => { });
    };
  }, [organization?.organizationId]);

  // Initial fetch
  useEffect(() => {
    if (!authLoading && user) {
      // Wait for the real organization ID to be set (not "local-" format)
      // AuthContext creates the org asynchronously after initial login
      const orgId = user.organizationId;
      const hasValidOrgId = orgId && !orgId.startsWith('local-');

      if (hasValidOrgId) {
        fetchOrganization();
      } else {
        // Wait a bit for AuthContext to create the organization
        // This handles the race condition where authLoading becomes false
        // before the org is fully set up
        const timeout = setTimeout(() => {
          fetchOrganization();
        }, 2000);
        return () => clearTimeout(timeout);
      }
    } else if (!user) {
      setOrganization(null);
      setLoading(false);
    }
  }, [user?.userId, user?.organizationId, authLoading]);

  // Refetch when tab becomes visible so data stays in sync across browsers/tabs
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && user) fetchOrganization();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [user?.userId]);

  // ============================================
  // Provider value
  // ============================================

  const value = {
    organization,
    loading,
    error,
    refreshOrganization: fetchOrganization,
    isOwner,
    isAdmin,
    canInviteMembers,
    canManageBilling,
    canManageSettings,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganization = (): OrganizationContextType => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};
