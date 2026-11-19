// Linking leads to companies by name: reuse the company when it exists, create it when it does not.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  existing: [] as Array<{ id: string; name: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, unknown]>,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {
        select: () => query,
        order: () => query,
        eq: (col: string, v: unknown) => { h.filters.push([col, v]); return query; },
        is: (col: string, v: unknown) => { h.filters.push([col, v]); return query; },
        then: (resolve: (v: unknown) => void) => resolve({ data: h.existing, error: null }),
        insert: (rows: Array<Record<string, unknown>>) => {
          h.inserted.push(...rows);
          return {
            select: async () => ({
              data: rows.map((r, i) => ({ id: `new-${i + 1}`, name: r.name })),
              error: null,
            }),
          };
        },
      };
      return query;
    },
  },
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

import { ensureCompaniesByName } from '@/services/supabase/crmHub/companies';
import { companyKey } from '@/lib/crmImport';

beforeEach(() => {
  h.existing = [{ id: 'c1', name: 'Northwind Studio' }];
  h.inserted = [];
  h.filters = [];
});

describe('ensureCompaniesByName', () => {
  it('reuses a company that is already there, whatever the capitals', async () => {
    const ids = await ensureCompaniesByName('o', 'w', ['northwind studio'], 'u1');
    expect(ids.get(companyKey('Northwind Studio'))).toBe('c1');
    expect(h.inserted).toEqual([]);
  });

  it('creates each missing company once, in this workspace', async () => {
    const ids = await ensureCompaniesByName('o', 'w', ['Harbour Dental', 'harbour dental ', 'Northwind Studio'], 'u1');
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ organization_id: 'o', workspace_id: 'w', owner_id: 'u1', name: 'Harbour Dental' });
    expect(ids.get(companyKey('Harbour Dental'))).toBe('new-1');
    expect(ids.get(companyKey('Northwind Studio'))).toBe('c1');
    expect(h.filters).toContainEqual(['workspace_id', 'w']);
  });

  it('fills in what the file says about a company it creates', async () => {
    await ensureCompaniesByName('o', 'w', [
      { name: 'Harbour Dental', website: 'harbour.example', city: 'Leeds', annual_revenue: 500000 },
      { name: 'harbour dental', website: 'ignored.example' },
      'Brightside Labs',
    ], 'u1');
    expect(h.inserted).toMatchObject([
      { name: 'Harbour Dental', website: 'harbour.example', city: 'Leeds', annual_revenue: 500000, industry: null },
      { name: 'Brightside Labs', website: null, city: null, annual_revenue: null },
    ]);
    expect(Object.keys(h.inserted[0]!).sort()).toEqual(Object.keys(h.inserted[1]!).sort());
  });

  it('does nothing when there are no names', async () => {
    const ids = await ensureCompaniesByName('o', 'w', ['', '  '], 'u1');
    expect(ids.size).toBe(0);
    expect(h.inserted).toEqual([]);
  });
});
