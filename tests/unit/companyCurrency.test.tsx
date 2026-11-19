// One company currency: the CRM shows money in it and changing it in the CRM changes it for the whole app.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  organization: null as Record<string, unknown> | null,
  updateOrganization: vi.fn(async () => undefined),
  refreshOrganization: vi.fn(async () => undefined),
}));

vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: h.organization, refreshOrganization: h.refreshOrganization }),
}));
vi.mock('@/services/supabase/organizations', () => ({ updateOrganization: h.updateOrganization }));

import { CrmCurrencyProvider, useCrmCurrency } from '@/context/CrmCurrencyContext';
import { formatCurrency } from '@/lib/crmCurrency';

let api: ReturnType<typeof useCrmCurrency>;
const Probe = () => {
  api = useCrmCurrency();
  return <output>{api.format(1234)}</output>;
};
const mount = () => render(<CrmCurrencyProvider><Probe /></CrmCurrencyProvider>);

const SETTINGS = { timezone: 'Europe/London', currency: 'GBP', locale: 'en-GB', branding: { primaryColor: '#000' } };

beforeEach(() => {
  h.organization = { organizationId: 'o', country: 'United Kingdom', settings: { ...SETTINGS } };
  h.updateOrganization.mockClear();
  h.refreshOrganization.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

describe('Company currency in the CRM', () => {
  it('shows CRM money in the company currency', () => {
    mount();
    expect(api.code).toBe('GBP');
    expect(screen.getByText('£1,234')).toBeTruthy();
  });

  it('follows the company currency when it changes somewhere else', () => {
    const view = mount();
    h.organization = { organizationId: 'o', settings: { ...SETTINGS, currency: 'EUR' } };
    view.rerender(<CrmCurrencyProvider><Probe /></CrmCurrencyProvider>);
    expect(api.code).toBe('EUR');
    expect(screen.getByText(/€\s?1,234/)).toBeTruthy();
  });

  it('changing it in the CRM saves it for the whole company, keeping the other settings', async () => {
    mount();
    await act(async () => {
      await api.setCurrency('USD');
    });
    expect(h.updateOrganization).toHaveBeenCalledWith('o', { settings: { ...SETTINGS, currency: 'USD' } });
    expect(h.refreshOrganization).toHaveBeenCalled();
  });

  it('works for a currency the CRM has no entry for', () => {
    h.organization = { organizationId: 'o', settings: { ...SETTINGS, currency: 'KRW' } };
    mount();
    expect(api.code).toBe('KRW');
    expect(api.def.symbol).toBe('₩');
    expect(screen.getByText(/₩\s?1,234/)).toBeTruthy();
  });
});

describe('formatCurrency', () => {
  it('formats in the currency asked for, not a default, when the code is not in the list', () => {
    expect(formatCurrency(500, 'KRW')).toMatch(/₩\s?500/);
  });
});
