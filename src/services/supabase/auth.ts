import { supabase } from "./config";
import { User, UserSubscription } from "@/types";
import { logger } from "@/lib/logger";
import { SubscriptionTier, BillingCycle } from "@/types/subscription";

export const getUserCountry = async (): Promise<string> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch("https://api.country.is/", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    return data.country || "US";
  } catch {
    return "US";
  }
};

const createInitialSubscription = (): UserSubscription => {
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000); // ✅ 28 days
  return {
    status: "trial",
    tier: null,
    billingCycle: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialStartDate: now,
    trialEndDate: trialEnd,
    cancelAtPeriodEnd: false,
  };
};

// Helper function to detect provider from Supabase user
const getProviderFromSupabaseUser = (
  user: any,
): "email" | "google" | "apple" => {
  const provider =
    user.app_metadata?.provider || user.identities?.[0]?.provider;

  if (provider === "google") return "google";
  if (provider === "apple") return "apple";
  return "email";
};

export const createUserProfile = async (
  userId: string,
  email: string,
  displayName: string,
  photoURL?: string,
  provider?: "email" | "google" | "apple",
): Promise<User> => {
  try {
    // Check if user profile already exists
    const { data: existingProfile, error: profileReadError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileReadError) {
      logger.warn("Failed reading existing profile:", profileReadError);
    }

    if (existingProfile) {
      // Update last login
      await supabase
        .from("user_profiles")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", userId);

      // Get auth user to determine provider
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      const detectedProvider = authUser
        ? getProviderFromSupabaseUser(authUser)
        : "email";

      return {
        userId: existingProfile.id,
        email: email || existingProfile.email || "",
        displayName: existingProfile.display_name || "User",
        photoURL: existingProfile.photo_url || "",
        provider: detectedProvider,
        country: "US",
        role: existingProfile.role || "user",
        organizationId: existingProfile.organization_id || `local-${userId}`,
        organizationRole: null,
        createdAt: new Date(existingProfile.created_at),
        lastLoginAt: new Date(),
        subscription: createInitialSubscription(),
        metrics: {
          projectsCreated: 0,
          tasksCreated: 0,
          lastActiveDate: new Date(),
        },
      } as User;
    }

    // Create new user profile
    // Fetch country asynchronously in background (don't block)
    const countryPromise = getUserCountry().catch(() => "US");

    const now = new Date();

    const newUser: User = {
      userId,
      email,
      displayName,
      photoURL: photoURL || "",
      provider: provider || "email",
      country: "US",
      role: "user",
      organizationId: `local-${userId}`,
      organizationRole: null,
      createdAt: now,
      lastLoginAt: now,
      subscription: createInitialSubscription(),
      metrics: {
        projectsCreated: 0,
        tasksCreated: 0,
        lastActiveDate: now,
      },
    };

    try {
      const trialStart = now;
      const trialEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);

      // Some DB setups auto-create a row with schema defaults (plan='trial', status='active').
      // Normalize that row to the app's expected onboarding state.
      const { data: existingSub } = await supabase
        .from("subscriptions")
        .select("user_id, plan, status, stripe_subscription_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!existingSub) {
        const { error: subInsertError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: userId,
            status: "trial",
            plan: "advanced",
            billing_cycle: null,
            trial_starts_at: trialStart.toISOString(),
            trial_ends_at: trialEnd.toISOString(),
            cancel_at_period_end: false,
          });

        if (subInsertError) {
          logger.error(
            "❌ Subscription insert failed:",
            JSON.stringify(subInsertError),
          );
        } else {
          logger.log("✅ Advanced trial created for:", userId);
        }
      } else if (
        !existingSub.stripe_subscription_id &&
        (existingSub.plan === "trial" ||
          existingSub.plan === null ||
          existingSub.status === "active")
      ) {
        const { error: subFixError } = await supabase
          .from("subscriptions")
          .update({
            status: "trial",
            plan: "advanced",
            billing_cycle: null,
            trial_starts_at: trialStart.toISOString(),
            trial_ends_at: trialEnd.toISOString(),
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        if (subFixError) {
          logger.error(
            "❌ Subscription normalization failed:",
            JSON.stringify(subFixError),
          );
        } else {
          logger.log("✅ Existing subscription normalized to advanced trial:", userId);
        }
      } else {
        logger.log("ℹ️ Keeping existing subscription as-is for:", userId);
      }
    } catch (err) {
      logger.error("❌ Subscription setup exception:", err);
    }

    // Update country in background after user is created
    countryPromise.then((country) => {
      if (country && country !== "US") {
        // Fire and forget - don't await, update happens in background
        void supabase
          .from("user_profiles")
          .update({ country })
          .eq("id", userId);
      }
    });

    return newUser;
  } catch (error) {
    logger.warn("createUserProfile error:", error);
    // Return basic user object
    return {
      userId,
      email,
      displayName,
      photoURL: photoURL || "",
      provider: "email",
      country: "US",
      role: "user",
      organizationId: `local-${userId}`,
      organizationRole: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      subscription: createInitialSubscription(),
      metrics: {
        projectsCreated: 0,
        tasksCreated: 0,
        lastActiveDate: new Date(),
      },
    };
  }
};

