import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const org = vi.hoisted(() => ({ isOwner: false, loading: false }));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => org }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'u1' } }) }));
vi.mock('@/lib/app-owner', () => ({ isAppOwner: () => false }));

import { OwnerOnlyGate } from '@/components/auth/OwnerOnlyGate';

afterEach(cleanup);

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/hr']}>
      <Routes>
        <Route path="/hr" element={<OwnerOnlyGate><p>HR page</p></OwnerOnlyGate>} />
        <Route path="/tasks" element={<p>My tasks</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('OwnerOnlyGate', () => {
  it('shows the page to the organization owner', () => {
    org.isOwner = true;
    renderAt();
    expect(screen.getByText('HR page')).toBeTruthy();
  });

  it('sends admins and members to My Tasks', () => {
    org.isOwner = false;
    renderAt();
    expect(screen.queryByText('HR page')).toBeNull();
    expect(screen.getByText('My tasks')).toBeTruthy();
  });
});
