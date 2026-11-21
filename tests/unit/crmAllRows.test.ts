// CRM lists read every row. The database hands out at most 1,000 rows per
// request, so a list that asked once was cut short at 1,000 without saying so.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ROWS, PAGE_ROWS, allRows } from '@/services/supabase/crmHub/allRows';

const h = vi.hoisted(() => ({
  total: 0,
  asked: [] as Array<{ table: string; orders: string[]; range: [number, number]; filters: string[] }>,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, orders: [] as string[], range: [0, 0] as [number, number], filters: [] as string[] };
      const link: Record<string, unknown> = {
        select: () => link,
        eq: (column: string, value: unknown) => { call.filters.push(`${column}=${String(value)}`); return link; },
        is: (column: string) => { call.filters.push(`${column} is null`); return link; },
        order: (column: string) => { call.orders.push(column); return link; },
        range: (from: number, to: number) => {
          call.range = [from, to];
          h.asked.push(call);
          const rows = Array.from({ length: Math.max(0, Math.min(to + 1, h.total) - from) }, (_, i) => ({
            id: `row-${from + i}`, organization_id: 'o', workspace_id: 'w', first_name: `Lead ${from + i}`, name: `Name ${from + i}`,
            created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', title: `Task ${from + i}`, priority: 'medium', status: 'pending',
          }));
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return link;
    },
  },
}));

beforeEach(() => { h.total = 0; h.asked.length = 0; });

describe('reading every row', () => {
  const pages = (total: number) => {
    const asked: Array<[number, number]> = [];
    const page = (from: number, to: number) => {
      asked.push([from, to]);
      return Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null });
    };
    return { asked, page };
  };

  it('asks once when the list fits in one request', async () => {
    const { asked, page } = pages(240);
    expect(await allRows(page)).toHaveLength(240);
    expect(asked).toEqual([[0, PAGE_ROWS - 1]]);
  });

  it('keeps asking until a request comes back short', async () => {
    const { asked, page } = pages(2500);
    const rows = await allRows(page);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('asks once more when a request comes back exactly full, to learn there is nothing after it', async () => {
    const { asked, page } = pages(PAGE_ROWS);
    expect(await allRows(page)).toHaveLength(PAGE_ROWS);
    expect(asked).toHaveLength(2);
  });

  it('stops at the ceiling instead of reading without end', async () => {
    const { asked, page } = pages(MAX_ROWS * 2);
    expect(await allRows(page)).toHaveLength(MAX_ROWS);
    expect(asked).toHaveLength(MAX_ROWS / PAGE_ROWS);
  });

  it('passes on a refusal', async () => {
    await expect(allRows(() => Promise.resolve({ data: null, error: { message: 'not allowed' } }))).rejects.toMatchObject({ message: 'not allowed' });
  });
});

describe('the CRM lists', () => {
  it('leads: all 2,300 of them, in an order that does not shuffle between requests', async () => {
    const { listContacts } = await import('@/services/supabase/crmHub/contacts');
    h.total = 2300;
    const leads = await listContacts('o', { workspaceId: 'w' });
    expect(leads).toHaveLength(2300);
    expect(new Set(leads.map((l) => l.id)).size).toBe(2300);
    expect(h.asked.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    // The id breaks ties: without it two leads with the same first name could swap places between requests.
    for (const call of h.asked) {
      expect(call.orders).toEqual(['first_name', 'id']);
      expect(call.filters).toEqual(['organization_id=o', 'workspace_id=w']);
    }
  });

  it('companies, deals and follow-ups read past 1,000 too', async () => {
    const { listCompanies } = await import('@/services/supabase/crmHub/companies');
    const { listDeals } = await import('@/services/supabase/crmHub/deals');
    const { listTasks } = await import('@/services/supabase/crmHub/tasks');
    h.total = 1200;
    expect(await listCompanies('o', { workspaceId: 'w' })).toHaveLength(1200);
    expect(await listDeals('o', { workspaceId: 'w' })).toHaveLength(1200);
    expect(await listTasks('o', { workspaceId: 'w' })).toHaveLength(1200);
    for (const table of ['crm_companies', 'crm_deals', 'crm_tasks']) {
      const calls = h.asked.filter((c) => c.table === table);
      expect(calls.map((c) => c.range), table).toEqual([[0, 999], [1000, 1999]]);
      expect(calls[0].orders.at(-1), table).toBe('id');
    }
  });
});
