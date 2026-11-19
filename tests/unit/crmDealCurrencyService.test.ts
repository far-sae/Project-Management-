// Saving a deal's currency, and still saving the deal when the database has no currency column yet.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  /** Every write sent to crm_deals, in order. */
  writes: [] as Array<{ kind: 'insert' | 'update' | 'select'; row?: Record<string, unknown> }>,
  /** False until migration 182 has been run. */
  hasCurrencyColumn: true,
  /** The row as it is in the database before an update. */
  existing: {} as Record<string, unknown>,
}));

vi.mock('@/services/supabase/config', () => {
  const stamp = { created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z' };
  const answer = (kind: 'insert' | 'update' | 'select', row?: Record<string, unknown>) => {
    db.writes.push({ kind, row });
    if (row && 'currency' in row && !db.hasCurrencyColumn) {
      return {
        data: null,
        error: { code: 'PGRST204', message: "Could not find the 'currency' column of 'crm_deals' in the schema cache" },
      };
    }
    const data: Record<string, unknown> = { id: 'deal-1', ...stamp, ...db.existing, ...(row ?? {}) };
    if (!db.hasCurrencyColumn) delete data.currency;
    return { data, error: null };
  };
  const result = (kind: 'insert' | 'update' | 'select', row?: Record<string, unknown>) => {
    const chain = {
      eq: () => chain,
      select: () => chain,
      single: async () => answer(kind, row),
      maybeSingle: async () => answer(kind, row),
    };
    return chain;
  };
  return {
    supabase: {
      from: () => ({
        insert: (row: Record<string, unknown>) => result('insert', row),
        update: (row: Record<string, unknown>) => result('update', row),
        select: () => result('select'),
      }),
    },
  };
});
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

import { createDeal, getDeal, updateDeal } from '@/services/supabase/crmHub/deals';

const input = { organizationId: 'o', workspaceId: 'w', name: 'Northwind website', stageId: 's1', value: 12000 };

beforeEach(() => {
  db.writes.length = 0;
  db.hasCurrencyColumn = true;
  db.existing = {
    organization_id: 'o', stage_id: 's1', name: 'Northwind website', value: 12000, probability: 0, status: 'open',
    sort_order: 0,
  };
});

describe('reading a deal', () => {
  it('reads the deal’s currency', async () => {
    db.existing.currency = 'USD';
    expect((await getDeal('deal-1'))?.currency).toBe('USD');
  });

  it('has no currency of its own when none is stored', async () => {
    expect((await getDeal('deal-1'))?.currency).toBeNull();
    db.existing.currency = '';
    expect((await getDeal('deal-1'))?.currency).toBeNull();
  });
});

describe('creating a deal', () => {
  it('saves the chosen currency', async () => {
    const deal = await createDeal({ ...input, currency: 'usd' }, 'u1');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]!.row).toMatchObject({ value: 12000, currency: 'USD' });
    expect(deal.currency).toBe('USD');
  });

  it('never saves an empty currency', async () => {
    for (const currency of [undefined, null, '', '  ']) {
      db.writes.length = 0;
      const deal = await createDeal({ ...input, currency }, 'u1');
      expect(db.writes[0]!.row).not.toHaveProperty('currency');
      expect(deal.currency).toBeNull();
    }
  });

  it('still creates the deal when the currency column is not there yet', async () => {
    db.hasCurrencyColumn = false;
    const deal = await createDeal({ ...input, currency: 'USD' }, 'u1');
    expect(db.writes).toHaveLength(2);
    expect(db.writes[1]!.row).not.toHaveProperty('currency');
    expect(db.writes[1]!.row).toMatchObject({ name: 'Northwind website', value: 12000 });
    expect(deal).toMatchObject({ name: 'Northwind website', value: 12000, currency: null });
  });
});

describe('updating a deal', () => {
  it('saves a new currency', async () => {
    const deal = await updateDeal('deal-1', { value: 500, currency: 'eur' });
    expect(db.writes).toEqual([{ kind: 'update', row: { value: 500, currency: 'EUR' } }]);
    expect(deal.currency).toBe('EUR');
  });

  it('leaves the currency alone when it is not part of the change', async () => {
    db.existing.currency = 'USD';
    const deal = await updateDeal('deal-1', { name: 'Northwind site' });
    expect(db.writes[0]!.row).toEqual({ name: 'Northwind site' });
    expect(deal.currency).toBe('USD');
  });

  it('stores "back to the company currency" as nothing, not as an empty text', async () => {
    db.existing.currency = 'USD';
    await updateDeal('deal-1', { currency: '' });
    expect(db.writes[0]!.row).toEqual({ currency: null });
    db.writes.length = 0;
    await updateDeal('deal-1', { currency: null });
    expect(db.writes[0]!.row).toEqual({ currency: null });
  });

  it('still saves the rest when the currency column is not there yet', async () => {
    db.hasCurrencyColumn = false;
    const deal = await updateDeal('deal-1', { value: 500, currency: 'USD' });
    expect(db.writes).toEqual([
      { kind: 'update', row: { value: 500, currency: 'USD' } },
      { kind: 'update', row: { value: 500 } },
    ]);
    expect(deal).toMatchObject({ value: 500, currency: null });
  });

  it('does not send an empty change when only the currency was changed and the column is missing', async () => {
    db.hasCurrencyColumn = false;
    const deal = await updateDeal('deal-1', { currency: 'USD' });
    expect(db.writes.map((w) => w.kind)).toEqual(['update', 'select']);
    expect(deal).toMatchObject({ name: 'Northwind website', currency: null });
  });
});
