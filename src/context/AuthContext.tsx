import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/services/supabase/config';
import { logger } from '@/lib/logger';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOut as supabaseSignOut,
  createUserProfile,
  refreshTokenIfNeeded,
  ensureValidSession as ensureValidSessionAuth,
} from '@/services/supabase/auth';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  ensureValidSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeProvider = (provider?: string): "email" | "google" | "apple" => {
  if (provider === "google") return "google";
  if (provider === "apple") return "apple";
  return "email";
};

const ensureOrganizationExists = async (
  userId: string,
  displayName: string,
  email: string,
  photoURL: string,
): Promise<string | null> => {
  try {
    // 1. Check if profile already has a real org owned by this user
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.organization_id && !profile.organization_id.startsWith('local-')) {
      const { data: profileOrg } = await supabase
        .from('organizations')
        .select('organization_id, owner_id')
        .eq('organization_id', profile.organization_id)
        .maybeSingle();

      if (profileOrg?.owner_id === userId) {
        return profile.organization_id;
      }
    }

    // 2. Check if org already exists for this user (safe when duplicates exist)
    const { data: existingOrgs, error: orgLookupError } = await supabase
      .from('organizations')
      .select('organization_id')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (orgLookupError) {
      console.warn('⚠️ Failed to lookup existing organization:', orgLookupError);
    }

    const existingOrgId = existingOrgs?.[0]?.organization_id ?? null;
    if (existingOrgId) {
      const { data: linkedRow, error: linkExistingError } = await supabase
        .from('user_profiles')
        .update({ organization_id: existingOrgId })
        .eq('id', userId)
        .select('id')
        .maybeSingle();
      if (linkExistingError) {
        logger.error('Failed to link existing organization to user profile:', linkExistingError);
        return null;
      }
      if (!linkedRow) {
        logger.error('Failed to link existing organization: user_profiles row not found or not updated', {
          userId,
          existingOrgId,
        });
        return null;
      }
      return existingOrgId;
    }

    // 2b. Already a MEMBER (not owner) of an existing org — invited from elsewhere.
    // Without this branch, step 3 creates a brand-new org with this user as owner,
    // which (a) makes them bypass the clock-in gate and (b) starts a fresh
    // subscription trial for them instead of inheriting the inviting org's plan.
    const { data: memberOrgs, error: memberLookupError } = await supabase
      .from('organizations')
      .select('organization_id')
      .filter('members', 'cs', JSON.stringify([{ userId }]))
      .order('created_at', { ascending: true })
      .limit(1);

    if (memberLookupError) {
      console.warn('⚠️ Failed to lookup membership organization:', memberLookupError);
    }

    const membershipOrgId = memberOrgs?.[0]?.organization_id ?? null;
    if (membershipOrgId) {
      const { data: linkedRow, error: linkMemberError } = await supabase
        .from('user_profiles')
        .update({ organization_id: membershipOrgId })
        .eq('id', userId)
        .select('id')
        .maybeSingle();
      if (linkMemberError) {
        logger.error('Failed to link membership organization to user profile:', linkMemberError);
        return null;
      }
      if (!linkedRow) {
        logger.error(
          'Failed to link membership organization: user_profiles row not found or not updated',
          { userId, membershipOrgId },
        );
        return null;
      }
      return membershipOrgId;
    }

    // 2c. Pending-invite guard. If we get here it means the user has no
    // existing org as owner or member yet. But they might be in the middle
    // of an invite flow — they clicked an invite link and signed in/up, and
    // AcceptInvite is *about* to call accept_invitation which will add them
    // to the inviter's org. If we proceed to step 3 right now we create a
    // fresh tenant with this user as owner, link it to user_profiles, and
    // by the time accept_invitation runs there's already a "ghost" workspace
    // and the inviter's org loses out to it on the next sign-in. That was
    // the bug — invitees were silently turning into owners of a brand-new
    // tenant on first login. Skip auto-create when an invite is pending and
    // let the AcceptInvite page link them to the right org.
    const pendingInviteTokenInStorage =
      typeof window !== 'undefined'
        ? (sessionStorage.getItem('pendingInviteToken') ||
            localStorage.getItem('pendingInviteToken'))
        : null;

    // Also check the current URL — after OAuth redirect the browser may land
    // on / or /accept-invite/:token before AcceptInvite has a chance to set
    // the sessionStorage flag. The URL is the most reliable signal.
    const urlHasInvite =
      typeof window !== 'undefined' &&
      (window.location.pathname.includes('/accept-invite/') ||
        window.location.href.includes('/accept-invite/'));

    let invitePending = !!pendingInviteTokenInStorage || urlHasInvite;
    if (!invitePending && email) {
      // Try direct table first; fall back to a lenient match. The invitations
      // table may be RLS-restricted for a newly-created user, so catch failures
      // and still err on the side of NOT creating a tenant when the user has
      // just followed an invite link.
      try {
        const { data: pendingInvites, error: pendingInviteError } = await supabase
          .from('invitations')
          .select('invitation_id')
          .eq('email', email.toLowerCase().trim())
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .limit(1);
        if (pendingInviteError) {
          // RLS blocked — treat as "invite pending" to be safe. A new user who
          // followed an invite link will almost always hit this on first login.
          console.warn('⚠️ Pending-invite lookup failed (treating as pending):', pendingInviteError);
          invitePending = true;
        } else if (pendingInvites && pendingInvites.length > 0) {
          invitePending = true;
        }
      } catch (lookupErr) {
        console.warn('⚠️ Pending-invite lookup threw (treating as pending):', lookupErr);
        invitePending = true;
      }
    }

    if (invitePending) {
      console.log(
        '⏸️ Skipping org auto-create — pending invite detected for',
        email,
      );
      return null;
    }

    // 3. Create new org
    const orgId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: orgError } = await supabase
      .from('organizations')
      .insert({
        organization_id: orgId,
        name: `${displayName}'s Workspace`,
        owner_id: userId,
        members: [{
          userId,
          email,
          displayName,
          photoURL,
          role: 'owner',
          addedAt: now,
          status: 'active',
        }],
        created_at: now,
        updated_at: now,
      });

    if (orgError) {
      console.error('❌ Failed to create organization:', orgError);
      return null;
    }

    // 4. Create primary workspace (group for projects; not shown as a special "default" in the UI)
    const { error: wsError } = await supabase
      .from('workspaces')
      .insert({
        workspace_id: crypto.randomUUID(),
        name: 'General',
        organization_id: orgId,
        is_default: true,
        created_at: now,
        updated_at: now,
      });

    if (wsError) console.warn('⚠️ Failed to create default workspace:', wsError);

    // 5. Link org to user profile — UPSERT in case row doesn't exist yet
    const { error: profileError } = await supabase
      .from('user_profiles')
      .upsert({
        id: userId,
        organization_id: orgId,
        updated_at: now,
      }, { onConflict: 'id' });

    if (profileError) console.warn('⚠️ Failed to link org to profile:', profileError);

    console.log('✅ Organization + workspace created:', orgId);
    return orgId;

  } catch (err) {
    console.error('❌ ensureOrganizationExists error:', err);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode; }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        if (event === 'TOKEN_REFRESHED') {
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_OUT') {
          setUser(null);
          setLoading(false);
          return;
        }

        if (session?.user) {
          const displayName =
            session.user.user_metadata?.display_name ||
            session.user.user_metadata?.full_name ||
            session.user.email?.split('@')[0] ||
            'User';

          const photoURL =
            session.user.user_metadata?.avatar_url ||
            session.user.user_metadata?.picture ||
            '';

          // Set basic user immediately so UI doesn't block.
          // Preserve a previously-resolved real organizationId across re-fires
          // of the auth event (e.g. INITIAL_SESSION / USER_UPDATED on tab
          // refocus) — otherwise it briefly snaps back to `local-…`, which
          // makes OrganizationContext's effect kick off a non-silent refetch
          // and ProtectedRoute(requireOrgAdmin) unmounts the current page.
          setUser((prev) => {
            const sameUser = prev?.userId === session.user.id;
            const prevOrgId = sameUser ? prev?.organizationId : undefined;
            const preservedOrgId =
              prevOrgId && !prevOrgId.startsWith('local-')
                ? prevOrgId
                : `local-${session.user.id}`;
            return {
              userId: session.user.id,
              email: session.user.email || '',
              displayName: sameUser ? prev?.displayName || displayName : displayName,
              photoURL: sameUser ? prev?.photoURL || photoURL : photoURL,
              provider: normalizeProvider(session.user.app_metadata?.provider),
              country: sameUser ? prev?.country || 'IN' : 'IN',
              role: sameUser ? prev?.role || 'user' : 'user',
              organizationId: preservedOrgId,
              organizationRole: sameUser ? prev?.organizationRole ?? null : null,
              createdAt: sameUser ? prev?.createdAt || new Date() : new Date(),
              lastLoginAt: new Date(),
              subscription: sameUser
                ? prev?.subscription || {
                    status: 'trial',
                    tier: null,
                    billingCycle: null,
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    currentPeriodStart: null,
                    currentPeriodEnd: null,
                    trialStartDate: new Date(),
                    trialEndDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
                    cancelAtPeriodEnd: false,
                  }
                : {
                    status: 'trial',
                    tier: null,
                    billingCycle: null,
                    stripeCustomerId: null,
                    stripeSubscriptionId: null,
                    currentPeriodStart: null,
                    currentPeriodEnd: null,
                    trialStartDate: new Date(),
                    trialEndDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
                    cancelAtPeriodEnd: false,
                  },
              metrics: sameUser
                ? prev?.metrics || {
                    projectsCreated: 0,
                    tasksCreated: 0,
                    lastActiveDate: new Date(),
                  }
                : {
                    projectsCreated: 0,
                    tasksCreated: 0,
                    lastActiveDate: new Date(),
                  },
            };
          });
          setLoading(false);

          // Defer all Supabase work so this handler returns before any async I/O. Running
          // await supabase... inside onAuthStateChange can hold the auth Web Lock too long
          // and triggers @supabase/gotrue-js "orphaned lock" recovery (Strict Mode / multi-tab).
          const userId = session.user.id;
          const userEmail = session.user.email || '';
          const provider = normalizeProvider(session.user.app_metadata?.provider);

          window.setTimeout(() => {
            if (!isMounted) return;
            void (async () => {
              try {
                if (event === 'SIGNED_IN') {
                  await createUserProfile(
                    userId,
                    userEmail,
                    displayName,
                    photoURL,
                    provider,
                  );
                }

                const orgId = await ensureOrganizationExists(
                  userId,
                  displayName,
                  userEmail,
                  photoURL,
                );

                if (!isMounted) return;

                if (orgId) {
                  setUser(prev => prev ? { ...prev, organizationId: orgId } : null);
                }

                const { data: profile } = await supabase
                  .from('user_profiles')
                  .select('organization_id, role, display_name, photo_url')
                  .eq('id', userId)
                  .maybeSingle();

                if (!isMounted) return;

                if (profile) {
                  setUser(prev => prev ? {
                    ...prev,
                    organizationId: profile.organization_id || orgId || prev.organizationId,
                    role: profile.role || 'user',
                    displayName: profile.display_name || prev.displayName,
                    photoURL: profile.photo_url || prev.photoURL,
                  } : null);
                }
              } catch (err) {
                console.error('❌ Auth setup failed:', err);
              }
            })();
          }, 0);

        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Verify current auth user outside auth state callback.
  // Prevents stale local sessions (deleted auth.users) from keeping app logged in.
  useEffect(() => {
    let cancelled = false;

    const verifyCurrentUser = async () => {
      if (!user) return;
      try {
        const { data: { user: verifiedUser }, error: verifyError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (verifyError || !verifiedUser) {
          console.warn('⚠️ Invalid local session detected, clearing auth state:', verifyError);
          await supabase.auth.signOut({ scope: 'local' }).catch(() => { });
          if (!cancelled) setUser(null);
        }
      } catch (err) {
        if (!cancelled) console.warn('⚠️ Session verification failed:', err);
      }
    };

    verifyCurrentUser();
    return () => { cancelled = true; };
  }, [user?.userId]);

  // Periodic token refresh every 45 minutes
  useEffect(() => {
    if (!user) return;
    const refreshInterval = setInterval(async () => {
      try {
        const isValid = await refreshTokenIfNeeded();
        if (!isValid) {
          await supabaseSignOut();
          setUser(null);
        }
      } catch (err) {
        console.error('❌ Periodic refresh error:', err);
      }
    }, 45 * 60 * 1000);
    return () => clearInterval(refreshInterval);
  }, [user]);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    setError(null);
    setAuthActionLoading(true);
    try {
      const newUser = await signUpWithEmail(email, password, displayName);
      setUser(newUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up');
      throw err;
    } finally {
      setAuthActionLoading(false);
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setAuthActionLoading(true);
    try {
      const loggedInUser = await signInWithEmail(email, password);
      setUser(loggedInUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      throw err;
    } finally {
      setAuthActionLoading(false);
    }
  }, []);

  const signInGoogle = useCallback(async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in with Google');
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await supabaseSignOut();
      setUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out');
      throw err;
    }
  }, []);

  const ensureValidSession = useCallback(async (): Promise<boolean> => {
    try {
      if (!user) return false;
      const isValid = await ensureValidSessionAuth();
      if (!isValid) { await signOut(); return false; }
      return true;
    } catch {
      return false;
    }
  }, [user, signOut]);

  const clearError = useCallback(() => setError(null), []);

  const refreshUser = useCallback(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) return;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id, role, display_name, photo_url')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (profile) {
      setUser(prev => prev ? {
        ...prev,
        organizationId: profile.organization_id || prev.organizationId,
        role: profile.role || prev.role,
        displayName: profile.display_name || prev.displayName,
        photoURL: profile.photo_url || prev.photoURL,
      } : null);
    }
  }, []);

  const updateUser = useCallback((data: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...data } : null);
  }, []);

  const derivedLoading = loading || authActionLoading;
  const contextValue = useMemo(() => ({
    user, loading: derivedLoading, error,
    signUp, signIn, signInGoogle, signOut,
    clearError, refreshUser, updateUser, ensureValidSession,
  }), [user, derivedLoading, error, signUp, signIn, signInGoogle, signOut, clearError, refreshUser, updateUser, ensureValidSession]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export default AuthContext;
