import React from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { COMMON_CURRENCIES } from '@/lib/countries';

interface CurrencySelectProps {
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** When true, includes a label-prefix (e.g. "USD — US Dollar") in the
   *  dropdown options. Useful in onboarding-style flows where the rep
   *  hasn't picked a currency before. The compact form (default) just
   *  shows the ISO code. */
  showLabels?: boolean;
}

const CURRENCY_LABELS: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  INR: 'Indian Rupee',
  AED: 'UAE Dirham',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan',
  JPY: 'Japanese Yen',
  SGD: 'Singapore Dollar',
  NZD: 'New Zealand Dollar',
  ZAR: 'South African Rand',
  BRL: 'Brazilian Real',
  MXN: 'Mexican Peso',
  SEK: 'Swedish Krona',
  NOK: 'Norwegian Krone',
  DKK: 'Danish Krone',
  HKD: 'Hong Kong Dollar',
  KRW: 'South Korean Won',
};

/**
 * Standardized currency picker. Used by Settings, the signup onboarding
 * step, and any new form that needs to pick a currency. Drives the
 * COMMON_CURRENCIES list so adding a new currency in one place rolls out
 * everywhere.
 */
export const CurrencySelect: React.FC<CurrencySelectProps> = ({
  value, onValueChange, disabled, className, placeholder = 'Pick a currency',
  showLabels = false,
}) => (
  <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger className={className}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {COMMON_CURRENCIES.map((c) => (
        <SelectItem key={c} value={c}>
          {showLabels && CURRENCY_LABELS[c]
            ? `${c} — ${CURRENCY_LABELS[c]}`
            : c}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
