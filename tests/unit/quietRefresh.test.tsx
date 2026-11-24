// A list shows its loading state the first time it is read. When it is read
// again (after something was added or deleted, or after a change by somebody
// else) it keeps what is on screen until the new list is there. Before this,
// every add and every delete in the CRM blanked the page and brought it back,
// which looked like the whole site reloading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  org: { organization: { organizationId: 'org-1' } as { organizationId: string } | null },
  scope: { selectedId: 'ws-1', isAll: false, isUnassigned: false },
  contacts: [{ id: 'c1' }] as Array<{ id: string }>,
  hold: null as null | Promise<void>,
  listContacts: vi.fn(),
}));

vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => state.org }));
vi.mock('@/hooks/useSelectedWorkspace', () => ({ useSelectedWorkspace: () => state.scope, ALL_WORKSPACES_ID: '__ALL_WORKSPACES__' }));
vi.mock('@/services/supabase/config', () => ({
  supabase: { channel: () => ({ on() { return this; }, subscribe() { return { unsubscribe() {} }; }, unsubscribe() {} }) },
}));
vi.mock('@/services/supabase/crmHub/contacts', () => ({ listContacts: state.listContacts }));
vi.mock('@/services/supabase/crmHub/companies', () => ({ listCompanies: vi.fn(async () => []) }));
vi.mock('@/services/supabase/crmHub/deals', () => ({ listDeals: vi.fn(async () => []) }));
vi.mock('@/services/supabase/crmHub/dealStages', () => ({ listDealStages: vi.fn(async () => []), seedDefaultDealStages: vi.fn(async () => []) }));
vi.mock('@/services/supabase/crmHub/tasks', () => ({ listTasks: vi.fn(async () => []) }));
vi.mock('@/services/supabase/crmHub/activities', () => ({ listActivities: vi.fn(async () => []) }));
vi.mock('@/services/supabase/crmHub/tags', () => ({ listTags: vi.fn(async () => []), listContactTagsMap: vi.fn(async () => new Map()) }));

import { useCrmContacts } from '@/hooks/useCrmHub';

/** Every value `loading` had, in order, so a flicker cannot hide between two looks. */
function watch() {
  const seen: boolean[] = [];
  const hook = renderHook(() => {
    const out = useCrmContacts();
    seen.push(out.loading);
    return out;
  });
  return { ...hook, seen };
}

beforeEach(() => {
  state.org = { organization: { organizationId: 'org-1' } };
  state.scope = { selectedId: 'ws-1', isAll: false, isUnassigned: false };
  state.contacts = [{ id: 'c1' }];
  state.listContacts.mockReset().mockImplementation(async () => state.contacts);
});
afterEach(cleanup);

describe('a CRM list', () => {
  it('shows that it is loading the first time it is read', async () => {
    const { result, seen } = watch();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(seen).toContain(true);
    expect(result.current.loading).toBe(false);
  });

  it('is read again quietly after something was added: what is on screen stays until the new list is there', async () => {
    const { result, seen } = watch();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    seen.length = 0;

    // The server is slow: the old list must stay on screen for all of that time.
    let release = () => {};
    state.listContacts.mockImplementation(() => new Promise((resolve) => { release = () => resolve([{ id: 'c1' }, { id: 'c2' }]); }));
    let done: Promise<void> = Promise.resolve();
    act(() => { done = result.current.refresh(); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.loading).toBe(false);
    await act(async () => { release(); await done; });

    expect(result.current.items).toHaveLength(2);
    // Not once did it say "loading" during the second read.
    expect(seen).not.toContain(true);
  });

  it('is read again quietly after something was deleted, too', async () => {
    const { result, seen } = watch();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    seen.length = 0;
    state.contacts = [];
    await act(async () => { await result.current.refresh(); });
    expect(result.current.items).toEqual([]);
    expect(seen).not.toContain(true);
  });

  it('shows loading again when another workspace is opened: that is a list nobody has seen yet', async () => {
    const { result, seen, rerender } = watch();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    seen.length = 0;
    state.scope = { selectedId: 'ws-2', isAll: false, isUnassigned: false };
    state.contacts = [{ id: 'd1' }, { id: 'd2' }];
    rerender();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(seen).toContain(true);
    expect(result.current.loading).toBe(false);
  });

  it('still stops loading when a quiet read fails, and says so', async () => {
    const { result } = watch();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    state.listContacts.mockRejectedValueOnce(new Error('Failed to fetch'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    // What was on screen is not thrown away because one read failed.
    expect(result.current.items).toHaveLength(1);
  });
});
