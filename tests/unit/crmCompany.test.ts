import { describe, expect, it } from 'vitest';
import { companyDealSummary, dealHandoffState, dealStatusPill } from '@/lib/crmCompany';
import type { CrmDeal } from '@/types/crmHub';

const deal = (overrides: Partial<CrmDeal> = {}): CrmDeal => ({
  id: 'd', organizationId: 'o', ownerId: null, stageId: 's', companyId: 'c', contactId: null,
  name: 'Deal', value: 100, probability: 50, status: 'open', expectedCloseDate: null,
  source: null, notes: null, sortOrder: 0, workspaceId: 'w', projectId: null,
  closedAt: null, lostReason: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

describe('companyDealSummary', () => {
  it('returns zeros for a company with no deals', () => {
    expect(companyDealSummary([])).toEqual({
      open: 0, won: 0, lost: 0, openValue: 0, wonValue: 0, projects: 0, awaitingHandoff: 0,
    });
  });

  it('counts deals and adds up value by status', () => {
    const result = companyDealSummary([
      deal({ id: '1', status: 'open', value: 1000 }),
      deal({ id: '2', status: 'open', value: 250.5 }),
      deal({ id: '3', status: 'won', value: 4000, projectId: 'p1' }),
      deal({ id: '4', status: 'lost', value: 9000 }),
    ]);
    expect(result).toMatchObject({ open: 2, won: 1, lost: 1, openValue: 1250.5, wonValue: 4000 });
  });

  it('leaves lost deals out of both value totals', () => {
    const result = companyDealSummary([deal({ status: 'lost', value: 500 })]);
    expect(result).toMatchObject({ openValue: 0, wonValue: 0 });
  });

  it('counts each project once, whatever the status of the deals linked to it', () => {
    const result = companyDealSummary([
      deal({ id: '1', status: 'won', projectId: 'p1' }),
      deal({ id: '2', status: 'won', projectId: 'p1' }),
      deal({ id: '3', status: 'open', projectId: 'p2' }),
      deal({ id: '4', status: 'won', projectId: null }),
    ]);
    expect(result.projects).toBe(2);
  });

  it('counts won deals without a project as awaiting handoff', () => {
    const result = companyDealSummary([
      deal({ id: '1', status: 'won', projectId: null }),
      deal({ id: '2', status: 'won', projectId: 'p1' }),
      deal({ id: '3', status: 'open', projectId: null }),
      deal({ id: '4', status: 'lost', projectId: null }),
    ]);
    expect(result.awaitingHandoff).toBe(1);
  });

  it('treats a missing or invalid value as zero', () => {
    const result = companyDealSummary([
      deal({ id: '1', status: 'open', value: Number.NaN }),
      deal({ id: '2', status: 'open', value: null as unknown as number }),
      deal({ id: '3', status: 'open', value: 40 }),
    ]);
    expect(result.openValue).toBe(40);
  });
});

describe('dealStatusPill', () => {
  it('maps each status to its label and tone', () => {
    expect(dealStatusPill(deal({ status: 'open' }))).toEqual({ label: 'Open', tone: 'info' });
    expect(dealStatusPill(deal({ status: 'won' }))).toEqual({ label: 'Won', tone: 'success' });
    expect(dealStatusPill(deal({ status: 'lost' }))).toEqual({ label: 'Lost', tone: 'danger' });
  });
});

describe('dealHandoffState', () => {
  it('is "project" for any deal linked to a project', () => {
    expect(dealHandoffState(deal({ status: 'won', projectId: 'p1' }))).toBe('project');
    expect(dealHandoffState(deal({ status: 'open', projectId: 'p1' }))).toBe('project');
  });

  it('is "awaiting" for a won deal with no project', () => {
    expect(dealHandoffState(deal({ status: 'won', projectId: null }))).toBe('awaiting');
  });

  it('is "none" for open and lost deals with no project', () => {
    expect(dealHandoffState(deal({ status: 'open', projectId: null }))).toBe('none');
    expect(dealHandoffState(deal({ status: 'lost', projectId: null }))).toBe('none');
  });
});
