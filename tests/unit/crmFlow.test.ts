// CRM flow rules: lead → deal → won/lost → project hand-off.
import { describe, expect, it } from 'vitest';
import {
  conversionDefaults,
  dealNeedsHandoff,
  defaultHandoffTasks,
  handoffDescription,
  handoffProjectName,
  leadName,
  leadPatchAfterDeals,
  leadStep,
  leadStepPatch,
  MANUAL_LEAD_STEPS,
  probabilityAfterMove,
  weightedDealValue,
} from '@/lib/crmFlow';

const stage = (id: string, name: string, sortOrder: number, probability: number, status: 'open' | 'won' | 'lost' = 'open') => ({
  id,
  name,
  sortOrder,
  probability,
  status,
});

const stages = [
  stage('s1', 'New Lead', 0, 10),
  stage('s2', 'Qualified', 1, 25),
  stage('s3', 'Proposal Sent', 2, 60),
  stage('s4', 'Won', 3, 100, 'won'),
  stage('s5', 'Lost', 4, 0, 'lost'),
];

describe('probabilityAfterMove', () => {
  it('follows the stage when the deal was never given its own figure', () => {
    expect(probabilityAfterMove(0, stages[0], stages[1])).toBe(25);
    expect(probabilityAfterMove(10, stages[0], stages[2])).toBe(60);
  });

  it('keeps a figure someone typed in by hand', () => {
    expect(probabilityAfterMove(45, stages[0], stages[1])).toBe(45);
  });

  it('is always 100 when won and 0 when lost', () => {
    expect(probabilityAfterMove(45, stages[1], stages[3])).toBe(100);
    expect(probabilityAfterMove(45, stages[1], stages[4])).toBe(0);
  });
});

describe('weightedDealValue', () => {
  const byId = new Map(stages.map((s) => [s.id, s]));

  it('uses the stage chance when the deal has none of its own', () => {
    expect(weightedDealValue({ value: 1000, probability: 0, status: 'open', stageId: 's2' }, byId)).toBe(250);
  });

  it("uses the deal's own chance when it has one", () => {
    expect(weightedDealValue({ value: 1000, probability: 40, status: 'open', stageId: 's2' }, byId)).toBe(400);
  });

  it('counts a won deal in full and a lost deal as nothing', () => {
    expect(weightedDealValue({ value: 1000, probability: 0, status: 'won', stageId: 's4' }, byId)).toBe(1000);
    expect(weightedDealValue({ value: 1000, probability: 80, status: 'lost', stageId: 's5' }, byId)).toBe(0);
  });
});

describe('converting a lead into a deal', () => {
  it('names the lead from whatever is known', () => {
    expect(leadName({ firstName: 'Ana', lastName: 'Silva', email: 'a@x.io' })).toBe('Ana Silva');
    expect(leadName({ firstName: '', lastName: null, email: 'a@x.io' })).toBe('a@x.io');
    expect(leadName({ firstName: ' ', lastName: null, email: null })).toBe('Unnamed lead');
  });

  it('starts the deal in the Qualified stage, named after the company', () => {
    const d = conversionDefaults({ firstName: 'Ana', lastName: 'Silva', email: null }, { name: 'Acme Ltd' }, stages);
    expect(d.dealName).toBe('Acme Ltd deal');
    expect(d.stageId).toBe('s2');
  });

  it('names the deal after the person when there is no company', () => {
    const d = conversionDefaults({ firstName: 'Ana', lastName: 'Silva', email: null }, null, stages);
    expect(d.dealName).toBe('Ana Silva deal');
  });

  it('falls back to the first open stage when no stage is called Qualified', () => {
    const custom = [stage('a', 'Won', 0, 100, 'won'), stage('b', 'Discovery', 1, 20), stage('c', 'Quote', 2, 50)];
    expect(conversionDefaults({ firstName: 'Ana', lastName: null, email: null }, null, custom).stageId).toBe('b');
  });

  it('has no stage when the pipeline has no open stage at all', () => {
    expect(conversionDefaults({ firstName: 'Ana', lastName: null, email: null }, null, [stages[3]]).stageId).toBeNull();
  });
});

