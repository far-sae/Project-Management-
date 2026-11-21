import { leadPatchAfterDeals } from '@/lib/crmFlow';
import { supabase } from '../config';
import type { CrmDeal, CreateDealInput, UpdateDealInput, DealStatus } from '@/types/crmHub';
import { tryLogActivity } from './activities';
import { applyWorkspaceFilter } from './workspaceFilter';
import { projectMatchesDealWorkspace } from '@/lib/crmWorkspace';

interface DealRow {
  id: string;
  organization_id: string;
  owner_id: string | null;
  stage_id: string;
  company_id: string | null;
  contact_id: string | null;
  name: string;
  value: number | string;
  currency?: string | null;
  probability: number;
  status: DealStatus;
  expected_close_date: string | null;
  source: string | null;
  notes: string | null;
  sort_order: number;
  workspace_id: string | null;
  project_id: string | null;
  closed_at?: string | null;
  lost_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * True when the database does not have the close-date / lost-reason columns
 * yet (migration 180 not run). The write is then repeated without them.
 */
const isCloseFieldsMissing = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  const msg = e?.message ?? '';
  return (
    (e?.code === 'PGRST204' || e?.code === '42703' || /column/i.test(msg)) &&
    /closed_at|lost_reason/.test(msg)
  );
};

/**
 * True when the database does not have the deal currency column yet
 * (migration 182 not run). The write is then repeated without it.
 */
const isCurrencyMissing = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  const msg = e?.message ?? '';
  return (e?.code === 'PGRST204' || e?.code === '42703' || /column/i.test(msg)) && /currency/.test(msg);
};

/** The currency as it is stored: an upper-case code, or null for the company currency. */
const storedCurrency = (code: string | null | undefined): string | null => code?.trim().toUpperCase() || null;

const mapDeal = (r: DealRow): CrmDeal => ({
  id: r.id,
  organizationId: r.organization_id,
  ownerId: r.owner_id,
  stageId: r.stage_id,
  companyId: r.company_id,
  contactId: r.contact_id,
  name: r.name,
  value: Number(r.value),
  currency: storedCurrency(r.currency),
  probability: r.probability,
  status: r.status,
  expectedCloseDate: r.expected_close_date,
  source: r.source,
  notes: r.notes,
  sortOrder: r.sort_order,
  workspaceId: r.workspace_id ?? null,
  projectId: r.project_id ?? null,
  closedAt: r.closed_at ? new Date(r.closed_at) : null,
  lostReason: r.lost_reason ?? null,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

interface ListDealsOptions {
  contactId?: string;
  companyId?: string;
}

export const listDeals = async (
  organizationId: string,
  opts: ListDealsOptions & { workspaceId?: string | null } = {},
): Promise<CrmDeal[]> => {
  let q = supabase
    .from('crm_deals')
    .select('*')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true });
  if (opts.contactId) q = q.eq('contact_id', opts.contactId);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  q = applyWorkspaceFilter(q, opts.workspaceId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapDeal);
};

export const getDeal = async (id: string): Promise<CrmDeal | null> => {
  const { data, error } = await supabase.from('crm_deals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapDeal(data) : null;
};

export const createDeal = async (input: CreateDealInput, ownerId: string | null): Promise<CrmDeal> => {
  const row = {
    organization_id: input.organizationId,
    workspace_id: input.workspaceId ?? null,
    owner_id: ownerId,
    stage_id: input.stageId,
    company_id: input.companyId ?? null,
    contact_id: input.contactId ?? null,
    name: input.name,
    value: input.value ?? 0,
    probability: input.probability ?? 0,
    // A deal created straight into a Won / Lost stage is closed, not open.
    status: input.status ?? 'open',
    expected_close_date: input.expectedCloseDate ?? null,
    source: input.source ?? null,
    notes: input.notes ?? null,
  };
  // Left out when the deal is in the company currency, which is stored as null.
  const currency = storedCurrency(input.currency);
  const insert = (values: Record<string, unknown>) => supabase.from('crm_deals').insert(values).select().single();
  let { data, error } = await insert(currency ? { ...row, currency } : row);
  if (error && currency && isCurrencyMissing(error)) {
    ({ data, error } = await insert(row));
  }
  if (error) throw error;
  const deal = mapDeal(data);
  tryLogActivity(
    {
      organizationId: deal.organizationId,
      workspaceId: deal.workspaceId,
      type: 'deal_created',
      dealId: deal.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      description: deal.name,
      metadata: { value: deal.value, currency: deal.currency },
    },
    ownerId,
  );
  return deal;
};

export const updateDeal = async (id: string, input: UpdateDealInput): Promise<CrmDeal> => {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.value !== undefined) patch.value = input.value;
  if (input.currency !== undefined) patch.currency = storedCurrency(input.currency);
  if (input.probability !== undefined) patch.probability = input.probability;
  if (input.stageId !== undefined) patch.stage_id = input.stageId;
  if (input.companyId !== undefined) patch.company_id = input.companyId;
  if (input.contactId !== undefined) patch.contact_id = input.contactId;
  if (input.expectedCloseDate !== undefined) patch.expected_close_date = input.expectedCloseDate;
  if (input.source !== undefined) patch.source = input.source;
  if (input.notes !== undefined) patch.notes = input.notes;

  const update = (values: Record<string, unknown>) =>
    supabase.from('crm_deals').update(values).eq('id', id).select().single();
  let { data, error } = await update(patch);
  if (error && 'currency' in patch && isCurrencyMissing(error)) {
    const rest = { ...patch };
    delete rest.currency;
    // Nothing else to save: hand back the deal as it is.
    ({ data, error } = Object.keys(rest).length > 0
      ? await update(rest)
      : await supabase.from('crm_deals').select('*').eq('id', id).single());
  }
  if (error) throw error;
  return mapDeal(data);
};

