import {
  CountryPricing,
  DEFAULT_PRICING,
  INDIA_PRICING,
} from "@/types/subscription";

export function getPricingForCountry(countryCode: string): CountryPricing {
  if (countryCode === "IN") return INDIA_PRICING;
  return DEFAULT_PRICING;
}
