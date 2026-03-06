export type SubscriptionTier = "starter" | "basic" | "advanced" | "premium";
export type BillingCycle = "monthly" | "yearly";

export interface TierPricing {
  monthly: number;
  monthlyPromo: number | null;
  promoMonths: number;
  yearly: number | null;
  stripePriceIdMonthly: string;
  stripePriceIdMonthlyPromo: string | null;
  stripePriceIdYearly: string | null;
  maxUsers: number | null;
  extraUserPriceId: string | null;
  extraUserPrice: number | null;
  features: string[];
  // ✅ Enforce limits
  limits: {
    projects: number | null; // null = unlimited
    workspaces: number | null;
    teamMembers: number | null;
    tasksPerProject: number | null;
    storageGB: number | null; // null = unlimited, 0 = none
  };
}

export interface CountryPricing {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencySymbol: string;
  tiers: Record<SubscriptionTier, TierPricing>;
}

export interface UserSubscription {
  status: "trial" | "active" | "starter" | "cancelled" | "expired";
  tier: SubscriptionTier | null;
  billingCycle: BillingCycle | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  cancelAtPeriodEnd: boolean;
  promoMonthsUsed?: number;
}

export interface TrialInfo {
  isInTrial: boolean;
  daysRemaining: number;
  trialEndDate: Date;
}

// ── Shared limits (same for both IN and GB) ───────────────────────────
const TIER_LIMITS = {
  starter: {
    projects: 3,
    workspaces: 1,
    teamMembers: 1,
    tasksPerProject: 20,
    storageGB: 0,
  },
  basic: {
    projects: 15,
    workspaces: 3,
    teamMembers: 3,
    tasksPerProject: null, // unlimited
    storageGB: 5,
  },
  advanced: {
    projects: null, // unlimited
    workspaces: 10,
    teamMembers: 10,
    tasksPerProject: null,
    storageGB: 20,
  },
  premium: {
    projects: null,
    workspaces: null,
    teamMembers: null,
    tasksPerProject: null,
    storageGB: null,
  },
} as const;

// ── Shared features text ──────────────────────────────────────────────
const TIER_FEATURES = {
  starter: [
    "3 Projects",
    "20 Tasks per project",
    "1 Workspace",
    "1 Team member (solo)",
    "Basic task management",
    "Community support",
  ],
  basic: [
    "15 Projects",
    "Unlimited tasks",
    "3 Workspaces",
    "Up to 3 team members",
    "5GB File storage",
    "AI assistant",
    "Time tracking & tags",
    "Task dependencies & subtasks",
    "Email support",
  ],
  advanced: [
    "Unlimited projects",
    "Unlimited tasks",
    "10 Workspaces",
    "Up to 10 team members",
    "20GB File storage",
    "Everything in Basic",
    "Team collaboration",
    "Advanced analytics",
    "Timeline & Contracts",
    "Priority support",
  ],
  premium: [
    "Unlimited everything",
    "Unlimited workspaces",
    "Unlimited team members",
    "Unlimited storage",
    "Everything in Advanced",
    "Dedicated account manager",
    "Custom integrations & API",
    "SLA & uptime guarantee",
    "Custom onboarding",
    "Advanced security & compliance",
  ],
};

// ── GBP Pricing (UK / International) ─────────────────────────────────
export const DEFAULT_PRICING: CountryPricing = {
  countryCode: "GB",
  countryName: "United Kingdom",
  currencyCode: "GBP",
  currencySymbol: "£",
  tiers: {
    starter: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: 1,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.starter,
      limits: TIER_LIMITS.starter,
    },
    basic: {
      monthly: 7.99,
      monthlyPromo: 5.0,
      promoMonths: 3,
      yearly: 63.9,
      stripePriceIdMonthly: "price_1T3vC8LO5VzuKq5JaUIqTuDI",
      stripePriceIdMonthlyPromo: "price_1T3v8jLO5VzuKq5JlXhdW32Y",
      stripePriceIdYearly: "price_1T3vC8LO5VzuKq5Jlw1bCVbK",
      maxUsers: 3,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.basic,
      limits: TIER_LIMITS.basic,
    },
    advanced: {
      monthly: 50.0,
      monthlyPromo: 45.0,
      promoMonths: 1,
      yearly: 480.0,
      stripePriceIdMonthly: "price_1T3vG3LO5VzuKq5J6cdaNPRe",
      stripePriceIdMonthlyPromo: "price_1T3vEXLO5VzuKq5JC1bzFxws",
      stripePriceIdYearly: "price_1T3vG3LO5VzuKq5JuBDrJah6",
      maxUsers: 10,
      extraUserPriceId: "price_1T3vHTLO5VzuKq5Jmr3IZYcy",
      extraUserPrice: 2.99,
      features: TIER_FEATURES.advanced,
      limits: TIER_LIMITS.advanced,
    },
    premium: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: null,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.premium,
      limits: TIER_LIMITS.premium,
    },
  },
};