export interface MoveDealExtras {
  /** New chance of winning (see `probabilityAfterMove`). */
  probability?: number;
  /** Why it was lost; only kept when the target stage is a lost stage. */
  lostReason?: string | null;
  /** Who moved it, for the activity log. Defaults to the deal owner. */
  actorId?: string | null;
}

/**
 * Puts the lead on the step its deals now say: Customer once one is won, Deal
 * open while one is open, back to Qualified when every one is lost. Called
 * after a deal changes status. It never throws: the deal has already moved,
 * and a lead left one step behind is better than a move that looks failed.
 */
export const syncLeadStepWithDeals = async (contactId: string | null): Promise<void> => {
  if (!contactId) return;
  try {
    const [lead, deals] = await Promise.all([
      supabase.from('crm_contacts').select('lifecycle_stage, lead_status').eq('id', contactId).maybeSingle(),
      supabase.from('crm_deals').select('status').eq('contact_id', contactId),
    ]);
    if (lead.error || deals.error || !lead.data) return;
    const patch = leadPatchAfterDeals(
      { lifecycleStage: String(lead.data.lifecycle_stage ?? ''), leadStatus: String(lead.data.lead_status ?? '') },
      ((deals.data ?? []) as Array<{ status: DealStatus }>).map((d) => d.status),
    );
    if (!patch) return;
    await supabase
      .from('crm_contacts')
      .update({ lifecycle_stage: patch.lifecycleStage, lead_status: patch.leadStatus })
      .eq('id', contactId);
  } catch (err) {
    console.warn('[crm] could not update the lead after its deal moved', err);
  }
};

/**
 * Move a deal to a new stage. The status follows the stage (open / won /
 * lost); closing a deal stamps the close date and, when lost, the reason.
 * The lead behind the deal then follows: see syncLeadStepWithDeals.
 */
export const moveDealToStage = async (
  id: string,
  stageId: string,
  stageStatus: DealStatus,
  stageName?: string,
  extras: MoveDealExtras = {},
): Promise<CrmDeal> => {
  const base: Record<string, unknown> = { stage_id: stageId, status: stageStatus };
  if (extras.probability !== undefined) base.probability = extras.probability;
  const closeFields = {
    closed_at: stageStatus === 'open' ? null : new Date().toISOString(),
    lost_reason: stageStatus === 'lost' ? extras.lostReason?.trim() || null : null,
  };
  let { data, error } = await supabase
    .from('crm_deals')
    .update({ ...base, ...closeFields })
    .eq('id', id)
    .select()
    .single();
  if (error && isCloseFieldsMissing(error)) {
    ({ data, error } = await supabase.from('crm_deals').update(base).eq('id', id).select().single());
  }
  if (error) throw error;
  const deal = mapDeal(data);
  const activityType =
    stageStatus === 'won' ? 'deal_won'
    : stageStatus === 'lost' ? 'deal_lost'
    : 'deal_stage_changed';
  tryLogActivity(
    {
      organizationId: deal.organizationId,
      workspaceId: deal.workspaceId,
      type: activityType,
      dealId: deal.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      description:
        stageStatus === 'lost' && extras.lostReason?.trim()
          ? `Lost: ${extras.lostReason.trim()}`
          : stageName
            ? `Moved to ${stageName}`
            : null,
      metadata: { stageId, stageStatus },
    },
    extras.actorId ?? deal.ownerId,
  );
  await syncLeadStepWithDeals(deal.contactId);
  return deal;
};

/** The deal (if any) that was handed off into this project. */
export const getDealForProject = async (projectId: string): Promise<CrmDeal | null> => {
  const { data, error } = await supabase
    .from('crm_deals')
    .select('*')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? mapDeal(data[0]) : null;
};

export const deleteDeal = async (id: string): Promise<void> => {
  const { error } = await supabase.from('crm_deals').delete().eq('id', id);
  if (error) throw error;
};

/** Store the workspace/project link created by a Deal-Won handoff. */
export const linkDealHandoff = async (
  id: string,
  patch: { workspaceId?: string | null; projectId?: string | null },
): Promise<CrmDeal> => {
  if (!patch.workspaceId || !patch.projectId) {
    throw new Error('A deal handoff requires a workspace and project.');
  }
  const [{ data: dealScope, error: dealError }, { data: projectScope, error: projectError }] = await Promise.all([
    supabase.from('crm_deals').select('organization_id, workspace_id').eq('id', id).single(),
    supabase.from('projects').select('organization_id, workspace_id').eq('project_id', patch.projectId).single(),
  ]);
  if (dealError) throw dealError;
  if (projectError) throw projectError;
  if (dealScope.organization_id !== projectScope.organization_id || !projectMatchesDealWorkspace(
    dealScope.workspace_id as string | null,
    projectScope.workspace_id as string | null,
    patch.workspaceId,
  )) {
    throw new Error('The deal and project must belong to the same workspace.');
  }
  const row: Record<string, unknown> = {};
  if (patch.workspaceId !== undefined) row.workspace_id = patch.workspaceId;
  if (patch.projectId !== undefined) row.project_id = patch.projectId;
  const { data, error } = await supabase
    .from('crm_deals')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  const deal = mapDeal(data);
  tryLogActivity(
    {
      organizationId: deal.organizationId,
      workspaceId: deal.workspaceId,
      type: 'deal_updated',
      dealId: deal.id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      description: patch.projectId
        ? 'Handed off to project'
        : patch.workspaceId
        ? 'Handed off to workspace'
        : 'Handoff cleared',
      metadata: { workspaceId: patch.workspaceId ?? null, projectId: patch.projectId ?? null },
    },
    deal.ownerId,
  );
  return deal;
};
