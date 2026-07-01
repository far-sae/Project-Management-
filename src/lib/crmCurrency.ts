// Supported CRM currencies + a formatter factory.

export type CurrencyCode =
  | 'USD' | 'GBP' | 'EUR' | 'INR' | 'AUD' | 'CAD' | 'JPY' | 'AED'
  | 'SGD' | 'CHF' | 'ZAR' | 'BRL' | 'CNY' | 'MXN' | 'NZD' | 'SEK'
  | 'NOK' | 'DKK' | 'HKD' | 'PLN';

export interface CurrencyDef {
  code: CurrencyCode;
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

export function formatCurrency(amount: number, code: CurrencyCode = DEFAULT_CURRENCY, opts: { maximumFractionDigits?: number } = {}): string {
  const def = CURRENCY_BY_CODE[code] ?? CURRENCY_BY_CODE[DEFAULT_CURRENCY];
  try {
    return new Intl.NumberFormat(def.locale, {
      style: 'currency',
      currency: def.code,
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    }).format(amount);
  } catch {
    return `${def.symbol}${Math.round(amount).toLocaleString()}`;
  }
}
