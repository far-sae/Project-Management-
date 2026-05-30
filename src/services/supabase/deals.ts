import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type DealStage =
  | "lead"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export const DEAL_STAGES: { id: DealStage; label: string; color: string }[] = [
  { id: "lead", label: "Lead", color: "#94A3B8" },
  { id: "qualified", label: "Qualified", color: "#FB923C" },
  { id: "proposal", label: "Proposal", color: "#FACC15" },
  { id: "negotiation", label: "Negotiation", color: "#A855F7" },
  { id: "won", label: "Won", color: "#10B981" },
  { id: "lost", label: "Lost", color: "#EF4444" },
];

export const OPEN_STAGES: DealStage[] = [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
];

export const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number> = {
  lead: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export interface Deal {
  dealId: string;
  organizationId: string;
  clientId?: string | null;
  clientName?: string | null;
  title: string;
  description?: string | null;
  stage: DealStage;
  value: number;
  currency: string;
  probability: number;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  ownerId?: string | null;
  ownerName?: string | null;
  source?: string | null;
  tags: string[];
  position: number;
  lossReason?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  closedAt?: Date | null;
  closedBy?: string | null;
  pipelineId: string;
  stageId: string;
  // Zoho-style fields (migration 107).
  dealType?: string | null;        // new business | existing | renewal | …
  nextStep?: string | null;
  contactId?: string | null;
  leadSource?: string | null;
  campaignSource?: string | null;
  /** Free-form key/value pairs landed by the "Keep extra columns" UI in
   *  the CSV importer (migration 109). */
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDealInput {
  clientId?: string | null;
  clientName?: string | null;
  title: string;
  description?: string | null;
  stage?: DealStage;
  pipelineId?: string | null;
  stageId?: string | null;
  value?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  ownerId?: string | null;
  ownerName?: string | null;
  source?: string | null;
  tags?: string[];
  dealType?: string | null;
  nextStep?: string | null;
  contactId?: string | null;
  leadSource?: string | null;
  campaignSource?: string | null;
  customFields?: Record<string, unknown>;
}

export interface UpdateDealInput {
  clientId?: string | null;
  clientName?: string | null;
  title?: string;
  description?: string | null;
  stage?: DealStage;
  value?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: Date | null;
  actualCloseDate?: Date | null;
  ownerId?: string | null;
  ownerName?: string | null;
  source?: string | null;
  tags?: string[];
  position?: number;
  lossReason?: string | null;
  pipelineId?: string;
  stageId?: string;
  dealType?: string | null;
  nextStep?: string | null;
  contactId?: string | null;
  leadSource?: string | null;
  campaignSource?: string | null;
  customFields?: Record<string, unknown>;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string) => `pm_deals_${orgId}`;

const mapDeal = (row: Record<string, unknown>): Deal => ({
  dealId: row.deal_id as string,
  organizationId: row.organization_id as string,
  clientId: (row.client_id as string) ?? null,
  clientName: (row.client_name as string) ?? null,
  title: row.title as string,
  description: (row.description as string) ?? null,
  stage: ((row.stage as string) || "lead") as DealStage,
  value: row.value != null ? Number(row.value) : 0,
  currency: ((row.currency as string) || "USD").toUpperCase(),
  probability: row.probability != null ? Number(row.probability) : 10,
  expectedCloseDate: row.expected_close_date
    ? new Date(row.expected_close_date as string)
    : null,
  actualCloseDate: row.actual_close_date
    ? new Date(row.actual_close_date as string)
    : null,
  ownerId: (row.owner_id as string) ?? null,
  ownerName: (row.owner_name as string) ?? null,
  source: (row.source as string) ?? null,
  tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
  position: row.position != null ? Number(row.position) : 1000,
  lossReason: (row.loss_reason as string) ?? null,
  createdBy: (row.created_by as string) ?? null,
  createdByName: (row.created_by_name as string) ?? null,
  closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
  closedBy: (row.closed_by as string) ?? null,
  pipelineId: row.pipeline_id as string,
  stageId: row.stage_id as string,
  dealType: (row.deal_type as string) ?? null,
  nextStep: (row.next_step as string) ?? null,
  contactId: (row.contact_id as string) ?? null,
  leadSource: (row.lead_source as string) ?? null,
  campaignSource: (row.campaign_source as string) ?? null,
  customFields: (row.custom_fields as Record<string, unknown>) ?? {},
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const readLocal = (orgId: string): Deal[] => {
  try {
    const raw = localStorage.getItem(localKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as Deal[]).map((d) => ({
      ...d,
      expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate) : null,
      actualCloseDate: d.actualCloseDate ? new Date(d.actualCloseDate) : null,
      closedAt: d.closedAt ? new Date(d.closedAt) : null,
      createdAt: new Date(d.createdAt),
      updatedAt: new Date(d.updatedAt),
    }));
  } catch {
    return [];
  }
};
const writeLocal = (orgId: string, deals: Deal[]) =>
  localStorage.setItem(localKey(orgId), JSON.stringify(deals));

const isMissingRpcError = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string; details?: string };
  const text = `${e?.message ?? ""} ${e?.details ?? ""}`.toLowerCase();
  return e?.code === "PGRST202" || text.includes("could not find the function");
};

const friendlyDealCreateError = (error: unknown): Error => {
  const e = error as { code?: string; message?: string; details?: string };
  const msg = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  const combined = `${msg} ${details}`;

  if (e?.code === "P0001" && msg) {
    return new Error(msg);
  }
  if (e?.code === "42501" || /row-level security|permission denied/i.test(combined)) {
    return new Error(
      "You do not have permission to add deals in this workspace. Ask an admin to check your role or apply the latest CRM deal migration.",
    );
  }
  if (e?.code === "23503" || /foreign key/i.test(combined)) {
    return new Error("This deal is linked to a client or pipeline stage that no longer exists.");
  }
  if (
    e?.code === "23502" ||
    /null value in column \"(?:pipeline_id|stage_id)\"/i.test(combined)
  ) {
    return new Error(
      "The sales pipeline is not configured correctly yet. Ask an admin to apply the latest CRM deal migration.",
    );
  }
  if (e?.code === "23514" || /check constraint/i.test(combined)) {
    return new Error("Deal details are invalid. Check the stage, value, and required fields.");
  }
  return error instanceof Error ? error : new Error(msg || "Failed to create deal");
};

const friendlyDealUpdateError = (error: unknown): Error => {
  const e = error as { code?: string; message?: string; details?: string };
  const msg = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  const combined = `${msg} ${details}`;

  if (e?.code === "P0001" && msg) {
    return new Error(msg);
  }
  if (e?.code === "42501" || /row-level security|permission denied/i.test(combined)) {
    return new Error(
      "You do not have permission to move or edit this deal. Ask an admin to apply the latest CRM deal update migration or check your role.",
    );
  }
  if (e?.code === "23503" || /foreign key/i.test(combined)) {
    return new Error("This deal is linked to a client or pipeline stage that no longer exists.");
  }
  if (e?.code === "23514" || /check constraint/i.test(combined)) {
    return new Error("Deal details are invalid. Check the stage, value, and required fields.");
  }
  return error instanceof Error ? error : new Error(msg || "Failed to update deal");
};

const friendlyDealWonError = (error: unknown): Error => {
  const e = error as { code?: string; message?: string; details?: string };
  const msg = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  const combined = `${msg} ${details}`;

  if (e?.code === "P0001" && msg) return new Error(msg);
  if (e?.code === "42501" || /permission denied|only the organization owner/i.test(combined)) {
    return new Error(
      "The deal was moved to Won, but project creation is blocked until the latest CRM won-deal migration is applied.",
    );
  }
  if (e?.code === "22P02" || /invalid input syntax.*uuid/i.test(combined)) {
    return new Error("The won-deal handoff has invalid owner or template data. Try again without a template.");
  }
  if (e?.code === "23502" || e?.code === "23503" || /not-null|foreign key/i.test(combined)) {
    return new Error("The won-deal project could not be created because required project data is missing.");
  }
  return error instanceof Error ? error : new Error(msg || "Failed to close deal to won");
};

const resolveDealStageTarget = async (
  organizationId: string,
  input: CreateDealInput,
): Promise<{ pipeline_id?: string; stage_id?: string }> => {
  if (input.pipelineId && input.stageId) {
    return { pipeline_id: input.pipelineId, stage_id: input.stageId };
  }

  if (input.stageId) {
    const { data, error } = await supabase
      .from("pipeline_stages")
      .select("pipeline_id, stage_id")
      .eq("organization_id", organizationId)
      .eq("stage_id", input.stageId)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to resolve selected deal stage:", error);
      return {};
    }

    if (data) {
      return {
        pipeline_id: data.pipeline_id as string,
        stage_id: data.stage_id as string,
      };
    }
  }

  let pipelineId = input.pipelineId ?? null;
  if (!pipelineId) {
    const { data: defaultPipeline, error: defaultError } = await supabase
      .from("pipelines")
      .select("pipeline_id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();

    if (defaultError) {
      logger.warn("Failed to resolve default deal pipeline:", defaultError);
      return {};
    }

    pipelineId = (defaultPipeline?.pipeline_id as string | undefined) ?? null;
  }

  if (!pipelineId) {
    const { data: firstPipeline, error: firstError } = await supabase
      .from("pipelines")
      .select("pipeline_id")
      .eq("organization_id", organizationId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstError) {
      logger.warn("Failed to resolve first deal pipeline:", firstError);
      return {};
    }

    pipelineId = (firstPipeline?.pipeline_id as string | undefined) ?? null;
  }

  if (!pipelineId) return {};

  const { data: matchingStage, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id, stage_id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("key", input.stage ?? "lead")
    .maybeSingle();

  if (stageError) {
    logger.warn("Failed to resolve deal stage:", stageError);
    return { pipeline_id: pipelineId };
  }

  if (matchingStage) {
    return {
      pipeline_id: matchingStage.pipeline_id as string,
      stage_id: matchingStage.stage_id as string,
    };
  }

  const { data: firstStage, error: firstStageError } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id, stage_id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (firstStageError) {
    logger.warn("Failed to resolve first deal stage:", firstStageError);
    return { pipeline_id: pipelineId };
  }

  return firstStage
    ? {
        pipeline_id: firstStage.pipeline_id as string,
        stage_id: firstStage.stage_id as string,
      }
    : { pipeline_id: pipelineId };
};

export const getOrganizationDeals = async (
  organizationId: string,
): Promise<Deal[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort(
      (a, b) =>
        a.stage.localeCompare(b.stage) || a.position - b.position,
    );
  }
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load deals:", error);
    return [];
  }
  return (data || []).map(mapDeal);
};

