// Merging leads that are the same person: finding the groups, the window that
// merges them, and the database function it calls.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CrmContact } from '@/types/crmHub';

const h = vi.hoisted(() => ({
  mergeContacts: vi.fn(),
  syncLeadStepWithDeals: vi.fn(),
  rpc: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/services/supabase/crmHub/deals', () => ({ syncLeadStepWithDeals: h.syncLeadStepWithDeals }));
vi.mock('@/services/supabase/crmHub/contacts', async (original) => ({
  ...(await original<typeof import('@/services/supabase/crmHub/contacts')>()),
  mergeContacts: h.mergeContacts,
}));

import { duplicateGroups } from '@/lib/crmDuplicates';
import { DuplicateLeadsDialog } from '@/components/crmHub/DuplicateLeadsDialog';

const lead = (id: string, firstName: string, email: string | null, day: number, over: Partial<CrmContact> = {}) => ({
  id, firstName, lastName: 'Rossi', email, phone: null, companyId: null, ownerId: null, createdAt: new Date(2026, 10, day), ...over,
}) as unknown as CrmContact;

const LEADS = [
  lead('a', 'Elena', 'elena@northwind.example', 5, { companyId: 'c1', ownerId: 'u1' }),
  lead('b', 'E.', ' Elena@Northwind.example ', 2, { phone: '020 7946 0958' }),
  lead('c', 'Tom', 'tom@harbour.example', 3),
  lead('d', 'Elena', 'ELENA@northwind.example', 9),
  lead('e', 'Noor', null, 1),
  lead('f', 'Zed', null, 1),
  lead('g', 'Tom', 'tom@harbour.example', 4),
];

beforeEach(() => {
  h.mergeContacts.mockReset().mockResolvedValue(undefined);
  h.syncLeadStepWithDeals.mockReset().mockResolvedValue(undefined);
  h.rpc.mockReset();
  h.toast.success.mockClear();
});
afterEach(cleanup);

describe('duplicate groups', () => {
  it('groups leads by email, oldest first, biggest group first, and never groups leads without an email', () => {
    expect(duplicateGroups(LEADS).map((g) => g.map((l) => l.id))).toEqual([['b', 'a', 'd'], ['c', 'g']]);
    expect(duplicateGroups([LEADS[2], LEADS[4], LEADS[5]])).toEqual([]);
  });
});

describe('duplicates window', () => {
  const show = (onMerged = vi.fn()) => {
    render(
      <DuplicateLeadsDialog
        open
        onOpenChange={() => undefined}
        leads={LEADS}
        companyNames={new Map([['c1', 'Northwind Studio']])}
        ownerNames={new Map([['u1', 'Sam']])}
        onMerged={onMerged}
      />,
    );
    return onMerged;
  };

  it('shows each group with enough to tell the leads apart, keeping the oldest unless told otherwise', () => {
    show();
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(2);
    const first = within(groups[0]);
    expect(first.getByText('elena@northwind.example')).toBeTruthy();
    const options = first.getAllByRole('radio') as HTMLInputElement[];
    expect(options.map((o) => o.checked)).toEqual([true, false, false]);
    expect(groups[0].textContent).toContain('020 7946 0958');
    expect(groups[0].textContent).toContain('Northwind Studio');
    expect(groups[0].textContent).toContain('Sam');
    expect(groups[0].textContent).toContain('(oldest)');
  });

  it('merges the others into the lead that was chosen, then lets the list refresh', async () => {
    const onMerged = show();
    const group = within(screen.getAllByRole('group')[0]);
    fireEvent.click(group.getAllByRole('radio')[1]);
    fireEvent.click(group.getByRole('button', { name: 'Merge 3 into one' }));
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    // 'a' is kept; the other two are merged into it, one after the other.
    expect(h.mergeContacts.mock.calls).toEqual([['a', 'b'], ['a', 'd']]);
    expect(h.syncLeadStepWithDeals).toHaveBeenCalledWith('a');
    expect(h.toast.success).toHaveBeenCalledWith('Merged 3 leads into one.');
  });

  it('says why when a merge is refused, and still refreshes the list', async () => {
    h.mergeContacts.mockRejectedValue(new Error('Merging is not set up yet: run supabase/migrations/193_crm_merge_leads.sql in the Supabase SQL editor.'));
    const onMerged = show();
    fireEvent.click(within(screen.getAllByRole('group')[1]).getByRole('button', { name: 'Merge 2 into one' }));
    expect((await screen.findByRole('alert')).textContent).toContain('193_crm_merge_leads.sql');
    expect(onMerged).toHaveBeenCalled();
    expect(h.syncLeadStepWithDeals).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to merge', () => {
    render(<DuplicateLeadsDialog open onOpenChange={() => undefined} leads={[LEADS[2], LEADS[4]]} companyNames={new Map()} ownerNames={new Map()} onMerged={() => undefined} />);
    expect(screen.getByText('No two leads share an email address.')).toBeTruthy();
  });
});

describe('the merge itself', () => {
  it('is one call to the database function, and says what to run while it is missing', async () => {
    const { mergeContacts, MERGE_NOT_SET_UP_MESSAGE } = await vi.importActual<typeof import('@/services/supabase/crmHub/contacts')>('@/services/supabase/crmHub/contacts');
    h.rpc.mockResolvedValueOnce({ error: null });
    await mergeContacts('keep-1', 'drop-1');
    expect(h.rpc).toHaveBeenCalledWith('crm_merge_contacts', { p_keep: 'keep-1', p_drop: 'drop-1' });
    h.rpc.mockResolvedValueOnce({ error: { code: 'PGRST202', message: 'Could not find the function public.crm_merge_contacts(p_drop, p_keep) in the schema cache' } });
    await expect(mergeContacts('keep-1', 'drop-1')).rejects.toThrow(MERGE_NOT_SET_UP_MESSAGE);
    h.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'You may not change leads in this workspace.' } });
    await expect(mergeContacts('keep-1', 'drop-1')).rejects.toThrow('You may not change leads in this workspace.');
  });
});

