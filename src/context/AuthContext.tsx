import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/services/supabase/config';
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
      await supabase
        .from('user_profiles')
        .update({ organization_id: existingOrgId })
        .eq('id', userId);
      return existingOrgId;
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
      async (event, session) => {
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

          // Set basic user immediately so UI doesn't block
          setUser({
            userId: session.user.id,
            email: session.user.email || '',
            displayName,
            photoURL,
            provider: normalizeProvider(session.user.app_metadata?.provider),
            country: 'IN',
            role: 'user',
            organizationId: `local-${session.user.id}`,
            organizationRole: null,
            createdAt: new Date(),
            lastLoginAt: new Date(),
            subscription: {
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
            metrics: {
              projectsCreated: 0,
              tasksCreated: 0,
              lastActiveDate: new Date(),
            },
          });
          setLoading(false);

          // ✅ Single sequential async block — no race condition
          (async () => {
            try {
              // Step 1: create/update profile
              if (event === 'SIGNED_IN') {
                await createUserProfile(
                  session.user.id,
                  session.user.email || '',
                  displayName,
                  photoURL,
                  normalizeProvider(session.user.app_metadata?.provider),
                );
                console.log('✅ Profile created/updated');
              }

              // Step 2: ensure org exists (always, not just on SIGNED_IN)
              // This handles existing users who were missing an org
              const orgId = await ensureOrganizationExists(
                session.user.id,
                displayName,
                session.user.email || '',
                photoURL,
              );

              if (!isMounted) return;

              if (orgId) {
                setUser(prev => prev ? { ...prev, organizationId: orgId } : null);
                // console.log('✅ Org ensured:', orgId);
              }

              // Step 3: load full profile data to get role + display name
              const { data: profile } = await supabase
                .from('user_profiles')
                .select('organization_id, role, display_name, photo_url')
                .eq('id', session.user.id)
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

  return (
    <AuthContext.Provider value={{
      user, loading: loading || authActionLoading, error,
      signUp, signIn, signInGoogle, signOut,
      clearError, refreshUser, updateUser, ensureValidSession,
    }}>
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
