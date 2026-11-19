// Where a lead is in the flow, in one plain word, and what a deal's badge says.
import { describe, expect, it } from 'vitest';
import { LEAD_STEPS, dealBadge, leadOwnerMatches, leadStep, leadStepPatch } from '@/lib/crmFlow';

const lead = (lifecycleStage: string, leadStatus: string) => ({ lifecycleStage, leadStatus });

describe('leadStep', () => {
  it('starts as New', () => {
    expect(leadStep(lead('lead', 'new'))).toBe('new');
    expect(leadStep(lead('subscriber', 'new'))).toBe('new');
  });

  it('is Contacted once someone has worked it', () => {
    for (const status of ['open', 'in_progress', 'attempted_to_contact', 'connected']) {
      expect(leadStep(lead('lead', status))).toBe('contacted');
    }
  });

  it('is Qualified when the lifecycle says so', () => {
    expect(leadStep(lead('sales_qualified_lead', 'connected'))).toBe('qualified');
    expect(leadStep(lead('marketing_qualified_lead', 'new'))).toBe('qualified');
  });

  it('has a deal open after conversion', () => {
    expect(leadStep(lead('opportunity', 'open_deal'))).toBe('deal');
    expect(leadStep(lead('lead', 'open_deal'))).toBe('deal');
  });

  it('is a Customer after a won deal, whatever the old status was', () => {
    expect(leadStep(lead('customer', 'open_deal'))).toBe('customer');
    expect(leadStep(lead('evangelist', 'unqualified'))).toBe('customer');
  });

  it('is Unqualified when ruled out or the timing is wrong', () => {
    expect(leadStep(lead('lead', 'unqualified'))).toBe('unqualified');
    expect(leadStep(lead('sales_qualified_lead', 'bad_timing'))).toBe('unqualified');
  });

  it('every step has a label and a tone', () => {
    for (const step of ['new', 'contacted', 'qualified', 'deal', 'customer', 'unqualified'] as const) {
      expect(LEAD_STEPS[step].label).toBeTruthy();
      expect(LEAD_STEPS[step].tone).toBeTruthy();
    }
  });
});

describe('leadStepPatch', () => {
  it('round-trips: saving a step and reading it back gives the same step', () => {
    for (const step of ['new', 'contacted', 'qualified', 'unqualified'] as const) {
      const patch = leadStepPatch(step);
      expect(leadStep({ lifecycleStage: patch.lifecycleStage ?? 'lead', leadStatus: patch.leadStatus })).toBe(step);
    }
  });

  it('re-opening an unqualified lead clears the ruled-out status', () => {
    expect(leadStepPatch('contacted').leadStatus).toBe('connected');
    expect(leadStepPatch('unqualified').lifecycleStage).toBeUndefined();
  });
});

describe('dealBadge', () => {
  it('says Open, Won or Lost', () => {
    expect(dealBadge({ status: 'open', projectId: null })).toEqual({ label: 'Open', tone: 'info' });
    expect(dealBadge({ status: 'lost', projectId: null })).toEqual({ label: 'Lost', tone: 'danger' });
  });

  it('tells a won deal waiting for hand-off apart from one in delivery', () => {
    expect(dealBadge({ status: 'won', projectId: null })).toEqual({ label: 'Won · needs hand-off', tone: 'warning' });
    expect(dealBadge({ status: 'won', projectId: 'p1' })).toEqual({ label: 'Won · in delivery', tone: 'success' });
  });
});

describe('leadOwnerMatches', () => {
  it('shows every lead under All leads, whoever owns it', () => {
    for (const owner of ['me', 'someone-else', null]) expect(leadOwnerMatches('all', owner, 'me')).toBe(true);
  });
  it('shows only my own under My leads', () => {
    expect(leadOwnerMatches('mine', 'me', 'me')).toBe(true);
    expect(leadOwnerMatches('mine', 'someone-else', 'me')).toBe(false);
    expect(leadOwnerMatches('mine', null, 'me')).toBe(false);
  });
  it('shows leads nobody has taken under No owner', () => {
    expect(leadOwnerMatches('none', null, 'me')).toBe(true);
    expect(leadOwnerMatches('none', 'me', 'me')).toBe(false);
  });
});
