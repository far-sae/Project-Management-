import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface ClientCategory {
  categoryId: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  color: string | null;
  description: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientCategoryInput {
  workspaceId: string;
  name: string;
  color?: string | null;
  description?: string | null;
  sortOrder?: number;
}

export type UpdateClientCategoryInput = Partial<Omit<CreateClientCategoryInput, "workspaceId">>;

export interface UpdateClientCategoryResult {
  category: ClientCategory;
  /** Present only when the update included a rename. null when no rename. */
  cascade: CascadeResult | null;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

const sanitize = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

const mapCategory = (r: Record<string, unknown>): ClientCategory => ({
  categoryId: r.category_id as string,
  organizationId: r.organization_id as string,
  workspaceId: r.workspace_id as string,
  name: r.name as string,
  color: (r.color as string) ?? null,
  description: (r.description as string) ?? null,
  sortOrder: Number(r.sort_order ?? 0),
  createdBy: (r.created_by as string) ?? null,
  createdByName: (r.created_by_name as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

// ─── Local-org fallback (mirrors clientNotes pattern) ──────────────────────

const STORE = (orgId: string) => `pm_client_categories_${orgId}`;

const reviveCategory = (c: ClientCategory): ClientCategory => ({
  ...c,
  createdAt: new Date(c.createdAt),
  updatedAt: new Date(c.updatedAt),
});

const readLocal = (orgId: string): ClientCategory[] => {
  try {
    const raw = localStorage.getItem(STORE(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as ClientCategory[]).map(reviveCategory);
  } catch {
    return [];
  }
};

const writeLocal = (orgId: string, value: ClientCategory[]) => {
  try {
    localStorage.setItem(STORE(orgId), JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

// ─── CRUD ──────────────────────────────────────────────────────────────────

export const listClientCategories = async (
  organizationId: string,
): Promise<ClientCategory[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }
  const { data, error } = await supabase
    .from("client_categories")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    logger.error("listClientCategories failed:", error);
    return [];
  }
  return (data ?? []).map(mapCategory);
};

export const createClientCategory = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateClientCategoryInput,
): Promise<ClientCategory> => {
  const name = sanitize(input.name);
  if (!name) throw new Error("Category name is required");
  if (!input.workspaceId) throw new Error("Pick a workspace before creating a category");

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const list = readLocal(organizationId);
    const dup = list.find(
      (c) => c.workspaceId === input.workspaceId
        && c.name.toLowerCase() === name.toLowerCase(),
    );
    if (dup) throw new Error("A category with that name already exists in this workspace.");
    const inWorkspace = list.filter((c) => c.workspaceId === input.workspaceId);
    const nextSort = inWorkspace.length === 0
      ? 0
      : Math.max(...inWorkspace.map((c) => c.sortOrder)) + 1;
    const next: ClientCategory = {
      categoryId: crypto.randomUUID(),
      organizationId,
      workspaceId: input.workspaceId,
      name,
      color: sanitize(input.color),
      description: sanitize(input.description),
      sortOrder: input.sortOrder ?? nextSort,
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [...list, next]);
    return next;
  }

  // Pick the next slot inside this workspace so add-order is preserved across
  // backends. One small read; admin op, runs rarely.
  let nextSort = 0;
  if (input.sortOrder === undefined) {
    const { data: maxRow } = await supabase
      .from("client_categories")
      .select("sort_order")
      .eq("organization_id", organizationId)
      .eq("workspace_id", input.workspaceId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const current = (maxRow as { sort_order?: number } | null)?.sort_order;
    nextSort = typeof current === "number" ? current + 1 : 0;
  }

  const { data, error } = await supabase
    .from("client_categories")
    .insert({
      organization_id: organizationId,
      workspace_id: input.workspaceId,
      name,
      color: sanitize(input.color),
      description: sanitize(input.description),
      sort_order: input.sortOrder ?? nextSort,
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      throw new Error("A category with that name already exists in this workspace.");
    }
    logger.error("createClientCategory failed:", error);
    throw error;
  }
  return mapCategory(data as Record<string, unknown>);
};

// PostgreSQL LIKE treats % and _ as wildcards. Pre-escape user-supplied
// category names so a category called "50% Off" or "Tier_1" doesn't
// accidentally repaint every client whose category happens to match the
// resulting pattern.
const escapeLike = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

export type CascadeResult =
  | { ok: true; updated: number }
  | { ok: false; updated: number; reason: string };

// Rename the free-text `category` value on every client row whose category
// case-insensitively matches `oldName`, scoped to the same workspace.
// Returns a CascadeResult so the caller can surface partial state instead of
// silently leaving the registry and clients out of sync.
const cascadeRenameClients = async (
  organizationId: string,
  workspaceId: string,
  oldName: string,
  newName: string,
): Promise<CascadeResult> => {
  if (oldName.toLowerCase() === newName.toLowerCase()) return { ok: true, updated: 0 };

  if (isLocalOrg(organizationId)) {
    try {
      const key = `pm_clients_${organizationId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return { ok: true, updated: 0 };
      const list = JSON.parse(raw) as Array<Record<string, unknown>>;
      let updated = 0;
      for (const c of list) {
        if (
          c.workspaceId === workspaceId
          && typeof c.category === "string"
          && c.category.trim().toLowerCase() === oldName.toLowerCase()
        ) {
          c.category = newName;
          c.updatedAt = new Date().toISOString();
          updated += 1;
        }
      }
      if (updated > 0) localStorage.setItem(key, JSON.stringify(list));
      return { ok: true, updated };
    } catch (err) {
      return { ok: false, updated: 0, reason: (err as Error)?.message ?? "localStorage write failed" };
    }
  }

  // Supabase: ilike with LIKE-pattern semantics. Wildcards in oldName are
  // escaped above. The trigger clients_set_updated_at owns updated_at, so we
  // don't send it ourselves. count='exact' lets the caller report N affected.
  const { error, count } = await supabase
    .from("clients")
    .update({ category: newName }, { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("workspace_id", workspaceId)
    .ilike("category", escapeLike(oldName));
  if (error) {
    logger.error("cascadeRenameClients failed (category renamed but accounts not):", error);
    return { ok: false, updated: 0, reason: error.message ?? "Update failed" };
  }
  return { ok: true, updated: count ?? 0 };
};

export const updateClientCategory = async (
  organizationId: string,
  categoryId: string,
  input: UpdateClientCategoryInput,
): Promise<UpdateClientCategoryResult> => {
  if (isLocalOrg(organizationId)) {
    const list = readLocal(organizationId);
    const idx = list.findIndex((c) => c.categoryId === categoryId);
    if (idx === -1) throw new Error("Category not found");
    const current = list[idx];
    const merged: ClientCategory = { ...current };
    let renamedFrom: string | null = null;
    if (input.name !== undefined) {
      const nm = sanitize(input.name);
      if (!nm) throw new Error("Category name cannot be empty");
      const dup = list.find(
        (c) => c.categoryId !== categoryId
          && c.workspaceId === current.workspaceId
          && c.name.toLowerCase() === nm.toLowerCase(),
      );
      if (dup) throw new Error("A category with that name already exists in this workspace.");
      if (nm !== current.name) renamedFrom = current.name;
      merged.name = nm;
    }
    if (input.color !== undefined) merged.color = sanitize(input.color);
    if (input.description !== undefined) merged.description = sanitize(input.description);
    if (input.sortOrder !== undefined) merged.sortOrder = input.sortOrder;
    merged.updatedAt = new Date();
    list[idx] = merged;
    writeLocal(organizationId, list);
    const cascade = renamedFrom
      ? await cascadeRenameClients(organizationId, merged.workspaceId, renamedFrom, merged.name)
      : null;
    return { category: merged, cascade };
  }

  // maybeSingle() returns null when the row no longer exists (e.g. another
  // admin deleted it mid-edit), so we can surface a friendly error instead
  // of a raw PGRST116 code.
  const { data: prev, error: readErr } = await supabase
    .from("client_categories")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("category_id", categoryId)
    .maybeSingle();
  if (readErr) {
    logger.error("updateClientCategory pre-read failed:", readErr);
    throw readErr;
  }
  if (!prev) {
    throw new Error("Category not found — it may have been deleted by someone else. Refresh and try again.");
  }
  const prevName = (prev as { name: string }).name;

  const patch: Record<string, unknown> = {};
  let renamedFrom: string | null = null;
  if (input.name !== undefined) {
    const nm = sanitize(input.name);
    if (!nm) throw new Error("Category name cannot be empty");
    if (nm !== prevName) renamedFrom = prevName;
    patch.name = nm;
  }
  if (input.color !== undefined) patch.color = sanitize(input.color);
  if (input.description !== undefined) patch.description = sanitize(input.description);
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const { data, error } = await supabase
    .from("client_categories")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("category_id", categoryId)
    .select()
    .single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      throw new Error("A category with that name already exists in this workspace.");
    }
    logger.error("updateClientCategory failed:", error);
    throw error;
  }
  const next = mapCategory(data as Record<string, unknown>);
  const cascade = renamedFrom
    ? await cascadeRenameClients(organizationId, next.workspaceId, renamedFrom, next.name)
    : null;
  return { category: next, cascade };
};

export const deleteClientCategory = async (
  organizationId: string,
  categoryId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      organizationId,
      readLocal(organizationId).filter((c) => c.categoryId !== categoryId),
    );
    return;
  }
  const { error } = await supabase
    .from("client_categories")
    .delete()
    .eq("organization_id", organizationId)
    .eq("category_id", categoryId);
  if (error) {
    logger.error("deleteClientCategory failed:", error);
    throw error;
  }
};

export const subscribeToClientCategories = (
  organizationId: string,
  callback: (categories: ClientCategory[]) => void,
): (() => void) => {
  listClientCategories(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

  const channel = supabase
    .channel(`client-categories-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "client_categories",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => { listClientCategories(organizationId).then(callback); },
    )
    .subscribe();

  return () => { channel.unsubscribe(); };
};
