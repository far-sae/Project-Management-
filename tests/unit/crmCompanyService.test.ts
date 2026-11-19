// Saving a company keeps working on a database that does not have the newer company columns yet.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  hasNewColumns: true,
  writes: [] as Array<{ kind: 'insert' | 'update'; row: Record<string, unknown> }>,
}));

const NEW = ['type', 'state', 'postal_code', 'linkedin_url'];
const stored = (row: Record<string, unknown>) => ({
  id: 'c1', organization_id: 'o', workspace_id: 'w', owner_id: 'u1', name: 'Northwind Studio',
  created_at: '2026-11-19T10:00:00Z', updated_at: '2026-11-19T10:00:00Z', ...row,
});
const result = (kind: 'insert' | 'update', row: Record<string, unknown>) => {
  h.writes.push({ kind, row });
  const refused = !h.hasNewColumns && NEW.some((column) => column in row);
  return {
    select: () => ({
      single: async () => (refused
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'type' column of 'crm_companies' in the schema cache" } }
        : { data: stored(row), error: null }),
    }),
  };
};

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => result('insert', row),
      update: (row: Record<string, unknown>) => ({ eq: () => result('update', row) }),
    }),
  },
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

import { createCompany, updateCompany } from '@/services/supabase/crmHub/companies';

beforeEach(() => {
  h.hasNewColumns = true;
  h.writes = [];
});

const input = {
  organizationId: 'o', workspaceId: 'w', name: 'Northwind Studio', website: 'northwind.example',
  type: 'Customer', state: 'Greater London', postalCode: 'EC1V 2NX', linkedinUrl: 'linkedin.com/company/northwind',
};

describe('createCompany', () => {
  it('saves the kind of company, the rest of the address and the LinkedIn page', async () => {
    const company = await createCompany(input, 'u1');
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.row).toMatchObject({
      type: 'Customer', state: 'Greater London', postal_code: 'EC1V 2NX', linkedin_url: 'linkedin.com/company/northwind',
    });
    expect(company).toMatchObject({ type: 'Customer', state: 'Greater London', postalCode: 'EC1V 2NX' });
  });

  it('still saves the company when the database has no such columns yet', async () => {
    h.hasNewColumns = false;
    const company = await createCompany(input, 'u1');
    expect(h.writes).toHaveLength(2);
    expect(NEW.some((column) => column in h.writes[1]!.row)).toBe(false);
    expect(h.writes[1]!.row).toMatchObject({ name: 'Northwind Studio', website: 'northwind.example' });
    expect(company).toMatchObject({ name: 'Northwind Studio', type: null, postalCode: null });
  });
});

describe('updateCompany', () => {
  it('changes the owner and the kind of company', async () => {
    await updateCompany('c1', { ownerId: 'u2', type: 'Partner' });
    expect(h.writes[0]!.row).toEqual({ owner_id: 'u2', type: 'Partner' });
  });

  it('saves the rest when the database has no such columns yet', async () => {
    h.hasNewColumns = false;
    await updateCompany('c1', { city: 'Leeds', type: 'Partner' });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]!.row).toEqual({ city: 'Leeds' });
  });
});
