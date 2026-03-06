import {
  CountryPricing,
  DEFAULT_PRICING,
  INDIA_PRICING,
  USA_PRICING,
} from "@/types/subscription";

/**
 * Region-based pricing:
 * - IN (India)  → INR (₹)
 * - US (USA)    → USD ($)
 * - GB + others → GBP (£) — UK / International
 */
export function getPricingForCountry(countryCode: string): CountryPricing {
  if (countryCode === "IN") return INDIA_PRICING;
  if (countryCode === "US") return USA_PRICING;
  return DEFAULT_PRICING; // GB, and all other countries → UK (GBP)
}
