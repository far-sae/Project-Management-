/**
 * Country + currency reference list for the organization settings picker.
 *
 * Phase 1 of the multi-currency story: the owner picks a country, and we
 * default the org's currency to that country's local one. Existing entries
 * keep whatever currency they were entered in — only *new* expenses,
 * contracts, payslips, etc. pick up the new default.
 *
 * The list deliberately covers the largest 60-ish economies plus a few
 * smaller ones we've seen demand for, with ISO-4217 currency codes. It is
 * not exhaustive (there are ~250 countries / territories); anyone outside
 * this list can keep using the manual currency override.
 */

export interface CountryEntry {
  /** ISO-3166-1 alpha-2 (e.g. "GB"). */
  code: string;
  name: string;
  /** ISO-4217 (e.g. "GBP"). */
  currency: string;
}

export const COUNTRIES: CountryEntry[] = [
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'AR', name: 'Argentina', currency: 'ARS' },
  { code: 'AT', name: 'Austria', currency: 'EUR' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT' },
  { code: 'BE', name: 'Belgium', currency: 'EUR' },
  { code: 'BR', name: 'Brazil', currency: 'BRL' },
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF' },
  { code: 'CL', name: 'Chile', currency: 'CLP' },
  { code: 'CN', name: 'China', currency: 'CNY' },
  { code: 'CO', name: 'Colombia', currency: 'COP' },
  { code: 'CZ', name: 'Czech Republic', currency: 'CZK' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'DK', name: 'Denmark', currency: 'DKK' },
  { code: 'EG', name: 'Egypt', currency: 'EGP' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'FI', name: 'Finland', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'GR', name: 'Greece', currency: 'EUR' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD' },
  { code: 'HU', name: 'Hungary', currency: 'HUF' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'IL', name: 'Israel', currency: 'ILS' },
  { code: 'IN', name: 'India', currency: 'INR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'KE', name: 'Kenya', currency: 'KES' },
  { code: 'KR', name: 'South Korea', currency: 'KRW' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR' },
  { code: 'MA', name: 'Morocco', currency: 'MAD' },
  { code: 'MX', name: 'Mexico', currency: 'MXN' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'NO', name: 'Norway', currency: 'NOK' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { code: 'PE', name: 'Peru', currency: 'PEN' },
  { code: 'PH', name: 'Philippines', currency: 'PHP' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR' },
  { code: 'PL', name: 'Poland', currency: 'PLN' },
  { code: 'PT', name: 'Portugal', currency: 'EUR' },
  { code: 'QA', name: 'Qatar', currency: 'QAR' },
  { code: 'RO', name: 'Romania', currency: 'RON' },
  { code: 'RU', name: 'Russia', currency: 'RUB' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR' },
  { code: 'SE', name: 'Sweden', currency: 'SEK' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' },
  { code: 'TH', name: 'Thailand', currency: 'THB' },
  { code: 'TR', name: 'Turkey', currency: 'TRY' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD' },
  { code: 'UA', name: 'Ukraine', currency: 'UAH' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'VN', name: 'Vietnam', currency: 'VND' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR' },
];

const CODE_TO_COUNTRY = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Resolve an ISO-3166 country code to its primary currency. */
export const currencyForCountry = (countryCode: string | null | undefined): string | null => {
  if (!countryCode) return null;
  return CODE_TO_COUNTRY.get(countryCode.toUpperCase())?.currency ?? null;
};

/** Display name for a country code, falling back to the code itself. */
export const countryName = (countryCode: string | null | undefined): string => {
  if (!countryCode) return '';
  return CODE_TO_COUNTRY.get(countryCode.toUpperCase())?.name ?? countryCode;
};

/**
 * Reasonable currencies the org is likely to *enter* values in even if the
 * default differs (e.g. a UK shop paying a US contractor in USD). Used to
 * populate currency dropdowns in expense/contract forms.
 */
export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'AED', 'AUD', 'CAD', 'CHF', 'CNY', 'JPY',
  'SGD', 'NZD', 'ZAR', 'BRL', 'MXN', 'SEK', 'NOK', 'DKK', 'HKD', 'KRW',
];
