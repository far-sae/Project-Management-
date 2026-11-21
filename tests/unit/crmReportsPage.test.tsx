// The CRM's Reports page: the period's figures, for everyone or one person.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => {
  // "This month" is whatever month the test runs in, so the dates are made from today.
  const today = new Date();
  const day = (d: number) => new Date(today.getFullYear(), today.getMonth(), Math.min(d, today.getDate()), 9, 0, 0);
  const list = <T,>(items: T[]) => ({ items, loading: false, error: null, refresh: async () => undefined });
  const organization = {
    organization: {
      organizationId: 'org-1',
      members: [
        { userId: 'u1', displayName: 'Sam', email: 'sam@example.com', status: 'active' },
        { userId: 'u2', displayName: 'Priya', email: 'priya@example.com', status: 'active' },
        { userId: 'u3', displayName: 'Gone', email: 'gone@example.com', status: 'removed' },
      ],
    },
  };
  const leads = list([
    { id: 'l1', ownerId: 'u1', source: 'Website form', createdAt: day(1) },
    { id: 'l2', ownerId: 'u2', source: 'Referral', createdAt: day(1) },
  ]);
  const deals = list([
    { id: 'd1', ownerId: 'u1', contactId: 'l1', stageId: 'sw', status: 'won', lostReason: null, createdAt: day(1), closedAt: day(1), value: 5000, currency: 'GBP' },
    { id: 'd2', ownerId: 'u2', contactId: 'l2', stageId: 'sl', status: 'lost', lostReason: 'Price', createdAt: day(1), closedAt: day(1), value: 900, currency: 'GBP' },
    { id: 'd3', ownerId: 'u2', contactId: null, stageId: 's1', status: 'open', lostReason: null, createdAt: day(1), closedAt: null, value: 3000, currency: 'GBP' },
  ]);
  const stages = list([
    { id: 's1', name: 'New', sortOrder: 1, status: 'open' },
    { id: 'sw', name: 'Won', sortOrder: 9, status: 'won' },
    { id: 'sl', name: 'Lost', sortOrder: 10, status: 'lost' },
  ]);
  const activities = list([{ userId: 'u1', type: 'call', createdAt: day(1) }, { userId: 'u1', type: 'call', createdAt: day(1) }]);
  const currency = { code: 'GBP', format: (n: number) => `£${n.toLocaleString('en-GB')}` };
  const dealMoney = { inCompany: (d: { value: number }) => d.value };
  return { organization, leads, deals, stages, activities, currency, dealMoney, activityLimit: 0 };
});

vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.organization }));
vi.mock('@/context/CrmCurrencyContext', () => ({ useCrmCurrency: () => h.currency }));
vi.mock('@/hooks/useDealMoney', () => ({ useDealMoney: () => h.dealMoney }));
vi.mock('@/hooks/useCrmHub', () => ({
  useCrmContacts: () => h.leads,
  useCrmDeals: () => h.deals,
  useCrmDealStages: () => h.stages,
  useCrmActivities: (limit: number) => { h.activityLimit = limit; return h.activities; },
}));

import { CrmReportsPage } from '@/pages/crmHub/Reports';

const choose = async (name: string, option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};
const table = (name: string) => within(screen.getByRole('region', { name }));

afterEach(cleanup);

describe('CRM reports page', () => {
  it('shows this month for everyone: the totals, each person, the sources and why deals were lost', () => {
    render(<CrmReportsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeTruthy();
    expect(screen.getByText('2 became a deal (100%)')).toBeTruthy();
    expect(screen.getByText('1 won, 1 lost')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1 open deal today')).toBeTruthy();

    const people = table('By person').getAllByRole('row').slice(1).map((r) => r.textContent);
    // Someone removed from the organisation is not listed.
    expect(people).toEqual(['Sam11£5,00002000', 'Priya10£010000']);
    expect(table('Where leads came from').getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Referral110', 'Website form111']);
    expect(table('Why deals were lost').getByText('Price')).toBeTruthy();
    expect(table('Open pipeline today, by stage').getByText('£3,000')).toBeTruthy();
    // Enough of the timeline is read to count what each person logged.
    expect(h.activityLimit).toBe(2000);
  });

  it('narrows every figure to one person', async () => {
    render(<CrmReportsPage />);
    await choose('Person', 'Priya');
    expect(screen.getByText('0 won, 1 lost')).toBeTruthy();
    expect(table('By person').getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Priya10£010000']);
    expect(table('Where leads came from').getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Referral110']);
  });

  it('says so, table by table, when a period has nothing in it', async () => {
    render(<CrmReportsPage />);
    await choose('Period', 'Last month');
    expect(screen.getByText('No lead was added in this period.')).toBeTruthy();
    expect(screen.getByText('No deal was lost in this period.')).toBeTruthy();
    // The open pipeline is today's, whatever the period.
    expect(table('Open pipeline today, by stage').getByText('£3,000')).toBeTruthy();
  });

  it('exports what is shown as a file', () => {
    const made: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { made.push(blob); return 'blob:report'; });
    URL.createObjectURL = createObjectURL as never;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<CrmReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(made[0].type).toContain('text/csv');
    click.mockRestore();
  });
});
