// Deal "Related List" services: competitors, contact roles, stage history.
// Lives in one file because each piece is small and they share the same
// local-org fallback shape (mirrors clientCategories pattern).

import { supabase } from "./config";
import { logger } from "@/lib/logger";

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const COMPETITORS_KEY = (orgId: string) => `pm_deal_competitors_${orgId}`;
const CONTACT_ROLES_KEY = (orgId: string) => `pm_deal_contact_roles_${orgId}`;
const STAGE_HISTORY_KEY = (orgId: string) => `pm_deal_stage_history_${orgId}`;

const sanitize = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

// ─── Competitors ──────────────────────────────────────────────────────────

export interface DealCompetitor {
  competitorId: string;
  dealId: string;
  organizationId: string;
  name: string;
  url: string | null;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDealCompetitorInput {
  dealId: string;
  name: string;
  url?: string | null;
  notes?: string | null;
}

export type UpdateDealCompetitorInput = Partial<Omit<CreateDealCompetitorInput, "dealId">>;

const mapCompetitor = (r: Record<string, unknown>): DealCompetitor => ({
  competitorId: r.competitor_id as string,
  dealId: r.deal_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  url: (r.url as string) ?? null,
  notes: (r.notes as string) ?? null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const reviveCompetitor = (c: DealCompetitor): DealCompetitor => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
});

const readLocalCompetitors = (orgId: string): DealCompetitor[] => {
  try {
    const raw = localStorage.getItem(COMPETITORS_KEY(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as DealCompetitor[]).map(reviveCompetitor);
  } catch { return []; }
};
const writeLocalCompetitors = (orgId: string, list: DealCompetitor[]) => {
  try { localStorage.setItem(COMPETITORS_KEY(orgId), JSON.stringify(list)); } catch { /* ignore */ }
};

export const listDealCompetitors = async (
  organizationId: string,
  dealId: string,
): Promise<DealCompetitor[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocalCompetitors(organizationId)
      .filter((c) => c.dealId === dealId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  const { data, error } = await supabase
    .from("deal_competitors")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("listDealCompetitors failed:", error);
    return [];
  }
  return (data ?? []).map(mapCompetitor);
};

export const createDealCompetitor = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateDealCompetitorInput,
): Promise<DealCompetitor> => {
  const name = sanitize(input.name);
  if (!name) throw new Error("Competitor name is required");
  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const next: DealCompetitor = {
      competitorId: crypto.randomUUID(),
      dealId: input.dealId,
      organizationId,
      name,
      url: sanitize(input.url),
      notes: sanitize(input.notes),
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    writeLocalCompetitors(organizationId, [...readLocalCompetitors(organizationId), next]);
    return next;
  }
  const { data, error } = await supabase
    .from("deal_competitors")
    .insert({
      organization_id: organizationId,
      deal_id: input.dealId,
      name,
      url: sanitize(input.url),
      notes: sanitize(input.notes),
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) {
    logger.error("createDealCompetitor failed:", error);
    throw error;
  }
  return mapCompetitor(data as Record<string, unknown>);
};

export const updateDealCompetitor = async (
  organizationId: string,
  competitorId: string,
  input: UpdateDealCompetitorInput,
): Promise<DealCompetitor> => {
  if (isLocalOrg(organizationId)) {
    const list = readLocalCompetitors(organizationId);
    const idx = list.findIndex((c) => c.competitorId === competitorId);
    if (idx === -1) throw new Error("Competitor not found");
    const merged: DealCompetitor = { ...list[idx] };
    if (input.name !== undefined) {
      const nm = sanitize(input.name);
      if (!nm) throw new Error("Competitor name cannot be empty");
      merged.name = nm;
    }
    if (input.url !== undefined) merged.url = sanitize(input.url);
    if (input.notes !== undefined) merged.notes = sanitize(input.notes);
    merged.updatedAt = new Date();
    list[idx] = merged;
    writeLocalCompetitors(organizationId, list);
    return merged;
  }
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const nm = sanitize(input.name);
    if (!nm) throw new Error("Competitor name cannot be empty");
    patch.name = nm;
  }
  if (input.url !== undefined) patch.url = sanitize(input.url);
  if (input.notes !== undefined) patch.notes = sanitize(input.notes);
  const { data, error } = await supabase
    .from("deal_competitors")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("competitor_id", competitorId)
    .select()
    .single();
  if (error) {
    logger.error("updateDealCompetitor failed:", error);
    throw error;
  }
  return mapCompetitor(data as Record<string, unknown>);
};

export const deleteDealCompetitor = async (
  organizationId: string,
  competitorId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocalCompetitors(
      organizationId,
      readLocalCompetitors(organizationId).filter((c) => c.competitorId !== competitorId),
    );
    return;
  }
  const { error } = await supabase
    .from("deal_competitors")
    .delete()
    .eq("organization_id", organizationId)
    .eq("competitor_id", competitorId);
  if (error) {
    logger.error("deleteDealCompetitor failed:", error);
    throw error;
  }
};