// ── USD Pricing (USA) ─────────────────────────────────────────────────
// Create Products & Prices in Stripe (USD), then replace the price_xxx IDs below.
export const USA_PRICING: CountryPricing = {
  countryCode: "US",
  countryName: "United States",
  currencyCode: "USD",
  currencySymbol: "$",
  tiers: {
    starter: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: 1,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.starter,
      limits: TIER_LIMITS.starter,
    },
    basic: {
      monthly: 9.99,
      monthlyPromo: 5.99,
      promoMonths: 3,
      yearly: 95.88,
      stripePriceIdMonthly: "price_US_BASIC_MONTHLY", // Replace with your Stripe Price ID (USD)
      stripePriceIdMonthlyPromo: "price_US_BASIC_PROMO", // Replace with your Stripe Price ID (USD)
      stripePriceIdYearly: "price_US_BASIC_YEARLY", // Replace with your Stripe Price ID (USD)
      maxUsers: 3,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.basic,
      limits: TIER_LIMITS.basic,
    },
    advanced: {
      monthly: 59.99,
      monthlyPromo: 49.99,
      promoMonths: 1,
      yearly: 575.88,
      stripePriceIdMonthly: "price_US_ADVANCED_MONTHLY", // Replace with your Stripe Price ID (USD)
      stripePriceIdMonthlyPromo: "price_US_ADVANCED_PROMO",
      stripePriceIdYearly: "price_US_ADVANCED_YEARLY",
      maxUsers: 10,
      extraUserPriceId: "price_US_ADVANCED_EXTRA_USER", // Replace if you sell extra seats
      extraUserPrice: 5.99,
      features: TIER_FEATURES.advanced,
      limits: TIER_LIMITS.advanced,
    },
    premium: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: null,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.premium,
      limits: TIER_LIMITS.premium,
    },
  },
};

// ── INR Pricing (India) ───────────────────────────────────────────────
export const INDIA_PRICING: CountryPricing = {
  countryCode: "IN",
  countryName: "India",
  currencyCode: "INR",
  currencySymbol: "₹",
  tiers: {
    starter: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: 1,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.starter,
      limits: TIER_LIMITS.starter,
    },
    basic: {
      monthly: 299,
      monthlyPromo: 99,
      promoMonths: 3,
      yearly: 11499,
      stripePriceIdMonthly: "price_1T5gi3LO5VzuKq5JsqMJ23nD",
      stripePriceIdMonthlyPromo: "price_1T5gkrLO5VzuKq5JrsepV2Qd",
      stripePriceIdYearly: "price_1T5gkrLO5VzuKq5JDCSUNMt7",
      maxUsers: 3,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.basic,
      limits: TIER_LIMITS.basic,
    },
    advanced: {
      monthly: 999,
      monthlyPromo: 499,
      promoMonths: 1,
      yearly: 5990,
      stripePriceIdMonthly: "price_1T5gobLO5VzuKq5JPipiXAMl",
      stripePriceIdMonthlyPromo: "price_1T5gnTLO5VzuKq5Jjf2Gq2tE",
      stripePriceIdYearly: "price_1T5gpOLO5VzuKq5JbOZ3z3M8",
      maxUsers: 10,
      extraUserPriceId: "price_1T5gq5LO5VzuKq5JK5rspGkG",
      extraUserPrice: 59,
      features: TIER_FEATURES.advanced,
      limits: TIER_LIMITS.advanced,
    },
    premium: {
      monthly: 0,
      monthlyPromo: null,
      promoMonths: 0,
      yearly: null,
      stripePriceIdMonthly: "",
      stripePriceIdMonthlyPromo: null,
      stripePriceIdYearly: null,
      maxUsers: null,
      extraUserPriceId: null,
      extraUserPrice: null,
      features: TIER_FEATURES.premium,
      limits: TIER_LIMITS.premium,
    },
  },
};
