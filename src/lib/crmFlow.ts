/**
 * The rules of the CRM flow: lead → deal → won / lost → project hand-off.
 * Pure functions only, so each rule can be tested on its own.
 */

export type FlowDealStatus = 'open' | 'won' | 'lost';

export interface FlowStage {
  id: string;
  name: string;
  sortOrder: number;
  /** Chance of winning at this stage, 0–100. */
  probability: number;
  status: FlowDealStatus;
}

// ── Probability and forecast ────────────────────────────────────────────

/**
 * The deal's chance of winning after it moves to another stage. A deal that
 * never had its own figure (0, or still equal to its old stage's figure)
 * follows the new stage; a figure typed in by hand is kept. Won is always
 * 100 and lost is always 0.
 */
export function probabilityAfterMove(
  current: number,
  from: Pick<FlowStage, 'probability'> | null | undefined,
  to: Pick<FlowStage, 'probability' | 'status'>,
): number {
  if (to.status === 'won') return 100;
  if (to.status === 'lost') return 0;
  const followsStage = current === 0 || (from != null && current === from.probability);
  return followsStage ? to.probability : current;
}

/** What a deal is worth in the forecast: value × chance of winning. */
export function weightedDealValue(
  deal: { value: number; probability: number; status: FlowDealStatus; stageId: string },
  stagesById: Map<string, Pick<FlowStage, 'probability'>>,
): number {
  if (deal.status === 'won') return deal.value;
  if (deal.status === 'lost') return 0;
  const chance = deal.probability > 0 ? deal.probability : (stagesById.get(deal.stageId)?.probability ?? 0);
  return (deal.value * chance) / 100;
}

// ── Lead → deal ─────────────────────────────────────────────────────────

export function leadName(lead: { firstName: string; lastName: string | null; email: string | null }): string {
  const full = [lead.firstName, lead.lastName ?? ''].map((s) => s.trim()).filter(Boolean).join(' ');
  return full || lead.email?.trim() || 'Unnamed lead';
}

