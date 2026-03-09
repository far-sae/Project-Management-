import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { supabase } from "@/services/supabase/config";
import { useAuth } from "./AuthContext";
import { useOrganization } from "./OrganizationContext";
import {
  UserSubscription,
  CountryPricing,
  DEFAULT_PRICING,
  TrialInfo,
  SubscriptionTier,
} from "@/types";
import { detectUserCountry, GeoLocation } from "@/services/geolocation";
import { getPricingForCountry } from "@/services/geolocation/pricing-data";
import { isAppOwner } from "@/lib/app-owner";

export type AppFeature =
  | "unlimited_projects"
  | "unlimited_tasks"
  | "file_attachments"
  | "team_collaboration"
  | "advanced_analytics"
  | "timeline_overview"
  | "contracts"
  | "ai_assistant"
  | "reports"
  | "api_access"
  | "custom_integrations";

// ── Subscription flow ────────────────────────────────────────────────
// 1. First login: no subscription row → we create one with 28-day trial (Advanced access).
// 2. After 28 days: if not subscribed, we auto-downgrade to Starter (DB + UI).
// 3. Starter: only Starter limits/features (see FEATURE_TIERS — starter not in paid features).
// 4. When user subscribes (Stripe): webhook/checkout sets status=active, plan=basic|advanced|premium; we read that and grant that plan's features.
// ── Trial = full Advanced access for 28 days ──────────────────────────
// ── Starter = free forever, limited features only ────────────────────
// ── Lock: Basic = projects/tasks/workspaces/members/storage/AI/reports only; Advanced+ = + Team, Timeline, Contracts, Analytics; Premium = + API & custom integrations ──
const FEATURE_TIERS: Record<AppFeature, Array<SubscriptionTier | "trial" | "starter">> = {
  unlimited_projects: ["trial", "basic", "advanced", "premium"],
  unlimited_tasks: ["trial", "basic", "advanced", "premium"],
  file_attachments: ["trial", "basic", "advanced", "premium"],
  ai_assistant: ["trial", "basic", "advanced", "premium"],
  reports: ["trial", "basic", "advanced", "premium"],
  team_collaboration: ["trial", "advanced", "premium"],
  advanced_analytics: ["trial", "advanced", "premium"],
  timeline_overview: ["trial", "advanced", "premium"],
  contracts: ["trial", "advanced", "premium"],
  api_access: ["premium"],
  custom_integrations: ["premium"],
};