export const subscribeToDealCompetitors = (
  organizationId: string,
  dealId: string,
  callback: (rows: DealCompetitor[]) => void,
): (() => void) => {
  listDealCompetitors(organizationId, dealId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};
  const channel = supabase
    .channel(`deal-competitors-${dealId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "deal_competitors",
        filter: `deal_id=eq.${dealId}`,
      },
      () => { listDealCompetitors(organizationId, dealId).then(callback); },
    )
    .subscribe();
  return () => { channel.unsubscribe(); };
};

// ─── Contact Roles ─────────────────────────────────────────────────────────

export interface DealContactRole {
  roleId: string;
  dealId: string;
  contactId: string;
  organizationId: string;
  role: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDealContactRoleInput {
  dealId: string;
  contactId: string;
  role?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export type UpdateDealContactRoleInput = Partial<Omit<CreateDealContactRoleInput, "dealId" | "contactId">>;

const mapRole = (r: Record<string, unknown>): DealContactRole => ({
  roleId: r.role_id as string,
  dealId: r.deal_id as string,
  contactId: r.contact_id as string,
  organizationId: r.organization_id as string,
  role: (r.role as string) ?? null,
  isPrimary: Boolean(r.is_primary),
  notes: (r.notes as string) ?? null,
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const reviveRole = (r: DealContactRole): DealContactRole => ({
  ...r,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

const readLocalRoles = (orgId: string): DealContactRole[] => {
  try {
    const raw = localStorage.getItem(CONTACT_ROLES_KEY(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as DealContactRole[]).map(reviveRole);
  } catch { return []; }
};
const writeLocalRoles = (orgId: string, list: DealContactRole[]) => {
  try { localStorage.setItem(CONTACT_ROLES_KEY(orgId), JSON.stringify(list)); } catch { /* ignore */ }
};

export const listDealContactRoles = async (
  organizationId: string,
  dealId: string,
): Promise<DealContactRole[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocalRoles(organizationId)
      .filter((r) => r.dealId === dealId)
      .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
  }
  const { data, error } = await supabase
    .from("deal_contact_roles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("listDealContactRoles failed:", error);
    return [];
  }
  return (data ?? []).map(mapRole);
};

export const createDealContactRole = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateDealContactRoleInput,
): Promise<DealContactRole> => {
  if (!input.contactId) throw new Error("Contact is required");
  if (isLocalOrg(organizationId)) {
    const list = readLocalRoles(organizationId);
    const dup = list.find((r) => r.dealId === input.dealId && r.contactId === input.contactId);
    if (dup) throw new Error("That contact is already linked to this deal.");
    const now = new Date();
    const next: DealContactRole = {
      roleId: crypto.randomUUID(),
      dealId: input.dealId,
      contactId: input.contactId,
      organizationId,
      role: sanitize(input.role ?? null),
      isPrimary: Boolean(input.isPrimary),
      notes: sanitize(input.notes ?? null),
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    writeLocalRoles(organizationId, [...list, next]);
    return next;
  }
  const { data, error } = await supabase
    .from("deal_contact_roles")
    .insert({
      organization_id: organizationId,
      deal_id: input.dealId,
      contact_id: input.contactId,
      role: sanitize(input.role ?? null),
      is_primary: Boolean(input.isPrimary),
      notes: sanitize(input.notes ?? null),
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") throw new Error("That contact is already linked to this deal.");
    logger.error("createDealContactRole failed:", error);
    throw error;
  }
  return mapRole(data as Record<string, unknown>);
};

export const updateDealContactRole = async (
  organizationId: string,
  roleId: string,
  input: UpdateDealContactRoleInput,
): Promise<DealContactRole> => {
  if (isLocalOrg(organizationId)) {
    const list = readLocalRoles(organizationId);
    const idx = list.findIndex((r) => r.roleId === roleId);
    if (idx === -1) throw new Error("Contact role not found");
    const merged: DealContactRole = { ...list[idx] };
    if (input.role !== undefined) merged.role = sanitize(input.role);
    if (input.isPrimary !== undefined) merged.isPrimary = Boolean(input.isPrimary);
    if (input.notes !== undefined) merged.notes = sanitize(input.notes);
    merged.updatedAt = new Date();
    list[idx] = merged;
    writeLocalRoles(organizationId, list);
    return merged;
  }
  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = sanitize(input.role);
  if (input.isPrimary !== undefined) patch.is_primary = Boolean(input.isPrimary);
  if (input.notes !== undefined) patch.notes = sanitize(input.notes);
  const { data, error } = await supabase
    .from("deal_contact_roles")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("role_id", roleId)
    .select()
    .single();
  if (error) {
    logger.error("updateDealContactRole failed:", error);
    throw error;
  }
  return mapRole(data as Record<string, unknown>);
};

export const deleteDealContactRole = async (
  organizationId: string,
  roleId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocalRoles(
      organizationId,
      readLocalRoles(organizationId).filter((r) => r.roleId !== roleId),
    );
    return;
  }
  const { error } = await supabase
    .from("deal_contact_roles")
    .delete()
    .eq("organization_id", organizationId)
    .eq("role_id", roleId);
  if (error) {
    logger.error("deleteDealContactRole failed:", error);
    throw error;
  }
};

export const subscribeToDealContactRoles = (
  organizationId: string,
  dealId: string,
  callback: (rows: DealContactRole[]) => void,
): (() => void) => {
  listDealContactRoles(organizationId, dealId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};
  const channel = supabase
    .channel(`deal-contact-roles-${dealId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "deal_contact_roles",
        filter: `deal_id=eq.${dealId}`,
      },
      () => { listDealContactRoles(organizationId, dealId).then(callback); },
    )
    .subscribe();
  return () => { channel.unsubscribe(); };
};