/** What the "Convert to deal" form starts with. */
export function conversionDefaults(
  lead: { firstName: string; lastName: string | null; email: string | null },
  company: { name: string } | null,
  stages: FlowStage[],
): { dealName: string; stageId: string | null } {
  const open = stages.filter((s) => s.status === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const qualified = open.find((s) => /qualif/i.test(s.name));
  const who = company?.name.trim() || leadName(lead);
  return {
    dealName: `${who} deal`,
    stageId: (qualified ?? open[0])?.id ?? null,
  };
}

// ── Won deal → project ──────────────────────────────────────────────────

/** A won deal that has not been turned into (or linked to) a project yet. */
export function dealNeedsHandoff(deal: { status: FlowDealStatus; projectId: string | null }): boolean {
  return deal.status === 'won' && !deal.projectId;
}

export function handoffProjectName(deal: { name: string }, company: { name: string } | null): string {
  const dealName = deal.name.trim();
  const companyName = company?.name.trim() ?? '';
  if (!dealName) return companyName || 'New project';
  if (!companyName || dealName.toLowerCase().includes(companyName.toLowerCase())) return dealName;
  return `${companyName} – ${dealName}`;
}

/** Project description that tells the delivery team what was sold and to whom. */
export function handoffDescription(input: {
  dealName: string;
  /** Already formatted, e.g. "£12,000". */
  value: string | null;
  companyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
}): string {
  const lines = [`Won deal: ${input.dealName}`];
  if (input.value) lines.push(`Value: ${input.value}`);
  if (input.companyName) lines.push(`Customer: ${input.companyName}`);
  if (input.contactName) {
    lines.push(`Contact: ${input.contactName}${input.contactEmail ? ` (${input.contactEmail})` : ''}`);
  } else if (input.contactEmail) {
    lines.push(`Contact: ${input.contactEmail}`);
  }
  if (input.notes?.trim()) lines.push('', input.notes.trim());
  return lines.join('\n');
}

export interface HandoffTaskDraft {
  title: string;
  /** Due this many days after the hand-off. */
  dueInDays: number;
  priority: 'low' | 'medium' | 'high';
}

/** Starter tasks offered when a won deal becomes a project. */
export function defaultHandoffTasks(contactName: string | null): HandoffTaskDraft[] {
  const who = contactName?.trim() || 'the customer';
  return [
    { title: `Kick-off call with ${who}`, dueInDays: 2, priority: 'high' },
    { title: 'Confirm scope and what was promised in the deal', dueInDays: 3, priority: 'high' },
    { title: 'Collect access, files and information from the customer', dueInDays: 5, priority: 'medium' },
    { title: 'Agree the timeline and milestones', dueInDays: 5, priority: 'medium' },
    { title: 'Plan the work and assign the team', dueInDays: 7, priority: 'medium' },
  ];
}

// ── Where a lead is in the flow ─────────────────────────────────────────

/**
 * The one-word answer to "where is this lead?". The database keeps two
 * HubSpot-style fields (lifecycle stage and lead status, sixteen values
 * between them); people think in these six steps.
 */
export type LeadStep = 'new' | 'contacted' | 'qualified' | 'deal' | 'customer' | 'unqualified';

export type FlowTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted';

export const LEAD_STEPS: Record<LeadStep, { label: string; tone: FlowTone; hint: string }> = {
  new: { label: 'New', tone: 'neutral', hint: 'Nobody has been in touch yet.' },
  contacted: { label: 'Contacted', tone: 'warning', hint: 'In conversation; not yet qualified.' },
  qualified: { label: 'Qualified', tone: 'info', hint: 'A real opportunity with no open deal. Convert it to a deal.' },
  deal: { label: 'Deal open', tone: 'info', hint: 'Has a deal in the pipeline.' },
  customer: { label: 'Customer', tone: 'success', hint: 'A deal was won.' },
  unqualified: { label: 'Unqualified', tone: 'muted', hint: 'Not a fit, or not now.' },
};

/** The steps a person can set by hand, in order. */
export const MANUAL_LEAD_STEPS: LeadStep[] = ['new', 'contacted', 'qualified', 'unqualified'];

export function leadStep(lead: { lifecycleStage: string; leadStatus: string }): LeadStep {
  if (lead.lifecycleStage === 'customer' || lead.lifecycleStage === 'evangelist') return 'customer';
  if (lead.leadStatus === 'unqualified' || lead.leadStatus === 'bad_timing') return 'unqualified';
  if (lead.lifecycleStage === 'opportunity' || lead.leadStatus === 'open_deal') return 'deal';
  if (lead.lifecycleStage === 'sales_qualified_lead' || lead.lifecycleStage === 'marketing_qualified_lead') {
    return 'qualified';
  }
  return lead.leadStatus === 'new' ? 'new' : 'contacted';
}

/**
 * What to save on a lead after one of its deals was won, lost or re-opened,
 * given the status of every deal the lead has now. Null means the lead is
 * already where it should be, or is not ours to move.
 *
 *   a won deal            the lead is a Customer
 *   no won, an open deal  the lead has a Deal open
 *   only lost deals       a lead that was on "Deal open" or "Customer" goes
 *                         back to Qualified, so it can be worked and converted
 *                         again; it is not marked unqualified, because losing
 *                         one deal does not make the person a bad fit
 *
 * A lead someone marked Unqualified by hand is left alone unless it has a won
 * or an open deal, which says more than the mark does.
 */
export function leadPatchAfterDeals(
  lead: { lifecycleStage: string; leadStatus: string },
  dealStatuses: FlowDealStatus[],
): { lifecycleStage: 'customer' | 'opportunity' | 'sales_qualified_lead'; leadStatus: 'open_deal' | 'connected' } | null {
  const step = leadStep(lead);
  if (dealStatuses.includes('won')) {
    return step === 'customer' ? null : { lifecycleStage: 'customer', leadStatus: 'connected' };
  }
  if (dealStatuses.includes('open')) {
    return step === 'deal' ? null : { lifecycleStage: 'opportunity', leadStatus: 'open_deal' };
  }
  if (step === 'deal' || step === 'customer') return { lifecycleStage: 'sales_qualified_lead', leadStatus: 'connected' };
  return null;
}

/** What to save on the lead when someone picks a step by hand. */
export function leadStepPatch(step: 'new' | 'contacted' | 'qualified' | 'unqualified'): {
  lifecycleStage?: 'lead' | 'sales_qualified_lead';
  leadStatus: 'new' | 'connected' | 'unqualified';
} {
  switch (step) {
    case 'new':
      return { lifecycleStage: 'lead', leadStatus: 'new' };
    case 'contacted':
      return { lifecycleStage: 'lead', leadStatus: 'connected' };
    case 'qualified':
      return { lifecycleStage: 'sales_qualified_lead', leadStatus: 'connected' };
    case 'unqualified':
      return { leadStatus: 'unqualified' };
  }
}

// ── Deal badge ──────────────────────────────────────────────────────────

/** What a deal's status badge says. A won deal is not finished until it is handed off. */
export function dealBadge(deal: { status: FlowDealStatus; projectId: string | null }): {
  label: string;
  tone: FlowTone;
} {
  if (deal.status === 'lost') return { label: 'Lost', tone: 'danger' };
  if (deal.status === 'open') return { label: 'Open', tone: 'info' };
  return deal.projectId
    ? { label: 'Won · in delivery', tone: 'success' }
    : { label: 'Won · needs hand-off', tone: 'warning' };
}

/** The owner filter on the Leads list: everyone's, mine, or not taken by anyone yet. */
export type LeadOwnerView = 'all' | 'mine' | 'none';

export function leadOwnerMatches(view: LeadOwnerView, ownerId: string | null, meId: string | null): boolean {
  if (view === 'mine') return ownerId !== null && ownerId === meId;
  if (view === 'none') return ownerId === null;
  return true;
}
