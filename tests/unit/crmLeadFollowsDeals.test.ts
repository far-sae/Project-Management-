// A lead follows its deals: winning a deal makes it a Customer, losing its
// only deal takes it off "Deal open". This is the service that saves it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  lead: { lifecycle_stage: 'opportunity', lead_status: 'open_deal' } as Record<string, string> | null,
  deals: [] as Array<{ status: string }>,
  moved: null as Record<string, unknown> | null,
  leadUpdates: [] as Array<Record<string, unknown>>,
  failLeadRead: false,
}));

vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'crm_contacts') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => (db.failLeadRead ? { data: null, error: { message: 'down' } } : { data: db.lead, error: null }) }) }),
          update: (row: Record<string, unknown>) => ({ eq: async () => { db.leadUpdates.push(row); return { error: null }; } }),
        };
      }
      // crm_deals
      return {
        select: () => ({ eq: async () => ({ data: db.deals, error: null }) }),
        update: (row: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              single: async () => {
                db.moved = row;
                return {
                  data: {
                    id: 'deal-1', organization_id: 'org-1', workspace_id: 'ws-1', owner_id: 'u1', contact_id: 'lead-1', company_id: null,
                    name: 'Website', value: 1000, probability: 0, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', ...row,
                  },
                  error: null,
                };
              },
            }),
          }),
        }),
      };
    },
  },
}));
vi.mock('@/services/supabase/crmHub/activities', () => ({ tryLogActivity: vi.fn() }));

import { moveDealToStage, syncLeadStepWithDeals } from '@/services/supabase/crmHub/deals';

beforeEach(() => {
  db.lead = { lifecycle_stage: 'opportunity', lead_status: 'open_deal' };
  db.deals = [];
  db.moved = null;
  db.leadUpdates = [];
  db.failLeadRead = false;
});

describe('a lead follows its deals', () => {
  it('makes the lead a Customer when its deal is moved to a won stage', async () => {
    db.deals = [{ status: 'won' }];
    const deal = await moveDealToStage('deal-1', 'stage-won', 'won', 'Won');
    expect(deal.status).toBe('won');
    expect(db.leadUpdates).toEqual([{ lifecycle_stage: 'customer', lead_status: 'connected' }]);
  });

  it('takes the lead off "Deal open" when its only deal is lost', async () => {
    db.deals = [{ status: 'lost' }];
    await moveDealToStage('deal-1', 'stage-lost', 'lost', 'Lost', { lostReason: 'Price' });
    expect(db.leadUpdates).toEqual([{ lifecycle_stage: 'sales_qualified_lead', lead_status: 'connected' }]);
  });

  it('leaves the lead alone while another deal is still open, or when nothing changes', async () => {
    db.deals = [{ status: 'lost' }, { status: 'open' }];
    await moveDealToStage('deal-1', 'stage-lost', 'lost', 'Lost');
    expect(db.leadUpdates).toEqual([]);
    db.lead = { lifecycle_stage: 'customer', lead_status: 'connected' };
    db.deals = [{ status: 'won' }];
    await syncLeadStepWithDeals('lead-1');
    expect(db.leadUpdates).toEqual([]);
  });

  it('never fails the deal move because the lead could not be read', async () => {
    db.failLeadRead = true;
    db.deals = [{ status: 'won' }];
    await expect(moveDealToStage('deal-1', 'stage-won', 'won', 'Won')).resolves.toMatchObject({ id: 'deal-1' });
    expect(db.leadUpdates).toEqual([]);
    await expect(syncLeadStepWithDeals(null)).resolves.toBeUndefined();
  });
});
