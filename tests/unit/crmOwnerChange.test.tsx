// The owner of a lead or a deal can be changed: the field in the edit
// dialogs, and the services that save it.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  organization: {
    organization: {
      organizationId: 'org-1',
      members: [
        { userId: 'u1', displayName: 'Sam Carter', email: 'sam@example.com', status: 'active' },
        { userId: 'u2', displayName: '', email: 'priya@example.com', status: 'active' },
        { userId: 'u3', displayName: 'Tom Okafor', email: 'tom@example.com', status: 'removed' },
        { userId: 'u4', displayName: 'Elena Rossi', email: 'elena@example.com' },
      ],
    },
  },
  updates: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.organization }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        h.updates.push({ table, row });
        const chain = {
          eq: () => chain,
          select: () => chain,
          single: async () => ({
            data: {
              id: 'x', organization_id: 'org-1', workspace_id: 'ws-1', owner_id: null, first_name: 'Elena', name: 'Website',
              value: 0, probability: 0, status: 'open', lifecycle_stage: 'lead', lead_status: 'new',
              created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', ...row,
            },
            error: null,
          }),
        };
        return chain;
      },
    }),
  },
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

import { OwnerField, ownerName } from '@/components/crmHub/OwnerField';
import { updateContact } from '@/services/supabase/crmHub/contacts';
import { updateDeal } from '@/services/supabase/crmHub/deals';

/** Picks from a drop-down the way the keyboard does. */
const choose = async (option: string) => {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Owner' }), { key: 'ArrowDown' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
};

beforeEach(() => { h.updates = []; });
afterEach(cleanup);

describe('owner field', () => {
  it('offers the active people of the organisation, and nobody', async () => {
    const onChange = vi.fn();
    render(<OwnerField id="owner" value="u1" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Owner' }).textContent).toContain('Sam Carter');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Owner' }), { key: 'ArrowDown' });
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    // A person with no name shows by email; someone removed from the organisation is not offered.
    expect(options).toEqual(['Nobody', 'Sam Carter', 'priya@example.com', 'Elena Rossi']);
    fireEvent.keyDown(await screen.findByRole('option', { name: 'priya@example.com' }), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('u2');
  });

  it('can set nobody, and keeps showing an owner who has left', async () => {
    const onChange = vi.fn();
    render(<OwnerField id="owner" value="u3" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Owner' }).textContent).toContain('Former teammate');
    await choose('Nobody');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('names an owner for the page', () => {
    const members = h.organization.organization.members;
    expect(ownerName(members, 'u1')).toBe('Sam Carter');
    expect(ownerName(members, 'u2')).toBe('priya@example.com');
    expect(ownerName(members, 'someone-else')).toBe('Former teammate');
    expect(ownerName(members, null)).toBeNull();
  });
});

describe('saving a new owner', () => {
  it('saves the owner of a lead, and leaves it alone when it was not sent', async () => {
    await updateContact('lead-1', { ownerId: 'u2' });
    expect(h.updates[0]).toEqual({ table: 'crm_contacts', row: { owner_id: 'u2' } });
    await updateContact('lead-1', { ownerId: null });
    expect(h.updates[1].row).toEqual({ owner_id: null });
    await updateContact('lead-1', { firstName: 'Elena' });
    expect(h.updates[2].row).toEqual({ first_name: 'Elena' });
  });

  it('saves the owner of a deal', async () => {
    await updateDeal('deal-1', { ownerId: 'u2' });
    expect(h.updates[0]).toEqual({ table: 'crm_deals', row: { owner_id: 'u2' } });
    await updateDeal('deal-1', { name: 'Website' });
    expect(h.updates[1].row).toEqual({ name: 'Website' });
  });
});
