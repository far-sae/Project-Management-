import { useState, useEffect, useCallback } from 'react';
import { detectUserCountry, GeoLocation, clearLocationCache } from '@/services/geolocation';
import { getPricingForCountry } from '@/services/geolocation/pricing-data';
import { CountryPricing, DEFAULT_PRICING } from '@/types';

interface UseGeolocationResult {
  location: GeoLocation | null;
  pricing: CountryPricing;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to detect user's location and get region-based pricing
 */
export function useGeolocation(): UseGeolocationResult {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [pricing, setPricing] = useState<CountryPricing>(DEFAULT_PRICING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocation = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const detectedLocation = await detectUserCountry();
      setLocation(detectedLocation);

      // Get pricing based on detected country
      const countryPricing = getPricingForCountry(detectedLocation.countryCode);
      setPricing(countryPricing);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to detect location';
      setError(errorMessage);
      console.error('Geolocation error:', err);
      
      // Fall back to default US pricing on error
      setPricing(DEFAULT_PRICING);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  const refetch = useCallback(async () => {
    clearLocationCache();
    await fetchLocation();
  }, [fetchLocation]);

  return {
    location,
    pricing,
    loading,
    error,
    refetch,
  };
}

export default useGeolocation;