export const signUpWithEmail = async (
  email: string,
  password: string,
  displayName: string,
): Promise<User> => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (error) throw error;
    if (!data.user) throw new Error("No user returned from signup");

    // Supabase can return an obfuscated user when email already exists.
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error("This email is already registered. Please sign in instead.");
    }

    return createUserProfile(
      data.user.id,
      email,
      displayName,
      undefined,
      "email",
    );
  } catch (error: any) {
    const errorMessages: Record<string, string> = {
      "User already registered":
        "This email is already registered. Please sign in instead.",
      "Invalid email": "Please enter a valid email address.",
      "Password should be at least 6 characters":
        "Password must be at least 6 characters long.",
    };

    const message =
      errorMessages[error.message] ||
      error.message ||
      "Failed to create account";
    throw new Error(message);
  }
};

export const signInWithEmail = async (
  email: string,
  password: string,
): Promise<User> => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  if (!data.user) throw new Error("No user returned from sign in");

  const displayName =
    data.user.user_metadata?.display_name ||
    data.user.email?.split("@")[0] ||
    "User";

  // Try to get existing profile
  let profile = await getUserProfile(data.user.id);

  // If no profile exists, create one
  if (!profile) {
    console.log("No profile found, creating one...");
    profile = await createUserProfile(
      data.user.id,
      data.user.email!,
      displayName,
      data.user.user_metadata?.avatar_url,
      "email",
    );
  }

  return profile;
};

export const signInWithGoogle = async (): Promise<void> => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });

  if (error) throw error;
};

export const signOut = async (): Promise<void> => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const getCurrentUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

export const onAuthChange = (callback: (user: any) => void) => {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (_event, session) => {
    callback(session?.user || null);
  });

  return () => subscription.unsubscribe();
};

export const getUserProfile = async (userId: string): Promise<User | null> => {
  try {
    // First, get the auth user for email
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("getUserProfile error:", error);

      // If profile doesn't exist, return a basic user object
      if (authUser) {
        return {
          userId: authUser.id,
          email: authUser.email || "",
          displayName:
            authUser.user_metadata?.display_name ||
            authUser.email?.split("@")[0] ||
            "User",
          photoURL: authUser.user_metadata?.avatar_url || "",
          provider: "email",
          country: "US",
          role: "user",
          organizationId: `local-${authUser.id}`,
          organizationRole: null,
          createdAt: new Date(),
          lastLoginAt: new Date(),
          subscription: {
            status: "trial",
            tier: null,
            billingCycle: null,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            trialStartDate: new Date(),
            trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            cancelAtPeriodEnd: false,
          },
          metrics: {
            projectsCreated: 0,
            tasksCreated: 0,
            lastActiveDate: new Date(),
          },
        } as User;
      }
      return null;
    }

    if (!data) return null;

    // Get email from auth user since it might not be in user_profiles
    const email = authUser?.email || data.email || "";

    // Convert from database format to User type
    return {
      userId: data.id,
      email: email,
      displayName: data.display_name || "User",
      photoURL: data.photo_url || "",
      provider: "email",
      country: "US",
      role: data.role || "user",
      organizationId: data.organization_id || `local-${userId}`,
      organizationRole: null,
      createdAt: new Date(data.created_at),
      lastLoginAt: new Date(data.updated_at),
      subscription: {
        status: "trial",
        tier: null,
        billingCycle: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialStartDate: new Date(),
        trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      },
      metrics: {
        projectsCreated: 0,
        tasksCreated: 0,
        lastActiveDate: new Date(),
      },
    } as User;
  } catch (err) {
    console.error("getUserProfile exception:", err);
    return null;
  }
};

