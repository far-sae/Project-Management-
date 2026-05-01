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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDealInput {
  clientId?: string | null;
  clientName?: string | null;
  title: string;
  description?: string | null;
  stage?: DealStage;
  value?: number;
  currency?: string;
  expectedCloseDate?: Date | null;
  ownerId?: string | null;
  ownerName?: string | null;
  source?: string | null;
  tags?: string[];
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
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [deal, ...readLocal(organizationId)]);
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
  };

  const { data, error } = await supabase
    .from("deals")
    .insert(row)
    .select()
    .single();
  if (error) {
    logger.error("Failed to create deal:", error);
    throw error;
  }
  return mapDeal(data);
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
      updatedAt: new Date(),
    };
    all[idx] = merged;
    writeLocal(organizationId, all);
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

  const { data, error } = await supabase
    .from("deals")
    .update(update)
    .eq("deal_id", dealId)
    .eq("organization_id", organizationId)
    .select()
    .single();
  if (error) {
    logger.error("Failed to update deal:", error);
    throw error;
  }
  return mapDeal(data);
};

export const deleteDeal = async (
  organizationId: string,
  dealId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter((d) => d.dealId !== dealId);
    writeLocal(organizationId, all);
    return;
  }
  const { error } = await supabase.from("deals").delete().eq("deal_id", dealId);
  if (error) {
    logger.error("Failed to delete deal:", error);
    throw error;
  }
};

export const subscribeToDeals = (
  organizationId: string,
  callback: (deals: Deal[]) => void,
): (() => void) => {
  getOrganizationDeals(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};
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