export const createDeal = async (
  organizationId: string,
  createdBy: string,
  createdByName: string,
  input: CreateDealInput,
): Promise<Deal> => {
  const stage = input.stage ?? "lead";
  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const deal: Deal = {
      dealId: crypto.randomUUID(),
      organizationId,
      clientId: input.clientId ?? null,
      clientName: input.clientName ?? null,
      title: input.title,
      description: input.description ?? null,
      stage,
      value: input.value ?? 0,
      currency: (input.currency || "USD").toUpperCase(),
      probability: STAGE_DEFAULT_PROBABILITY[stage],
      expectedCloseDate: input.expectedCloseDate ?? null,
      actualCloseDate: null,
      ownerId: input.ownerId ?? createdBy,
      ownerName: input.ownerName ?? createdByName,
      source: input.source ?? null,
      tags: input.tags ?? [],
      position: Date.now(),
      createdBy,
      createdByName,
      closedAt: null,
      closedBy: null,
      pipelineId: "",
      stageId: "",
      dealType: input.dealType ?? null,
      nextStep: input.nextStep ?? null,
      contactId: input.contactId ?? null,
      leadSource: input.leadSource ?? input.source ?? null,
      campaignSource: input.campaignSource ?? null,
      customFields: input.customFields ?? {},
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [deal, ...readLocal(organizationId)]);
    notifyLocalDealsChanged(organizationId);
    return deal;
  }

  const row = {
    organization_id: organizationId,
    client_id: input.clientId ?? null,
    client_name: input.clientName ?? null,
    title: input.title,
    description: input.description ?? null,
    stage,
    value: input.value ?? 0,
    currency: (input.currency || "USD").toUpperCase(),
    expected_close_date: input.expectedCloseDate
      ? input.expectedCloseDate.toISOString().split("T")[0]
      : null,
    owner_id: input.ownerId ?? createdBy,
    owner_name: input.ownerName ?? createdByName,
    source: input.source ?? null,
    tags: input.tags ?? [],
    // Spread within stage column. Unique-ish position avoids ties.
    position: Date.now(),
    created_by: createdBy,
    created_by_name: createdByName,
    // Migration 107 fields. Older DBs without the columns will reject these
    // with code 42703 (undefined column) — we propagate that as a clear error.
    deal_type: input.dealType ?? null,
    next_step: input.nextStep ?? null,
    contact_id: input.contactId ?? null,
    lead_source: input.leadSource ?? input.source ?? null,
    campaign_source: input.campaignSource ?? null,
    custom_fields: input.customFields ?? {},
  };

  if (input.pipelineId) {
    (row as Record<string, unknown>).pipeline_id = input.pipelineId;
  }
  if (input.stageId) {
    (row as Record<string, unknown>).stage_id = input.stageId;
  }

  const createViaDirectInsert = async () => {
    const stageTarget = await resolveDealStageTarget(organizationId, input);
    return supabase
      .from("deals")
      .insert({ ...row, ...stageTarget })
      .select()
      .single();
  };

  // Strip-and-retry helper: when the DB rejects the insert with 42703
  // "column X does not exist" (or the RPC body raises the same because
  // it hardcodes columns the table doesn't have), drop the column from
  // `row` and retry. Up to 8 columns — past that we give up to avoid
  // an infinite loop. Critical for projects that haven't applied
  // migrations 107 / 109 yet (deal_type, next_step, custom_fields, etc).
  const tryStripMissingColumn = (err: unknown): string | null => {
    const e = err as { code?: string; message?: string } | null;
    if (!e || (e.code !== "42703" && !/does not exist/i.test(String(e.message ?? "")))) return null;
    const m = /column "([^"]+)" of relation/i.exec(String(e.message ?? ""));
    const col = m?.[1];
    if (!col || !(col in row)) return null;
    delete (row as Record<string, unknown>)[col];
    return col;
  };

  let { data, error } = await supabase
    .rpc("crm_create_deal", {
      p_organization_id: organizationId,
      p_deal: row,
    })
    .single();

  // Fall back to direct insert on:
  //  - missing RPC (PGRST202 / 42883)
  //  - PostgREST signature drift (PGRST* / 22P02)
  //  - 42703 "column does not exist" raised INSIDE the RPC body — the
  //    deployed RPC may hardcode columns the table doesn't have yet
  //    (e.g. custom_fields without migration 109). The direct path lets
  //    the strip loop below take over.
  if (error) {
    const rpcCode = String((error as { code?: string }).code ?? "");
    const rpcMsg = String((error as { message?: string }).message ?? "");
    const isMissingColumn = rpcCode === "42703" || /does not exist/i.test(rpcMsg);
    const isRpcDrift = rpcCode.startsWith("PGRST") || rpcCode === "22P02";
    if (isMissingRpcError(error) || isRpcDrift || isMissingColumn) {
      logger.warn(
        `crm_create_deal RPC failed (${rpcCode || "unknown"}: ${rpcMsg.slice(0, 200)}) — `
        + `falling back to direct insert. Apply migrations 107/109 to sync the deals schema.`,
      );
      if (isMissingColumn) tryStripMissingColumn(error);
      ({ data, error } = await createViaDirectInsert());
    }
  }

  // Direct-path strip loop: keep dropping unknown columns and retrying.
  const strippedCols: string[] = [];
  for (let i = 0; i < 8 && error; i++) {
    const stripped = tryStripMissingColumn(error);
    if (!stripped) break;
    strippedCols.push(stripped);
    ({ data, error } = await createViaDirectInsert());
  }
  if (strippedCols.length > 0) {
    logger.warn(
      `createDeal: dropped ${strippedCols.length} column(s) the DB doesn't know about: `
      + `${strippedCols.join(", ")}. Apply migrations 107/109 to keep these values.`,
    );
  }

  if (error) {
    // Inline the real Postgres reason so the import dialog shows a
    // useful per-row error string instead of "Object" / generic text.
    const e = error as { code?: string; message?: string; details?: string; hint?: string };
    const composed = [e.message, e.details, e.hint && `(hint: ${e.hint})`, e.code && `[${e.code}]`]
      .filter(Boolean)
      .join(" — ");
    logger.error(`Failed to create deal: ${composed || "no reason returned"}`, error);
    // Keep the existing friendly-error mapper but make sure its fallback
    // path now carries the composed string too.
    const friendly = friendlyDealCreateError(error);
    if (friendly.message && friendly.message !== "Failed to create deal" && !/object/i.test(friendly.message)) {
      throw friendly;
    }
    throw new Error(composed || friendly.message || "Failed to create deal");
  }
  notifyDealsChanged(organizationId);
  return mapDeal(data as Record<string, unknown>);
};