export const updateUserProfile = async (
  userId: string,
  data: Partial<User>,
): Promise<void> => {
  const updateData: any = {};

  if (data.displayName) updateData.display_name = data.displayName;
  if (data.photoURL) updateData.photo_url = data.photoURL;
  if (data.organizationId) updateData.organization_id = data.organizationId;

  await supabase.from("user_profiles").update(updateData).eq("id", userId);
};

export const updateProfilePhoto = async (
  userId: string,
  photoURL: string,
): Promise<void> => {
  // Update in Supabase Auth
  await supabase.auth.updateUser({
    data: { avatar_url: photoURL },
  });

  // Update in user_profiles table
  await supabase
    .from("user_profiles")
    .update({ photo_url: photoURL })
    .eq("id", userId);
};

export const changePassword = async (newPassword: string): Promise<void> => {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
};

export const deleteUserAccount = async (): Promise<void> => {
  // Supabase doesn't allow client-side user deletion
  // You'll need to create an Edge Function for this
  throw new Error("Account deletion must be done through support");
};

export const updateUserSubscription = async (
  userId: string,
  tier: SubscriptionTier,
  billingCycle: BillingCycle,
): Promise<void> => {
  const now = new Date();
  const periodEnd = new Date(now);

  if (billingCycle === "monthly") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  await supabase.from("subscriptions").upsert({
    user_id: userId,
    plan: tier,
    status: "active",
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
  });
};

export const setUserCancelAtPeriodEnd = async (
  userId: string,
  cancelAtPeriodEnd: boolean,
): Promise<void> => {
  await supabase
    .from("subscriptions")
    .update({ cancel_at_period_end: cancelAtPeriodEnd })
    .eq("user_id", userId);
};

// ✅ 1. Token refresh helper - checks and refreshes if needed
export const refreshTokenIfNeeded = async (): Promise<boolean> => {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      logger.error("Session check failed:", error);
      return false;
    }

    if (!session) {
      logger.warn("No active session found");
      return false;
    }

    // Check if token is close to expiry (within 5 minutes)
    const expiresAt = session.expires_at || 0;
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - now;

    if (timeUntilExpiry < 300) {
      // Less than 5 minutes
      logger.log("Token expiring soon, refreshing...");
      const { data, error: refreshError } =
        await supabase.auth.refreshSession();

      if (refreshError) {
        logger.error("Token refresh failed:", refreshError);
        return false;
      }

      if (!data.session) {
        logger.error("No session returned after refresh");
        return false;
      }

      logger.log("✅ Token refreshed successfully");
      return true;
    }

    logger.log("Token still valid");
    return true;
  } catch (err) {
    logger.error("Token refresh error:", err);
    return false;
  }
};

// ✅ 2. Ensure valid session before operations
export const ensureValidSession = async (): Promise<boolean> => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      logger.warn("No session available");
      return false;
    }

    // Check token expiry
    const expiresAt = session.expires_at || 0;
    const now = Math.floor(Date.now() / 1000);

    if (expiresAt <= now) {
      logger.warn("Session expired, attempting refresh...");
      return await refreshTokenIfNeeded();
    }

    // Refresh if within 5 minutes of expiry
    if (expiresAt - now < 300) {
      logger.log("Session expiring soon, proactive refresh...");
      return await refreshTokenIfNeeded();
    }

    return true;
  } catch (err) {
    logger.error("Session validation failed:", err);
    return false;
  }
};

// ✅ 3. Wrapper for operations that need valid auth
export const withValidSession = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const isValid = await ensureValidSession();

  if (!isValid) {
    throw new Error("Session invalid or expired. Please sign in again.");
  }

  try {
    return await operation();
  } catch (error: any) {
    // If operation fails due to auth, try one refresh and retry
    if (
      error?.message?.includes("JWT") ||
      error?.message?.includes("token") ||
      error?.message?.includes("auth")
    ) {
      logger.warn("Auth error detected, attempting token refresh...");
      const refreshed = await refreshTokenIfNeeded();

      if (refreshed) {
        // Retry the operation once
        return await operation();
      }
    }
    throw error;
  }
};