describe('handing a won deal to project management', () => {
  it('needs a hand-off only when won and not linked to a project yet', () => {
    expect(dealNeedsHandoff({ status: 'won', projectId: null })).toBe(true);
    expect(dealNeedsHandoff({ status: 'won', projectId: 'p1' })).toBe(false);
    expect(dealNeedsHandoff({ status: 'open', projectId: null })).toBe(false);
  });

  it('names the project after the customer and the deal', () => {
    expect(handoffProjectName({ name: 'Website rebuild' }, { name: 'Acme Ltd' })).toBe('Acme Ltd – Website rebuild');
    expect(handoffProjectName({ name: 'Website rebuild' }, null)).toBe('Website rebuild');
    expect(handoffProjectName({ name: 'Acme Ltd deal' }, { name: 'Acme Ltd' })).toBe('Acme Ltd deal');
    expect(handoffProjectName({ name: '  ' }, null)).toBe('New project');
  });

  it('carries the deal details into the project description', () => {
    const text = handoffDescription({
      dealName: 'Website rebuild',
      value: '£12,000',
      companyName: 'Acme Ltd',
      contactName: 'Ana Silva',
      contactEmail: 'ana@acme.io',
      notes: 'Wants to launch before March.',
    });
    expect(text).toContain('Won deal: Website rebuild');
    expect(text).toContain('Value: £12,000');
    expect(text).toContain('Customer: Acme Ltd');
    expect(text).toContain('Contact: Ana Silva (ana@acme.io)');
    expect(text).toContain('Wants to launch before March.');
  });

  it('leaves out description lines that have nothing to say', () => {
    const text = handoffDescription({ dealName: 'Website rebuild', value: null, companyName: null, contactName: null, contactEmail: null, notes: null });
    expect(text).toBe('Won deal: Website rebuild');
  });

  it('suggests starter tasks that mention the contact when there is one', () => {
    const tasks = defaultHandoffTasks('Ana Silva');
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(tasks[0].title).toBe('Kick-off call with Ana Silva');
    expect(tasks.every((t) => t.dueInDays >= 0 && ['low', 'medium', 'high'].includes(t.priority))).toBe(true);
    expect(defaultHandoffTasks(null)[0].title).toBe('Kick-off call with the customer');
  });
});

describe('a lead follows its deals', () => {
  const lead = (lifecycleStage: string, leadStatus: string) => ({ lifecycleStage, leadStatus });

  it('becomes a Customer as soon as one deal is won, with or without a project', () => {
    expect(leadPatchAfterDeals(lead('opportunity', 'open_deal'), ['won'])).toEqual({ lifecycleStage: 'customer', leadStatus: 'connected' });
    expect(leadPatchAfterDeals(lead('opportunity', 'open_deal'), ['lost', 'open', 'won'])).toEqual({ lifecycleStage: 'customer', leadStatus: 'connected' });
    expect(leadStep({ lifecycleStage: 'customer', leadStatus: 'connected' })).toBe('customer');
    // Already there: nothing to save.
    expect(leadPatchAfterDeals(lead('customer', 'connected'), ['won'])).toBeNull();
  });

  it('goes back to Qualified when its only deal is lost, so it no longer looks active', () => {
    const patch = leadPatchAfterDeals(lead('opportunity', 'open_deal'), ['lost']);
    expect(patch).toEqual({ lifecycleStage: 'sales_qualified_lead', leadStatus: 'connected' });
    expect(leadStep(patch!)).toBe('qualified');
    expect(leadPatchAfterDeals(lead('opportunity', 'open_deal'), ['lost', 'lost'])).toEqual(patch);
  });

  it('keeps "Deal open" while another deal is still open', () => {
    expect(leadPatchAfterDeals(lead('opportunity', 'open_deal'), ['lost', 'open'])).toBeNull();
  });

  it('follows a deal that is re-opened or un-won', () => {
    expect(leadPatchAfterDeals(lead('customer', 'connected'), ['open'])).toEqual({ lifecycleStage: 'opportunity', leadStatus: 'open_deal' });
    expect(leadPatchAfterDeals(lead('sales_qualified_lead', 'connected'), ['open'])).toEqual({ lifecycleStage: 'opportunity', leadStatus: 'open_deal' });
    expect(leadPatchAfterDeals(lead('customer', 'connected'), ['lost'])).toEqual({ lifecycleStage: 'sales_qualified_lead', leadStatus: 'connected' });
  });

  it('leaves alone a lead that has no deal to follow', () => {
    expect(leadPatchAfterDeals(lead('lead', 'new'), [])).toBeNull();
    expect(leadPatchAfterDeals(lead('lead', 'unqualified'), ['lost'])).toBeNull();
    expect(leadPatchAfterDeals(lead('sales_qualified_lead', 'connected'), ['lost'])).toBeNull();
  });
});

describe('an existing client, marked by hand', () => {
  const marked = { lifecycleStage: 'evangelist', leadStatus: 'connected' };

  it('is a customer on the page, and is saved in a way that says a person marked it', () => {
    expect(leadStepPatch('customer')).toEqual(marked);
    expect(leadStep(marked)).toBe('customer');
    expect(MANUAL_LEAD_STEPS).toContain('customer');
  });

  it('stays a client whatever happens to a deal', () => {
    // A lead that became a customer by winning a deal goes back when that deal is lost...
    expect(leadPatchAfterDeals({ lifecycleStage: 'customer', leadStatus: 'connected' }, ['lost'])).not.toBeNull();
    // ...somebody who was a client all along does not: losing new work does not make them a stranger.
    expect(leadPatchAfterDeals(marked, ['lost'])).toBeNull();
    expect(leadPatchAfterDeals(marked, ['open'])).toBeNull();
    expect(leadPatchAfterDeals(marked, [])).toBeNull();
    expect(leadPatchAfterDeals(marked, ['won'])).toBeNull();
  });
});