export const updateDeal = async (
  organizationId: string,
  dealId: string,
  input: UpdateDealInput,
): Promise<Deal> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((d) => d.dealId === dealId);
    if (idx === -1) throw new Error("Deal not found");
    const merged: Deal = {
      ...all[idx],
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.stage !== undefined
        ? {
            stage: input.stage,
            probability: STAGE_DEFAULT_PROBABILITY[input.stage],
            ...(input.stage === "won" || input.stage === "lost"
              ? {
                  closedAt: new Date(),
                  actualCloseDate: new Date(),
                }
              : { closedAt: null, actualCloseDate: null, lossReason: null }),
          }
        : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.currency !== undefined
        ? { currency: input.currency.toUpperCase() }
        : {}),
      ...(input.probability !== undefined
        ? { probability: input.probability }
        : {}),
      ...(input.expectedCloseDate !== undefined
        ? { expectedCloseDate: input.expectedCloseDate }
        : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.ownerName !== undefined ? { ownerName: input.ownerName } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.lossReason !== undefined ? { lossReason: input.lossReason } : {}),
      ...(input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
      ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
      ...(input.dealType !== undefined ? { dealType: input.dealType } : {}),
      ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.leadSource !== undefined ? { leadSource: input.leadSource } : {}),
      ...(input.campaignSource !== undefined ? { campaignSource: input.campaignSource } : {}),
      ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
      updatedAt: new Date(),
    };
    all[idx] = merged;
    writeLocal(organizationId, all);
    notifyLocalDealsChanged(organizationId);
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.clientId !== undefined) update.client_id = input.clientId;
  if (input.clientName !== undefined) update.client_name = input.clientName;
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.value !== undefined) update.value = input.value;
  if (input.currency !== undefined)
    update.currency = input.currency.toUpperCase();
  if (input.expectedCloseDate !== undefined)
    update.expected_close_date = input.expectedCloseDate
      ? input.expectedCloseDate.toISOString().split("T")[0]
      : null;
  if (input.ownerId !== undefined) update.owner_id = input.ownerId;
  if (input.ownerName !== undefined) update.owner_name = input.ownerName;
  if (input.source !== undefined) update.source = input.source;
  if (input.tags !== undefined) update.tags = input.tags;
  if (input.position !== undefined) update.position = input.position;

  // Stage transitions: single UPDATE only (no read-then-write). Probability,
  // close timestamps, and reopen cleanup are enforced atomically by
  // public.deals_set_updated_at_and_close (before insert or update on deals).
  if (input.stage !== undefined) {
    update.stage = input.stage;
    if (input.stage === "won") {
      update.loss_reason = null;
    } else if (input.stage === "lost") {
      update.loss_reason = input.lossReason ?? null;
    }
  }

  if (input.probability !== undefined) {
    update.probability = input.probability;
  }
  if (input.lossReason !== undefined) {
    update.loss_reason = input.lossReason;
  }
  if (input.stageId !== undefined) update.stage_id = input.stageId;
  if (input.pipelineId !== undefined) update.pipeline_id = input.pipelineId;
  if (input.dealType !== undefined) update.deal_type = input.dealType;
  if (input.nextStep !== undefined) update.next_step = input.nextStep;
  if (input.contactId !== undefined) update.contact_id = input.contactId;
  if (input.leadSource !== undefined) update.lead_source = input.leadSource;
  if (input.campaignSource !== undefined) update.campaign_source = input.campaignSource;
  if (input.customFields !== undefined) update.custom_fields = input.customFields;

  const updateViaDirectPatch = () => supabase
    .from("deals")
    .update(update)
    .eq("deal_id", dealId)
    .eq("organization_id", organizationId)
    .select()
    .single();

  let { data, error } = await supabase
    .rpc("crm_update_deal", {
      p_organization_id: organizationId,
      p_deal_id: dealId,
      p_patch: update,
    })
    .single();

  if (error && isMissingRpcError(error)) {
    ({ data, error } = await updateViaDirectPatch());
  }

  if (error) {
    logger.error("Failed to update deal:", error);
    throw friendlyDealUpdateError(error);
  }
  // Notify same-tab siblings (kanban + drawer + analytics) immediately,
  // so the stage move is visible without waiting on Supabase realtime.
  notifyDealsChanged(organizationId);
  return mapDeal(data as Record<string, unknown>);
};

