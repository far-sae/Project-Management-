// The Activity page showed the latest 200 events and nothing said there were more.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ total: 0, limits: [] as number[] }));

vi.mock('@/hooks/useCrmHub', () => {
  const none = { items: [], loading: false, error: null, refresh: async () => {} };
  const cache = new Map<number, unknown>();
  return {
    useCrmActivities: (limit: number) => {
      h.limits.push(limit);
      const key = limit * 100000 + h.total;
      if (!cache.has(key)) {
        cache.set(key, {
          ...none,
          items: Array.from({ length: Math.min(limit, h.total) }, (_, i) => ({
            id: `a${i}`, type: 'note', description: `Note number ${i}`, dealId: null, contactId: null, companyId: null,
            createdAt: new Date(Date.UTC(2026, 10, 20, 10, 0, 0) - i * 60000),
          })),
        });
      }
      return cache.get(key);
    },
    useCrmContacts: () => none,
    useCrmCompanies: () => none,
    useCrmDeals: () => none,
    useWorkspaceForCreate: () => 'w',
  };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { organizationId: 'o' } }) }));
vi.mock('@/services/supabase/crmHub/activities', () => ({ logActivity: vi.fn(), tryLogActivity: vi.fn(), listActivities: async () => [] }));

import { CrmActivityPage } from '@/pages/crmHub/Activity';

beforeEach(() => { h.total = 0; h.limits.length = 0; });
afterEach(cleanup);

describe('Activity page', () => {
  it('offers older activity when the list is full, and loads it', () => {
    h.total = 450;
    render(<MemoryRouter><CrmActivityPage /></MemoryRouter>);
    expect(screen.getByText('Note number 199')).toBeTruthy();
    expect(screen.queryByText('Note number 200')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));
    expect(h.limits.at(-1)).toBe(400);
    expect(screen.getByText('Note number 399')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));
    expect(screen.getByText('Note number 449')).toBeTruthy();
    // Everything is on the page now, so there is nothing more to offer.
    expect(screen.queryByRole('button', { name: 'Show older activity' })).toBeNull();
  });

  it('offers nothing when the whole history is already shown', () => {
    h.total = 12;
    render(<MemoryRouter><CrmActivityPage /></MemoryRouter>);
    expect(screen.getByText('Note number 11')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show older activity' })).toBeNull();
  });
});
