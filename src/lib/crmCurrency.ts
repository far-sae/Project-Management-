// The currencies the app knows by name, and how money is written in any currency.

export type CurrencyCode =
  | 'USD' | 'GBP' | 'EUR' | 'INR' | 'AUD' | 'CAD' | 'JPY' | 'AED'
  | 'SGD' | 'CHF' | 'ZAR' | 'BRL' | 'CNY' | 'MXN' | 'NZD' | 'SEK'
  | 'NOK' | 'DKK' | 'HKD' | 'PLN';

export interface CurrencyDef {
  /** ISO code. One of the listed currencies, or any other code the company chose. */
  code: string;
  symbol: string;
  label: string;
  locale?: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'USD', symbol: '$',  label: 'US Dollar',       locale: 'en-US' },
  { code: 'GBP', symbol: '£',  label: 'British Pound',   locale: 'en-GB' },
  { code: 'EUR', symbol: '€',  label: 'Euro',            locale: 'en-IE' },
  { code: 'INR', symbol: '₹',  label: 'Indian Rupee',    locale: 'en-IN' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'JPY', symbol: '¥',  label: 'Japanese Yen',    locale: 'ja-JP' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham',      locale: 'ar-AE' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc',    locale: 'de-CH' },
  { code: 'ZAR', symbol: 'R',  label: 'South African Rand', locale: 'en-ZA' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian Real',  locale: 'pt-BR' },
  { code: 'CNY', symbol: '¥',  label: 'Chinese Yuan',    locale: 'zh-CN' },
  { code: 'MXN', symbol: 'Mex$', label: 'Mexican Peso',  locale: 'es-MX' },
  { code: 'NZD', symbol: 'NZ$', label: 'New Zealand Dollar', locale: 'en-NZ' },
  { code: 'SEK', symbol: 'kr', label: 'Swedish Krona',   locale: 'sv-SE' },
  { code: 'NOK', symbol: 'kr', label: 'Norwegian Krone', locale: 'nb-NO' },
  { code: 'DKK', symbol: 'kr', label: 'Danish Krone',    locale: 'da-DK' },
  { code: 'HKD', symbol: 'HK$', label: 'Hong Kong Dollar', locale: 'en-HK' },
  { code: 'PLN', symbol: 'zł', label: 'Polish Zloty',    locale: 'pl-PL' },
];

export const CURRENCY_BY_CODE: Record<string, CurrencyDef> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c]),
);

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/**
 * What is known about a currency. Listed currencies come with their name and
 * locale; any other ISO code still gets its own symbol, so the company's
 * currency is never swapped for a default one.
 */
export function currencyDef(code: string | null | undefined): CurrencyDef {
  const wanted = (code ?? '').trim().toUpperCase();
  const known = CURRENCY_BY_CODE[wanted];
  if (known) return known;
  if (!wanted) return CURRENCY_BY_CODE[DEFAULT_CURRENCY]!;
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: wanted, currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return { code: wanted, symbol: parts.find((p) => p.type === 'currency')?.value ?? wanted, label: wanted };
  } catch {
    // Not a currency code at all.
    return CURRENCY_BY_CODE[DEFAULT_CURRENCY]!;
  }
}

export function formatCurrency(amount: number, code: string = DEFAULT_CURRENCY, opts: { maximumFractionDigits?: number } = {}): string {
  const def = currencyDef(code);
  try {
    return new Intl.NumberFormat(def.locale, {
      style: 'currency',
      currency: def.code,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    }).format(amount);
  } catch {
    return `${def.symbol}${Math.round(amount).toLocaleString()}`;
  }
}