export const deleteDeal = async (
  organizationId: string,
  dealId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter((d) => d.dealId !== dealId);
    writeLocal(organizationId, all);
    notifyDealsChanged(organizationId);
    return;
  }
  const { error } = await supabase.from("deals").delete().eq("deal_id", dealId);
  if (error) {
    logger.error("Failed to delete deal:", error);
    throw error;
  }
  notifyDealsChanged(organizationId);
};

// Cross-instance sync: when one useDeals instance writes (local OR
// Supabase), every other instance in the same tab needs to refetch so the
// detail view and the kanban don't end up with different stages.
// Supabase mode also gets postgres_changes for cross-tab sync, but the
// CustomEvent fires regardless so sibling components on the *same* page
// (kanban + drawer + analytics card) stay in sync even when the user's
// Supabase project doesn't have realtime enabled, or there's a lag before
// the realtime event arrives.
const DEALS_CHANGED_EVENT = "pm-deals-changed";

export const notifyDealsChanged = (organizationId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(DEALS_CHANGED_EVENT, { detail: { organizationId } }));
  } catch { /* ignore — SSR or stripped env */ }
};

/** @deprecated kept for backwards compat — use notifyDealsChanged. */
export const notifyLocalDealsChanged = notifyDealsChanged;

export const subscribeToDeals = (
  organizationId: string,
  callback: (deals: Deal[]) => void,
): (() => void) => {
  getOrganizationDeals(organizationId).then(callback);

  // Same-tab CustomEvent listener runs in BOTH modes so siblings sync
  // synchronously after every successful write the current page made.
  const ceHandler = (e: Event) => {
    const ce = e as CustomEvent<{ organizationId: string }>;
    if (ce.detail?.organizationId !== organizationId) return;
    getOrganizationDeals(organizationId).then(callback);
  };
  window.addEventListener(DEALS_CHANGED_EVENT, ceHandler);

  if (isLocalOrg(organizationId)) {
    return () => window.removeEventListener(DEALS_CHANGED_EVENT, ceHandler);
  }

  const channelName = `deals-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "deals",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationDeals(organizationId).then(callback);
      },
    )
    .subscribe();
  return () => {
    window.removeEventListener(DEALS_CHANGED_EVENT, ceHandler);
    channel.unsubscribe();
  };
};

// Avoid clashing with payroll's `formatMoney` in the barrel re-exports.
export const formatDealMoney = (
  amount: number,
  currency: string = "USD",
): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
};

export interface PipelineAnalytics {
  openValue: number;          // Sum of value across open stages
  weightedOpenValue: number;  // Sum of value * (probability/100) for open
  wonThisMonth: number;       // Sum of value won, current calendar month
  wonCount: number;
  lostCount: number;
  averageDealSize: number;    // mean across won deals
  winRate: number;            // won / (won + lost), 0..1
}

export const computeAnalytics = (deals: Deal[]): PipelineAnalytics => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let openValue = 0;
  let weighted = 0;
  let wonThisMonth = 0;
  let wonCount = 0;
  let lostCount = 0;
  let wonValueTotal = 0;

  for (const d of deals) {
    if (d.stage === "won") {
      wonCount += 1;
      wonValueTotal += d.value;
      const closeWhen = d.actualCloseDate ?? d.closedAt ?? d.updatedAt;
      if (closeWhen >= monthStart) wonThisMonth += d.value;
    } else if (d.stage === "lost") {
      lostCount += 1;
    } else {
      openValue += d.value;
      weighted += d.value * (d.probability / 100);
    }
  }

  return {
    openValue,
    weightedOpenValue: Math.round(weighted * 100) / 100,
    wonThisMonth,
    wonCount,
    lostCount,
    averageDealSize:
      wonCount > 0 ? Math.round((wonValueTotal / wonCount) * 100) / 100 : 0,
    winRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
  };
};

export interface CloseDealToWonInput {
  skip?: boolean;
  name?: string;
  ownerId?: string;
  startDate?: string;     // YYYY-MM-DD
  dueDate?: string;       // YYYY-MM-DD; mapped to projects.end_date by the RPC
  templateId?: string | null;
}

export const closeDealToWon = async (
  dealId: string,
  input: CloseDealToWonInput,
): Promise<{ dealId: string; projectId: string | null }> => {
  const { data, error } = await supabase.rpc("crm_close_deal_to_won", {
    p_deal_id: dealId,
    p_project_input: {
      skip: input.skip ?? false,
      name: input.name ?? null,
      owner_id: input.ownerId ?? null,
      start_date: input.startDate ?? null,
      due_date: input.dueDate ?? null,
      template_id: input.templateId ?? null,
    },
  });
  if (error) {
    logger.error("Failed to close deal to won:", error);
    throw friendlyDealWonError(error);
  }
  return {
    dealId: (data as Record<string, unknown>).deal_id as string,
    projectId: ((data as Record<string, unknown>).project_id as string) ?? null,
  };
};