// ─── Stage History (read-only — populated by trigger) ──────────────────────

export interface DealStageHistoryEntry {
  historyId: string;
  dealId: string;
  organizationId: string;
  fromStage: string | null;
  toStage: string;
  amount: number | null;
  probability: number | null;
  expectedCloseDate: Date | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: Date;
}

const mapHistory = (r: Record<string, unknown>): DealStageHistoryEntry => ({
  historyId: r.history_id as string,
  dealId: r.deal_id as string,
  organizationId: r.organization_id as string,
  fromStage: (r.from_stage as string) ?? null,
  toStage: r.to_stage as string,
  amount: r.amount != null ? Number(r.amount) : null,
  probability: r.probability != null ? Number(r.probability) : null,
  expectedCloseDate: r.expected_close_date ? new Date(r.expected_close_date as string) : null,
  changedBy: (r.changed_by as string) ?? null,
  changedByName: (r.changed_by_name as string) ?? null,
  changedAt: new Date(r.changed_at as string),
});

const reviveHistory = (h: DealStageHistoryEntry): DealStageHistoryEntry => ({
  ...h,
  expectedCloseDate: h.expectedCloseDate ? new Date(h.expectedCloseDate) : null,
  changedAt: new Date(h.changedAt),
});

const readLocalHistory = (orgId: string): DealStageHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(STAGE_HISTORY_KEY(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as DealStageHistoryEntry[]).map(reviveHistory);
  } catch { return []; }
};
const writeLocalHistory = (orgId: string, list: DealStageHistoryEntry[]) => {
  try { localStorage.setItem(STAGE_HISTORY_KEY(orgId), JSON.stringify(list)); } catch { /* ignore */ }
};

export const listDealStageHistory = async (
  organizationId: string,
  dealId: string,
): Promise<DealStageHistoryEntry[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocalHistory(organizationId)
      .filter((h) => h.dealId === dealId)
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
  }
  const { data, error } = await supabase
    .from("deal_stage_history")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("deal_id", dealId)
    .order("changed_at", { ascending: false });
  if (error) {
    logger.error("listDealStageHistory failed:", error);
    return [];
  }
  return (data ?? []).map(mapHistory);
};

// Manually record a stage history entry in local mode (the DB trigger does
// this on Supabase, but local-org has no triggers). Call this from the deals
// service after a successful local create / stage update.
export const recordLocalStageChange = (
  organizationId: string,
  entry: Omit<DealStageHistoryEntry, "historyId" | "organizationId" | "changedAt"> & { changedAt?: Date },
): void => {
  if (!isLocalOrg(organizationId)) return;
  const next: DealStageHistoryEntry = {
    ...entry,
    historyId: crypto.randomUUID(),
    organizationId,
    changedAt: entry.changedAt ?? new Date(),
  };
  writeLocalHistory(organizationId, [next, ...readLocalHistory(organizationId)]);
};

export const subscribeToDealStageHistory = (
  organizationId: string,
  dealId: string,
  callback: (rows: DealStageHistoryEntry[]) => void,
): (() => void) => {
  listDealStageHistory(organizationId, dealId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};
  const channel = supabase
    .channel(`deal-stage-history-${dealId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "deal_stage_history",
        filter: `deal_id=eq.${dealId}`,
      },
      () => { listDealStageHistory(organizationId, dealId).then(callback); },
    )
    .subscribe();
  return () => { channel.unsubscribe(); };
};