describe('migration 193', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/193_crm_merge_leads.sql'), 'utf8');
  const code = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const flat = code.replace(/\s+/g, ' ');

  it('can be run twice and adds only the one function', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(code).not.toMatch(/create function/i);
    expect(code).not.toMatch(/create table/i);
    expect((flat.match(/create or replace function/g) ?? []).length).toBe(1);
    expect(flat).toContain('grant execute on function public.crm_merge_contacts(uuid, uuid) to authenticated, service_role');
    expect(flat).toContain('revoke all on function public.crm_merge_contacts(uuid, uuid) from public, anon');
  });

  it('only merges two leads of one workspace, for someone who may change that workspace', () => {
    expect(flat).toContain("if p_keep is null or p_drop is null or p_keep = p_drop then raise exception");
    expect(flat).toContain('k.organization_id <> d.organization_id or k.workspace_id is distinct from d.workspace_id');
    expect(flat).toContain('if not public.can_access_crm_scope(k.organization_id, k.workspace_id) or public.is_org_viewer(k.organization_id) then raise exception');
    // The check comes before anything is moved or deleted.
    expect(flat.indexOf('can_access_crm_scope')).toBeLessThan(flat.indexOf('insert into public.crm_contact_tags'));
    expect(flat.indexOf('can_access_crm_scope')).toBeLessThan(flat.indexOf('delete from public.crm_contacts'));
  });

  it('moves everything that points at the dropped lead, whatever tables exist, then deletes it last', () => {
    expect(flat).toContain("f.confrelid = 'public.crm_contacts'::regclass");
    expect(flat).toContain("execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name) using p_keep, p_drop");
    expect(flat).toContain('when unique_violation then null');
    expect(flat).toContain('on conflict do nothing');
    const lastDelete = flat.lastIndexOf('delete from public.crm_contacts where id = p_drop');
    expect(lastDelete).toBeGreaterThan(flat.indexOf('execute format'));
    expect(lastDelete).toBeGreaterThan(flat.indexOf("'Merged with '"));
  });

  it('fills only what the kept lead does not have, and uses columns the lead table really has', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase/migrations/144_crm_hub_schema.sql'), 'utf8');
    for (const column of ['last_name', 'email', 'phone', 'job_title', 'company_id', 'owner_id', 'source', 'notes', 'last_contacted_at']) {
      expect(schema, column).toMatch(new RegExp(`\\n\\s+${column} `));
      expect(flat, column).toContain(`${column} = `);
    }
    expect(flat).toContain("email = coalesce(nullif(btrim(email), ''), d.email)");
    // Columns from later migrations are touched only where the database has them.
    expect(flat).toContain("column_name = 'custom_fields'");
    expect(flat).toContain("column_name = 'category'");
  });
});
