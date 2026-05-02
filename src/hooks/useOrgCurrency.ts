import { useMemo } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { currencyForCountry } from '@/lib/countries';

/**
 * Resolve the current org's preferred currency for *new* entries (expenses,
 * contracts, payslips, etc.). Resolution order:
 *
 *   1. organization.settings.currency — explicit override the owner set.
 *   2. organization.country — implied from the country picker.
 *   3. 'USD' — last-resort default for fresh tenants without settings.
 *
 * Existing rows already store their original currency on each record, so
 * this hook only changes what the *next* form pre-fills with — it never
 * re-stamps historical data.
 */
export const useOrgCurrency = (): string => {
  const { organization } = useOrganization();
  return useMemo(() => {
    const explicit = organization?.settings?.currency?.trim();
    if (explicit) return explicit;
    const fromCountry = currencyForCountry(organization?.country);
    if (fromCountry) return fromCountry;
    return 'USD';
  }, [organization?.settings?.currency, organization?.country]);
};

export default useOrgCurrency;
