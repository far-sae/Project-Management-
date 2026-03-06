/**
 * IP Geolocation Service
 * Detects user's country based on IP address for region-based pricing
 */

export interface GeoLocation {
  countryCode: string;
  countryName: string;
  city?: string;
  region?: string;
  timezone?: string;
  currency?: string;
}

// Cache the geolocation result to avoid multiple API calls
let cachedLocation: GeoLocation | null = null;

/**
 * Detect user's country using IP geolocation
 * Uses CORS-friendly APIs for browser environments
 */
export async function detectUserCountry(): Promise<GeoLocation> {
  // Return cached result if available
  if (cachedLocation) {
    return cachedLocation;
  }

  // List of geolocation APIs to try (CORS-friendly)
  const apis = [
    {
      url: 'https://api.country.is/',
      parse: (data: { country: string }) => ({
        countryCode: data.country || 'US',
        countryName: getCountryName(data.country) || 'United States',
      }),
    },
    {
      url: 'https://ipwho.is/',
      parse: (data: { country_code: string; country: string; city: string; region: string; timezone: { id: string } }) => ({
        countryCode: data.country_code || 'US',
        countryName: data.country || 'United States',
        city: data.city,
        region: data.region,
        timezone: data.timezone?.id,
      }),
    },
    {
      url: 'http://ip-api.com/json/?fields=countryCode,country,city,regionName,timezone',
      parse: (data: { countryCode: string; country: string; city: string; regionName: string; timezone: string }) => ({
        countryCode: data.countryCode || 'US',
        countryName: data.country || 'United States',
        city: data.city,
        region: data.regionName,
        timezone: data.timezone,
      }),
    },
  ];

  for (const api of apis) {
    try {
      const response = await fetch(api.url);
      if (!response.ok) continue;
      
      const data = await response.json();
      cachedLocation = api.parse(data);
      return cachedLocation;
    } catch {
      // Try next API silently
      continue;
    }
  }

  // Fallback to browser locale
  const browserLocale = navigator.language?.split('-')[1] || 'US';
  cachedLocation = {
    countryCode: browserLocale,
    countryName: getCountryName(browserLocale) || 'United States',
  };
  return cachedLocation;
}

// Helper to get country name from code
function getCountryName(code: string): string {
  const countries: Record<string, string> = {
    US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
    DE: 'Germany', FR: 'France', JP: 'Japan', IN: 'India', BR: 'Brazil',
    MX: 'Mexico', PK: 'Pakistan', IT: 'Italy', ES: 'Spain', NL: 'Netherlands',
  };
  return countries[code] || code;
}

/**
 * Clear the cached location (useful for testing or when user changes VPN)
 */
export function clearLocationCache(): void {
  cachedLocation = null;
}

/**
 * Get cached location without making API call
 */
export function getCachedLocation(): GeoLocation | null {
  return cachedLocation;
}
