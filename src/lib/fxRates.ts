import { useEffect, useState } from 'react';

/**
 * FX helper for the pipeline currency switcher.
 *
 * Deals are stored in their entered currency, but the pipeline lets the
 * user view all amounts in a single display currency. We fetch live rates
 * once per day from open.er-api.com (free, no key, USD-based) and cache
 * them in localStorage. If the network is unavailable we fall back to a
 * built-in table so the UI still works offline.
 */

/** 1 USD → X of the listed currency. Reasonable defaults for the
 *  COMMON_CURRENCIES list — used until/unless a live fetch succeeds. */
export const FALLBACK_RATES_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  INR: 83.5,
  AED: 3.67,
  AUD: 1.52,
  CAD: 1.36,
  CHF: 0.88,
  CNY: 7.24,
  JPY: 156,
  SGD: 1.35,
  NZD: 1.66,
  ZAR: 18.5,
  BRL: 5.1,
  MXN: 17.2,
  SEK: 10.6,
  NOK: 10.8,
  DKK: 6.85,
  HKD: 7.82,
  KRW: 1370,
  ARS: 870,
  BDT: 110,
  CLP: 920,
  COP: 4000,
  CZK: 23,
  EGP: 47,
  HUF: 360,
  IDR: 16000,
  ILS: 3.7,
  KES: 130,
  KWD: 0.31,
  LKR: 300,
  MAD: 9.9,
  MYR: 4.7,
  NGN: 1500,
  PEN: 3.8,
  PHP: 56,
  PKR: 280,
  PLN: 4,
  QAR: 3.64,
  RON: 4.6,
  RUB: 92,
  SAR: 3.75,
  THB: 36,
  TRY: 32,
  TWD: 32,
  UAH: 39,
  VND: 25000,
};

const CACHE_KEY = 'pm_fx_rates_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface RatesCache {
  fetchedAt: number;
  base: 'USD';
  rates: Record<string, number>;
}

const readCache = (): RatesCache | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RatesCache;
    if (parsed?.base !== 'USD' || !parsed.rates || !parsed.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (rates: Record<string, number>) => {
  try {
    const cache: RatesCache = { fetchedAt: Date.now(), base: 'USD', rates };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota errors */
  }
};

/** Convert `amount` from one currency to another via a USD-based table. */
export const convertAmount = (
  amount: number,
  fromCurrency: string | null | undefined,
  toCurrency: string | null | undefined,
  rates: Record<string, number>,
): number => {
  const from = (fromCurrency || 'USD').toUpperCase();
  const to = (toCurrency || 'USD').toUpperCase();
  if (from === to) return amount;
  const fromRate = rates[from];
  const toRate = rates[to];
  // Unknown currency on either side → return original so we don't display a
  // misleading converted number.
  if (!fromRate || !toRate) return amount;
  return (amount / fromRate) * toRate;
};

interface UseFxRatesResult {
  rates: Record<string, number>;
  /** True while we're still on the static fallback table. */
  usingFallback: boolean;
  /** Wall-clock time the rates were fetched, or null if fallback. */
  fetchedAt: number | null;
}

export const useFxRates = (): UseFxRatesResult => {
  const [state, setState] = useState<UseFxRatesResult>(() => {
    const cached = readCache();
    if (cached) {
      return {
        rates: { ...FALLBACK_RATES_PER_USD, ...cached.rates },
        usingFallback: false,
        fetchedAt: cached.fetchedAt,
      };
    }
    return {
      rates: FALLBACK_RATES_PER_USD,
      usingFallback: true,
      fetchedAt: null,
    };
  });

  useEffect(() => {
    const cached = readCache();
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    if (fresh) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) throw new Error('fx fetch failed');
        const json = (await res.json()) as {
          result?: string;
          rates?: Record<string, number>;
          time_last_update_unix?: number;
        };
        if (json.result !== 'success' || !json.rates) {
          throw new Error('fx response invalid');
        }
        if (cancelled) return;
        const merged = { ...FALLBACK_RATES_PER_USD, ...json.rates };
        writeCache(merged);
        setState({
          rates: merged,
          usingFallback: false,
          fetchedAt: Date.now(),
        });
      } catch {
        // Keep whatever we already had — fallback is fine offline.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};

export default useFxRates;
