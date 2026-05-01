import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface TimeEntry {
  entryId: string;
  organizationId: string;
  userId: string;
  userName?: string;
  projectId?: string | null;
  projectName?: string | null;
  notes?: string | null;
  clockedInAt: Date;
  clockedOutAt: Date | null;
  durationSeconds: number | null;
  editedBy?: string | null;
  editedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClockInInput {
  projectId?: string | null;
  projectName?: string | null;
  notes?: string | null;
}

export interface UpdateTimeEntryInput {
  clockedInAt?: Date;
  clockedOutAt?: Date | null;
  notes?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}

const mapEntry = (row: Record<string, unknown>): TimeEntry => ({
  entryId: row.entry_id as string,
  organizationId: row.organization_id as string,
  userId: row.user_id as string,
  userName: (row.user_name as string) ?? undefined,
  projectId: (row.project_id as string) ?? null,
  projectName: (row.project_name as string) ?? null,
  notes: (row.notes as string) ?? null,
  clockedInAt: new Date(row.clocked_in_at as string),
  clockedOutAt: row.clocked_out_at
    ? new Date(row.clocked_out_at as string)
    : null,
  durationSeconds:
    row.duration_seconds == null ? null : Number(row.duration_seconds),
  editedBy: (row.edited_by as string) ?? null,
  editedAt: row.edited_at ? new Date(row.edited_at as string) : null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string) => `pm_time_entries_${orgId}`;

const readLocal = (orgId: string): TimeEntry[] => {
  try {
    const raw = localStorage.getItem(localKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as TimeEntry[]).map((e) => ({
      ...e,
      clockedInAt: new Date(e.clockedInAt),
      clockedOutAt: e.clockedOutAt ? new Date(e.clockedOutAt) : null,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
      editedAt: e.editedAt ? new Date(e.editedAt) : null,
    }));
  } catch {
    return [];
  }
};

const writeLocal = (orgId: string, entries: TimeEntry[]) => {
  localStorage.setItem(localKey(orgId), JSON.stringify(entries));
};

const computeDuration = (entry: TimeEntry): number | null =>
  entry.clockedOutAt
    ? Math.max(
        0,
        Math.floor(
          (entry.clockedOutAt.getTime() - entry.clockedInAt.getTime()) / 1000,
        ),
      )
    : null;

export const getOpenEntryForUser = async (
  organizationId: string,
  userId: string,
): Promise<TimeEntry | null> => {
  if (isLocalOrg(organizationId)) {
    return (
      readLocal(organizationId).find(
        (e) => e.userId === userId && !e.clockedOutAt,
      ) ?? null
    );
  }

  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("clocked_out_at", null)
    .order("clocked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("Failed to fetch open time entry:", error);
    return null;
  }
  return data ? mapEntry(data) : null;
};

export const clockIn = async (
  organizationId: string,
  userId: string,
  userName: string,
  input: ClockInInput = {},
): Promise<TimeEntry> => {
  // If an entry is already open for this user, return it instead of stacking.
  const existing = await getOpenEntryForUser(organizationId, userId);
  if (existing) return existing;

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const entry: TimeEntry = {
      entryId: crypto.randomUUID(),
      organizationId,
      userId,
      userName,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      notes: input.notes ?? null,
      clockedInAt: now,
      clockedOutAt: null,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [entry, ...readLocal(organizationId)]);
    return entry;
  }

  const row = {
    organization_id: organizationId,
    user_id: userId,
    user_name: userName,
    project_id: input.projectId ?? null,
    project_name: input.projectName ?? null,
    notes: input.notes ?? null,
    clocked_in_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("time_entries")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to clock in:", error);
    throw error;
  }
  return mapEntry(data);
};

export const clockOut = async (
  organizationId: string,
  entryId: string,
  notes?: string | null,
): Promise<TimeEntry> => {
  const now = new Date();

  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((e) => e.entryId === entryId);
    if (idx === -1) throw new Error("Entry not found");
    const updated: TimeEntry = {
      ...all[idx],
      clockedOutAt: now,
      notes: notes ?? all[idx].notes,
      updatedAt: now,
    };
    updated.durationSeconds = computeDuration(updated);
    all[idx] = updated;
    writeLocal(organizationId, all);
    return updated;
  }

  const update: Record<string, unknown> = {
    clocked_out_at: now.toISOString(),
  };
  if (notes !== undefined) update.notes = notes;

  const { data, error } = await supabase
    .from("time_entries")
    .update(update)
    .eq("entry_id", entryId)
    .select()
    .single();

  if (error) {
    logger.error("Failed to clock out:", error);
    throw error;
  }
  return mapEntry(data);
};

export const getOrganizationTimeEntries = async (
  organizationId: string,
): Promise<TimeEntry[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort(
      (a, b) => b.clockedInAt.getTime() - a.clockedInAt.getTime(),
    );
  }

  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .eq("organization_id", organizationId)
    .order("clocked_in_at", { ascending: false });

  if (error) {
    logger.error("Failed to load time entries:", error);
    return [];
  }
  return (data || []).map(mapEntry);
};

export const updateTimeEntry = async (
  organizationId: string,
  entryId: string,
  input: UpdateTimeEntryInput,
  editorUserId?: string,
): Promise<TimeEntry> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((e) => e.entryId === entryId);
    if (idx === -1) throw new Error("Entry not found");
    const merged: TimeEntry = {
      ...all[idx],
      ...(input.clockedInAt ? { clockedInAt: input.clockedInAt } : {}),
      ...(input.clockedOutAt !== undefined
        ? { clockedOutAt: input.clockedOutAt }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.projectName !== undefined
        ? { projectName: input.projectName }
        : {}),
      editedBy: editorUserId ?? all[idx].editedBy ?? null,
      editedAt: new Date(),
      updatedAt: new Date(),
    };
    merged.durationSeconds = computeDuration(merged);
    all[idx] = merged;
    writeLocal(organizationId, all);
    return merged;
  }

  const update: Record<string, unknown> = {
    edited_by: editorUserId ?? null,
    edited_at: new Date().toISOString(),
  };
  if (input.clockedInAt) update.clocked_in_at = input.clockedInAt.toISOString();
  if (input.clockedOutAt !== undefined)
    update.clocked_out_at = input.clockedOutAt
      ? input.clockedOutAt.toISOString()
      : null;
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.projectId !== undefined) update.project_id = input.projectId;
  if (input.projectName !== undefined) update.project_name = input.projectName;

  const { data, error } = await supabase
    .from("time_entries")
    .update(update)
    .eq("entry_id", entryId)
    .select()
    .single();

  if (error) {
    logger.error("Failed to update time entry:", error);
    throw error;
  }
  return mapEntry(data);
};

export const deleteTimeEntry = async (
  organizationId: string,
  entryId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter((e) => e.entryId !== entryId);
    writeLocal(organizationId, all);
    return;
  }

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("entry_id", entryId);

  if (error) {
    logger.error("Failed to delete time entry:", error);
    throw error;
  }
};

export const subscribeToTimeEntries = (
  organizationId: string,
  callback: (entries: TimeEntry[]) => void,
): (() => void) => {
  getOrganizationTimeEntries(organizationId).then(callback);

  if (isLocalOrg(organizationId)) {
    return () => {};
  }

  const channelName = `time-entries-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "time_entries",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationTimeEntries(organizationId).then(callback);
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

export const formatDurationSeconds = (seconds: number | null): string => {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};
