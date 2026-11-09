import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const getUserProjects = vi.fn(async () => []);
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'u1', organizationId: 'org-1', email: 'u@x.test' },
    ensureValidSession: vi.fn(),
  }),
}));
vi.mock('@/context/OrganizationContext', () => ({
  useOrganization: () => ({ organization: { organizationId: 'org-1' } }),
}));
vi.mock('@/services/supabase/database', () => ({
  createProject: vi.fn(),
  getUserProjects: (...args: unknown[]) => getUserProjects(...(args as [])),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  subscribeToProjects: () => () => {},
}));

import { useProjects } from '@/hooks/useProjects';
import { PROJECTS_CHANGED_EVENT } from '@/services/supabase/projectMove';

describe('useProjects', () => {
  it('re-fetches projects when a project is moved elsewhere in the app', async () => {
    renderHook(() => useProjects());
    getUserProjects.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    expect(getUserProjects).toHaveBeenCalledWith('u1', 'org-1', 'u@x.test');
  });
});
