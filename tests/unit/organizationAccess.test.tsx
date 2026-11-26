// What the app knows about the signed-in person's extra access (Team page,
// "Social media"): a member has it only once it was given and read, the owner
// and admins need no row, and no page decides before the answer is there.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  user: { userId: 'u-junaid', organizationId: 'org-1' } as { userId: string; organizationId: string } | null,
  org: null as Record<string, unknown> | null,
  loadMyAccess: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock('@/services/supabase/organizations', () => ({ getOrganization: async () => h.org }));
vi.mock('@/services/supabase/memberAccess', () => ({ loadMyAccess: h.loadMyAccess }));
vi.mock('@/services/supabase/config', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { organization_id: 'org-1' } }) };
  return { supabase: { channel: () => channel, removeChannel: async () => undefined, from: () => query } };
});

import { OrganizationProvider, useOrganization } from '@/context/OrganizationContext';

const members = [
  { userId: 'u-admin', role: 'admin', status: 'active' },
  { userId: 'u-junaid', role: 'member', status: 'active' },
  { userId: 'u-viewer', role: 'viewer', status: 'active' },
];

const Probe: React.FC = () => {
  const { areaLevel, canAccessPage, permissionsLoading, isAdmin } = useOrganization();
  return <p data-testid="probe">{JSON.stringify({ wait: permissionsLoading, social: areaLevel('social'), page: canAccessPage('social'), team: canAccessPage('team'), reports: canAccessPage('reports'), admin: isAdmin })}</p>;
};
const read = () => JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as { wait: boolean; social: string; page: boolean; team: boolean; reports: boolean; admin: boolean };
const show = () => render(<OrganizationProvider><Probe /></OrganizationProvider>);
const settled = async () => { await waitFor(() => expect(read().wait).toBe(false)); return read(); };

beforeEach(() => {
  h.user = { userId: 'u-junaid', organizationId: 'org-1' };
  h.org = { organizationId: 'org-1', ownerId: 'u-owner', members };
  h.loadMyAccess.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe('a member', () => {
  it('has no Social media until it was given', async () => {
    show();
    expect(await settled()).toEqual({ wait: false, social: 'none', page: false, team: false, reports: false, admin: false });
    expect(h.loadMyAccess).toHaveBeenCalledWith('org-1', 'u-junaid');
  });

  it('with "posts only" reaches the page but is not let do the admin things', async () => {
    h.loadMyAccess.mockResolvedValue({ social: 'use' });
    show();
    expect(await settled()).toEqual({ wait: false, social: 'use', page: true, team: false, reports: false, admin: false });
  });

  it('with "everything" manages Social media, and still nothing else of the admins', async () => {
    h.loadMyAccess.mockResolvedValue({ social: 'manage' });
    show();
    expect(await settled()).toEqual({ wait: false, social: 'manage', page: true, team: false, reports: false, admin: false });
  });

  it('is asked to wait until what was given has been read, so no page opens or closes by mistake', async () => {
    let answer: (value: Record<string, string>) => void = () => undefined;
    h.loadMyAccess.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    show();
    await waitFor(() => expect(h.loadMyAccess).toHaveBeenCalled());
    expect(read().wait).toBe(true);
    answer({ social: 'use' });
    expect((await settled()).page).toBe(true);
  });
});

describe('a member whose pages the owner chose', () => {
  it('has a page that was switched on, and loses one that was switched off', async () => {
    h.loadMyAccess.mockResolvedValue({ reports: 'use', social: 'off' });
    show();
    expect(await settled()).toEqual({ wait: false, social: 'none', page: false, team: false, reports: true, admin: false });
  });
});

describe('everybody else', () => {
  it('the owner and an admin manage Social media without a row, and the database is not asked', async () => {
    h.user = { userId: 'u-admin', organizationId: 'org-1' };
    show();
    expect(await settled()).toMatchObject({ social: 'manage', page: true, admin: true });
    cleanup();
    h.user = { userId: 'u-owner', organizationId: 'org-1' };
    show();
    expect(await settled()).toMatchObject({ social: 'manage', page: true, admin: true });
    expect(h.loadMyAccess).not.toHaveBeenCalled();
  });

  it('a viewer has none, whatever a row would say', async () => {
    h.user = { userId: 'u-viewer', organizationId: 'org-1' };
    h.loadMyAccess.mockResolvedValue({ social: 'manage' });
    show();
    expect(await settled()).toMatchObject({ social: 'none', page: false, admin: false });
    expect(h.loadMyAccess).not.toHaveBeenCalled();
  });
});
