import {
  CountryPricing,
  DEFAULT_PRICING,
  EUR_PRICING,
  INDIA_PRICING,
  USA_PRICING,
} from "@/types/subscription";

/** Eurozone + European microstates that use Euro → EUR pricing */
const EURO_COUNTRY_CODES = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK", "AD", "MC", "SM", "VA", "XK",
]);

/**
 * Region-based pricing:
 * - US (USA)           → USD ($)
 * - IN (India)          → INR (₹)
 * - GB (UK)             → GBP (£)
 * - European countries  → EUR (€)
 * - Others              → GBP (£) as default
 */
export function getPricingForCountry(countryCode: string): CountryPricing {
  const code = (countryCode || "").toUpperCase();
  if (code === "US") return USA_PRICING;
  if (code === "IN") return INDIA_PRICING;
  if (code === "GB") return DEFAULT_PRICING; // GBP
  if (EURO_COUNTRY_CODES.has(code)) return EUR_PRICING;
  return DEFAULT_PRICING; // Fallback: GBP for rest of world
}
