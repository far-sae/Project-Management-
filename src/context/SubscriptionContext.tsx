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
import {
  UserSubscription,
  CountryPricing,
  DEFAULT_PRICING,
  TrialInfo,
  SubscriptionTier,
} from "@/types";
import { detectUserCountry, GeoLocation } from "@/services/geolocation";
import { getPricingForCountry } from "@/services/geolocation/pricing-data";

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

// ── Trial = full Advanced access for 28 days ──────────────────────────
// ── Starter = free forever, no paid features ─────────────────────────
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
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.error("Subscription fetch error:", error);
        return;
      }

      // ── No row exists yet ───────────────────────────────────────────
      if (!data) {
        console.warn("⚠️ No subscription row found for user:", uid);
        setSubscription(null);
        return;
      }

      // ── Frontend safety net: fix expired trial immediately ──────────
      if (data.status === "trial" && data.trial_ends_at) {
        const trialEnd = new Date(data.trial_ends_at);
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
            // Override data before setting state
            data.status = "starter";
            data.plan = "starter";
          }
        }
      }

      // ── Set subscription state ──────────────────────────────────────
      setSubscription({
        status: data.status || "trial",
        tier: data.plan || null,
        billingCycle: data.billing_cycle || null,
        stripeCustomerId: data.stripe_customer_id || null,
        stripeSubscriptionId: data.stripe_subscription_id || null,
        currentPeriodStart: data.current_period_start
          ? new Date(data.current_period_start) : null,
        currentPeriodEnd: data.current_period_end
          ? new Date(data.current_period_end) : null,
        trialStartDate: data.trial_starts_at
          ? new Date(data.trial_starts_at) : null,
        trialEndDate: data.trial_ends_at
          ? new Date(data.trial_ends_at) : null,
        cancelAtPeriodEnd: data.cancel_at_period_end || false,
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
  const currentTier: SubscriptionTier | "trial" | "starter" | null =
    subscription?.status === "active" ? (subscription.tier as SubscriptionTier)
      : subscription?.status === "trial" ? "trial"
        : subscription?.status === "starter" ? "starter"
          : subscription === null ? "trial"
            : null;

  const hasFeature = useCallback(
    (feature: AppFeature) =>
      !!currentTier && FEATURE_TIERS[feature].includes(currentTier as any),
    [currentTier],
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
  // Block ONLY when: loaded + has a row + status is cancelled/expired
  const canAccessFeatures =
    loading                                  // still fetching  → allow (avoid flash)
    || subscription === null                 // no row yet      → allow (new signup)
    || subscription.status === "trial"       // in trial        → allow
    || subscription.status === "active"      // paid plan       → allow
    || subscription.status === "starter";    // free starter    → allow (FeatureGate handles limits)

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
