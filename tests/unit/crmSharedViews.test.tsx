// Saved views of the Leads list that the whole team has.
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LeadViewState } from '@/lib/crmSavedViews';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  readError: null as null | { code?: string; message?: string },
  insertError: null as null | { code?: string; message?: string },
  inserted: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  /** Rows the database says it removed. Empty = its rule left the view alone. */
  removed: [{ id: 'x' }] as Array<{ id: string }>,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => (h.readError ? { data: null, error: h.readError } : { data: h.rows, error: null }) }) }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (h.insertError) return { data: null, error: h.insertError };
            h.inserted.push(row);
            return { data: { id: `shared-${h.inserted.length}`, ...row }, error: null };
          },
        }),
      }),
      delete: () => ({ eq: (_c: string, id: string) => ({ select: async () => { h.deleted.push(id); return { data: h.removed, error: null }; } }) }),
    }),
  },
}));

import { SHARED_VIEWS_NOT_SET_UP_MESSAGE, listSharedViews } from '@/services/supabase/crmHub/savedViews';
import { LeadViews } from '@/components/crmHub/LeadViews';

const EMPTY: LeadViewState = { search: '', step: 'all', category: 'all', owner: 'all', sort: null };

const Page: React.FC<{ start?: LeadViewState }> = ({ start = { ...EMPTY, step: 'qualified' } }) => {
  const [state, setState] = useState(start);
  return (
    <div>
      <p data-testid="step">{state.step}</p>
      <button type="button" onClick={() => setState(EMPTY)}>Show everything</button>
      <LeadViews storageKey="crm.leadViews.u1.w" organizationId="o" workspaceId="w" current={state} onApply={setState} />
    </div>
  );
};

beforeEach(() => {
  window.localStorage.clear();
  h.rows = [];
  h.readError = null;
  h.insertError = null;
  h.inserted.length = 0;
  h.deleted.length = 0;
  h.removed = [{ id: 'x' }];
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(cleanup);

const pick = async (name: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Saved view' }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name }), { key: 'Enter' });
};

describe('a view shared with the team', () => {
  it('is kept with the workspace, not in the browser', async () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Qualified leads' } });
    expect(screen.getByText('Only you, in this browser.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Share with the team/));
    expect(screen.getByText('Everybody in this workspace finds it in their list.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('View “Qualified leads” shared with the team'));
    expect(h.inserted[0]).toMatchObject({ organization_id: 'o', workspace_id: 'w', name: 'Qualified leads', state: { step: 'qualified' } });
    expect(window.localStorage.getItem('crm.leadViews.u1.w')).toBeNull();
  });

  it('is offered to everybody under “Team”, next to their own', async () => {
    window.localStorage.setItem('crm.leadViews.u1.w', JSON.stringify([{ id: 'mine-1', name: 'My new ones', state: { ...EMPTY, step: 'new' } }]));
    h.rows = [{ id: 's1', name: 'Customers', state: { step: 'customer' } }];
    render(<Page start={EMPTY} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Saved view' })).toBeTruthy());
    await pick('Customers');
    expect(screen.getByTestId('step').textContent).toBe('customer');
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    await pick('My new ones');
    expect(screen.getByTestId('step').textContent).toBe('new');
  });

  it('can be removed for the team, and says so when the database does not allow it', async () => {
    h.rows = [{ id: 's1', name: 'Customers', state: { step: 'customer' } }];
    render(<Page start={{ ...EMPTY, step: 'customer' }} />);
    const remove = await screen.findByRole('button', { name: 'Remove the team view Customers' });
    h.removed = [];
    fireEvent.click(remove);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Only the person who shared this view, the owner or an admin can remove it.'));
    expect(screen.getByRole('button', { name: 'Remove the team view Customers' })).toBeTruthy();

    h.removed = [{ id: 's1' }];
    fireEvent.click(screen.getByRole('button', { name: 'Remove the team view Customers' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('View “Customers” removed for the team'));
    expect(h.deleted).toEqual(['s1', 's1']);
  });

  it('keeps the window open and says why when it cannot be shared', async () => {
    h.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "crm_saved_views_name"' };
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Customers' } });
    fireEvent.click(screen.getByLabelText(/Share with the team/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The team has a view with this name already. Choose another name.');
    expect(alert.textContent).not.toContain('duplicate key');
  });

  it('says which file to run while sharing is not set up', async () => {
    h.insertError = { code: 'PGRST205', message: "Could not find the table 'public.crm_saved_views' in the schema cache" };
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Customers' } });
    fireEvent.click(screen.getByLabelText(/Share with the team/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(SHARED_VIEWS_NOT_SET_UP_MESSAGE);
    expect(SHARED_VIEWS_NOT_SET_UP_MESSAGE).toContain('202_crm_shared_views.sql');
  });

  it('leaves each person their own views while the team’s cannot be read', async () => {
    h.readError = { code: 'PGRST205', message: 'no table' };
    expect(await listSharedViews('w')).toEqual([]);
    window.localStorage.setItem('crm.leadViews.u1.w', JSON.stringify([{ id: 'mine-1', name: 'My new ones', state: { ...EMPTY, step: 'new' } }]));
    render(<Page start={EMPTY} />);
    await pick('My new ones');
    expect(screen.getByTestId('step').textContent).toBe('new');
  });

  it('repairs a shared view whose saved filters are damaged', async () => {
    h.rows = [{ id: 's1', name: 'Odd', state: { owner: 'everyone', sort: 'up' } }];
    expect(await listSharedViews('w')).toEqual([{ id: 's1', name: 'Odd', state: EMPTY, shared: true }]);
  });
});

describe('migration 202', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/202_crm_shared_views.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('adds one table and can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain('create table if not exists public.crm_saved_views');
    expect((flat.match(/drop policy if exists/g) ?? []).length).toBe((flat.match(/create policy/g) ?? []).length);
    expect(flat).not.toMatch(/drop table|alter table public\.crm_(contacts|deals)/i);
  });

  it('lets the workspace read, everybody but viewers add, and only the maker or an admin remove', () => {
    expect(flat).toContain('for select to authenticated using (public.can_access_crm_scope(organization_id, workspace_id))');
    expect(flat).toContain('for insert to authenticated with check (public.can_access_crm_scope(organization_id, workspace_id) and not public.is_org_viewer(organization_id))');
    expect(flat).toContain('and (created_by = auth.uid() or public.is_org_admin_or_owner(organization_id))');
    // A shared view is added or removed, never changed under somebody's hands.
    expect(flat).toContain('grant select, insert, delete on public.crm_saved_views to authenticated');
    expect(flat).not.toContain('for update');
  });
});