interface SubscriptionContextType {
  subscription: UserSubscription | null;
  pricing: CountryPricing;
  trialInfo: TrialInfo | null;
  loading: boolean;
  isSubscribed: boolean;
  canAccessFeatures: boolean;
  hasFeature: (feature: AppFeature) => boolean;
  currentTier: SubscriptionTier | "trial" | "starter" | null;
  refreshSubscription: () => Promise<void>;
  userLocation: GeoLocation | null;
  refreshPricing: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode; }> = ({ children }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const isOrgOwner = Boolean(user?.userId && organization?.ownerId === user.userId);
  const isAppOwnerUser = isAppOwner(user?.userId ?? null);
  const hasFullAccess = isOrgOwner || isAppOwnerUser;
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [pricing, setPricing] = useState<CountryPricing>(DEFAULT_PRICING);
  const [userLocation, setUserLocation] = useState<GeoLocation | null>(null);
  const [loading, setLoading] = useState(true);

  const userIdRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);

  // ── Main fetch + expiry check ────────────────────────────────────────
  const fetchSub = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;

    try {
      const { data: fetched, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.error("Subscription fetch error:", error);
        return;
      }

      let row = fetched;

      // ── No row exists: first-time login → start 28-day trial ─────────
      if (!row) {
        const now = new Date();
        const trialEnd = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
        const { error: insertError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: uid,
            status: "trial",
            plan: "advanced",
            billing_cycle: null,
            trial_starts_at: now.toISOString(),
            trial_ends_at: trialEnd.toISOString(),
            cancel_at_period_end: false,
          });

        if (insertError) {
          console.warn("⚠️ Could not create trial row (RLS?):", insertError.message);
          setSubscription(null);
          return;
        }
        const { data: newRow } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();
        row = newRow ?? null;
        if (!row) {
          setSubscription(null);
          return;
        }
      }

      let effectiveStatus = row.status;
      let effectivePlan = row.plan;

      // ── Frontend safety net: after 28 days, auto-downgrade trial → starter ─
      if (row.status === "trial" && row.trial_ends_at) {
        const trialEnd = new Date(row.trial_ends_at);
        if (trialEnd < new Date()) {
          console.log("⏰ Trial expired — downgrading to starter in DB...");
          const { error: updateError } = await supabase
            .from("subscriptions")
            .update({
              status: "starter",
              plan: "starter",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", uid);

          if (updateError) {
            console.error("❌ Failed to downgrade to starter:", updateError);
          } else {
            console.log("✅ Downgraded to starter successfully");
            effectiveStatus = "starter";
            effectivePlan = "starter";
          }
        }
      }

      // ── Set subscription state (trial / starter / active from paid plan) ─
      setSubscription({
        status: effectiveStatus || "trial",
        tier: effectivePlan || null,
        billingCycle: row.billing_cycle || null,
        stripeCustomerId: row.stripe_customer_id || null,
        stripeSubscriptionId: row.stripe_subscription_id || null,
        currentPeriodStart: row.current_period_start
          ? new Date(row.current_period_start) : null,
        currentPeriodEnd: row.current_period_end
          ? new Date(row.current_period_end) : null,
        trialStartDate: row.trial_starts_at
          ? new Date(row.trial_starts_at) : null,
        trialEndDate: row.trial_ends_at
          ? new Date(row.trial_ends_at) : null,
        cancelAtPeriodEnd: row.cancel_at_period_end || false,
      });

    } catch (err) {
      console.error("fetchSub error:", err);
    } finally {
      setLoading(false);
    }
  }, []); // zero deps — reads uid from ref

  // ── Re-run only when userId changes ─────────────────────────────────
  useEffect(() => {
    const uid = user?.userId ?? null;

    if (!uid) {
      userIdRef.current = null;
      setSubscription(null);
      setLoading(false);
      return;
    }

    if (userIdRef.current === uid) return; // same user, skip

    userIdRef.current = uid;
    setLoading(true);
    fetchSub();

    // Clean up old realtime channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Realtime listener — re-fetch whenever subscription row changes
    const channel = supabase
      .channel(`sub-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${uid}` },
        () => {
          console.log("🔄 Subscription row changed — refetching...");
          fetchSub();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.userId, fetchSub]);

  // ── Geo-based pricing ────────────────────────────────────────────────
  const fetchPricingByLocation = useCallback(async () => {
    try {
      const location = await detectUserCountry();
      setUserLocation(location);
      setPricing(getPricingForCountry(location.countryCode));
      console.log("🌍 Pricing loaded for:", location.countryCode);
    } catch {
      console.warn("⚠️ Geo detection failed, using default pricing");
      setPricing(DEFAULT_PRICING);
    }
  }, []);

  useEffect(() => {
    fetchPricingByLocation();
  }, [fetchPricingByLocation]);

  // ── Derived values ────────────────────────────────────────────────────
  // Expired/cancelled = treat as Starter so paid features are locked; only Starter limits apply.
  const currentTier: SubscriptionTier | "trial" | "starter" | null =
    subscription?.status === "active" ? (subscription.tier as SubscriptionTier)
      : subscription?.status === "trial" ? "trial"
        : subscription?.status === "starter" || subscription?.status === "expired" || subscription?.status === "cancelled" ? "starter"
          : subscription === null ? "trial"
            : null;

  const hasFeature = useCallback(
    (feature: AppFeature) =>
      hasFullAccess || (!!currentTier && FEATURE_TIERS[feature].includes(currentTier as any)),
    [currentTier, hasFullAccess],
  );

  // ── Trial info ────────────────────────────────────────────────────────
  const trialEndTs = subscription?.trialEndDate?.getTime() ?? 0;
  const trialInfo: TrialInfo | null =
    subscription?.status === "trial"
      ? {
        isInTrial: trialEndTs > Date.now(),
        daysRemaining: Math.max(0, Math.ceil((trialEndTs - Date.now()) / 86_400_000)),
        trialEndDate: new Date(trialEndTs > 0 ? trialEndTs : Date.now() + 28 * 86_400_000),
      }
      : null;

  // ── canAccessFeatures logic ───────────────────────────────────────────
  // Allow using the app; actual features are gated by hasFeature(currentTier). Expired/cancelled = Starter only.
  const canAccessFeatures =
    hasFullAccess
    || loading
    || subscription === null
    || subscription.status === "trial"
    || subscription.status === "active"
    || subscription.status === "starter"
    || subscription.status === "expired"
    || subscription.status === "cancelled";

  const value: SubscriptionContextType = {
    subscription,
    pricing,
    trialInfo,
    loading,
    isSubscribed: subscription?.status === "active",
    canAccessFeatures,
    hasFeature,
    currentTier,
    refreshSubscription: fetchSub,
    userLocation,
    refreshPricing: fetchPricingByLocation,
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
};

export default SubscriptionContext;
