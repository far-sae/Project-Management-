import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { Organization, OrganizationMember } from '@/types/organization';
import { getOrganization } from '@/services/supabase/organizations';
import { supabase } from '@/services/supabase/config';
import { type CrmModule } from "@/services/supabase/crmGrants";
import { listCustomRoles, type CustomRole } from "@/services/supabase/customRoles";
import { resolvePagePermissions, type BuiltinRole } from "@/lib/pagePermissions";
import { type PageKey, type PageAccessLevel } from "@/lib/pageCatalog";

interface OrganizationContextType {
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  /** Pass `{ silent: true }` for background refresh (e.g. tab focus) to avoid global loading flashes. */
  refreshOrganization: (opts?: { silent?: boolean }) => Promise<void>;
  isOwner: boolean;
  isAdmin: boolean;
  /** Org-level role is "viewer" — read-only access; never gets clock/expense/edit. */
  isViewer: boolean;
  canInviteMembers: boolean;
  canManageBilling: boolean;
  canManageSettings: boolean;
  canViewModule: (m: CrmModule) => boolean;
  canEditModule: (m: CrmModule) => boolean;
  /** Owner-defined roles in this org (for the Team editor). */
  customRoles: CustomRole[];
  /** Current user's effective access to a page: 'none' | 'view' | 'edit'.
   *  Owner is always 'edit'; otherwise driven by the assigned custom role, or
   *  the built-in role's today-equivalent surface. Does NOT include the plan
   *  feature gate — apply that separately (it already exists). */
  pageLevel: (page: PageKey) => PageAccessLevel;
  canAccessPage: (page: PageKey) => boolean;
  canEditPage: (page: PageKey) => boolean;
  /** True until org + custom roles have loaded — guards should wait on this
   *  before deciding page access (avoids a wrong-access flash). */
  permissionsLoading: boolean;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: ReactNode; }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  // False until the org's custom roles have been fetched at least once, so
  // route guards don't decide page access before a member's role is known.
  const [customRolesLoaded, setCustomRolesLoaded] = useState(false);

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

  const fetchOrganization = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (authLoading || !user) return;

    // Treat any refresh as silent once we already have an org loaded — flipping
    // `loading: true` here causes ProtectedRoute (requireOrgAdmin) to unmount
    // pages like /team mid-session and remount them from scratch every time
    // user.organizationId churns (e.g. on tab refocus when the auth event
    // briefly resets it to `local-…`). Keep showing the cached org while the
    // network refetch happens in the background.
    const showLoading = !silent && !organization;

    if (showLoading) {
      setLoading(true);
      setError(null);
    } else if (!silent) {
      setError(null);
    }

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
        if (foundOrg) {
          // Accept this org whether user is owner OR member/admin/viewer.
          // Previously this only returned for owners, causing invited members
          // to fall through and get a local-only fallback org.
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
        .filter('members', 'cs', JSON.stringify([{ userId: user.userId }]))
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
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // ============================================
  // Computed values
  // ============================================

  const role = getUserRole();
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin' || isOwner;
  const isViewer = role === 'viewer';
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
          void fetchOrganization({ silent: true });
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
      const orgId = user.organizationId;
      const hasValidOrgId = orgId && !orgId.startsWith('local-');

      if (hasValidOrgId) {
        // Real org ID available — fetch immediately. If we already have an org
        // cached, treat as silent to avoid unmounting the current page.
        fetchOrganization(organization ? { silent: true } : undefined);
      } else {
        // AuthContext is still resolving the org asynchronously. Use a short
        // delay (was 2s, now 500ms) — the profile query in fetchOrganization
        // will find the real org even without the auth-context ID.
        const timeout = setTimeout(() => {
          fetchOrganization();
        }, 500);
        return () => clearTimeout(timeout);
      }
    } else if (!user) {
      setOrganization(null);
      setLoading(false);
    }
  }, [user?.userId, user?.organizationId, authLoading]);

  // Refetch when tab becomes visible — silent so we don't flash loading across the app.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && user) void fetchOrganization({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [user?.userId]);

  // Load the org's custom roles (drives per-page access). Non-fatal on error
  // (e.g. local-only org) — falls back to [] and the built-in role surface.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (organization?.organizationId) {
          const roles = await listCustomRoles(organization.organizationId);
          if (!cancelled) setCustomRoles(roles);
        } else if (!cancelled) {
          setCustomRoles([]);
        }
      } catch {
        if (!cancelled) setCustomRoles([]);
      } finally {
        if (!cancelled) setCustomRolesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [organization?.organizationId]);

  // ============================================
  // Provider value
  // ============================================

  const value = useMemo(() => {
    // Resolve the current user's per-page access from their assigned custom
    // role (if any), else the built-in role's today-equivalent surface.
    const me = organization?.members.find((m) => m.userId === user?.userId);
    const myCustomRole = me?.customRoleId
      ? customRoles.find((r) => r.roleId === me.customRoleId) ?? null
      : null;
    const pagePerms = resolvePagePermissions({
      isOwner,
      builtinRole: (role as BuiltinRole | null),
      customRole: myCustomRole,
    });
    const pageLevel = (page: PageKey): PageAccessLevel => pagePerms[page] ?? 'none';

    // CRM module access (Deals/Leads) is governed by the assigned custom role,
    // not a separate per-member grant matrix (removed). Owner/admin = full.
    // A member with no custom role can VIEW by default (matches the CRM
    // default-open read) but can't EDIT until a role grants 'crm' = edit.
    const crmRoleLevel: PageAccessLevel | null = myCustomRole
      ? (myCustomRole.permissions['crm'] ?? 'none')
      : null;
    const canViewModule = (_m: CrmModule): boolean =>
      isAdmin || (crmRoleLevel !== null ? crmRoleLevel !== 'none' : true);
    const canEditModule = (_m: CrmModule): boolean =>
      isAdmin || crmRoleLevel === 'edit';

    return {
      organization,
      loading,
      error,
      refreshOrganization: fetchOrganization,
      isOwner,
      isAdmin,
      isViewer,
      canInviteMembers,
      canManageBilling,
      canManageSettings,
      canViewModule,
      canEditModule,
      customRoles,
      pageLevel,
      canAccessPage: (page: PageKey) => pageLevel(page) !== 'none',
      canEditPage: (page: PageKey) => pageLevel(page) === 'edit',
      permissionsLoading: loading || !customRolesLoaded,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, loading, error, isOwner, isAdmin, isViewer, canInviteMembers, canManageBilling, canManageSettings, customRoles, customRolesLoaded, role, user?.userId]);

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
