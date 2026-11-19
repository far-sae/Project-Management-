import { supabase } from './config';

// Which workspace each person belongs to, for HR. The table comes from
// migration 185_hr_person_workspace.sql.

const TABLE = 'hr_person_workspaces';
const ON_CONFLICT = 'organization_id,user_id';

export interface PersonWorkspace {
  userId: string;
  workspaceId: string;
}

/**
 * `available: false` means the table is not there yet (the migration has not
 * been run). Callers treat that as "HR is not split by workspace" and show
 * the whole company; it is not an error.
 */
export interface PersonWorkspacesResult {
  available: boolean;
  assignments: PersonWorkspace[];
}

export interface PersonWorkspaceWriteResult {
  available: boolean;
}

const NOT_SET_UP: PersonWorkspacesResult = { available: false, assignments: [] };

/** True when the database does not have the assignments table yet. */
export function isHrWorkspaceSetupMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    /does not exist/i.test(e.message ?? '') ||
    /could not find the table/i.test(e.message ?? '')
  );
}

/** Accounts that only live on this device have no database to ask. */
const hasNoDatabase = (organizationId: string) => !organizationId || organizationId.startsWith('local-');

export async function listPersonWorkspaces(organizationId: string): Promise<PersonWorkspacesResult> {
  if (hasNoDatabase(organizationId)) return NOT_SET_UP;
  const { data, error } = await supabase
    .from(TABLE)
    .select('user_id, workspace_id')
    .eq('organization_id', organizationId);
  if (error) {
    if (isHrWorkspaceSetupMissing(error)) return NOT_SET_UP;
    throw error;
  }
  return {
    available: true,
    assignments: ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      userId: row.user_id as string,
      workspaceId: row.workspace_id as string,
    })),
  };
}

const finishWrite = (error: unknown): PersonWorkspaceWriteResult => {
  if (!error) return { available: true };
  if (isHrWorkspaceSetupMissing(error)) return { available: false };
  throw error;
};

/** Put one person in a workspace. `null` takes them out of every workspace. */
export async function setPersonWorkspace(
  organizationId: string,
  userId: string,
  workspaceId: string | null,
  actorId: string | null,
): Promise<PersonWorkspaceWriteResult> {
  if (hasNoDatabase(organizationId)) return { available: false };
  if (workspaceId === null) {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId);
    return finishWrite(error);
  }
  return assignPeopleToWorkspace(organizationId, [userId], workspaceId, actorId);
}

/** Put several people in one workspace with a single request. */
export async function assignPeopleToWorkspace(
  organizationId: string,
  userIds: string[],
  workspaceId: string,
  actorId: string | null,
): Promise<PersonWorkspaceWriteResult> {
  if (hasNoDatabase(organizationId)) return { available: false };
  const people = [...new Set(userIds)];
  if (people.length === 0) return { available: true };
  const updatedAt = new Date().toISOString();
  const rows = people.map((userId) => ({
    organization_id: organizationId,
    user_id: userId,
    workspace_id: workspaceId,
    assigned_by: actorId,
    updated_at: updatedAt,
  }));
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: ON_CONFLICT });
  return finishWrite(error);
}

/**
 * Load the assignments, then again every time one changes. When the table is
 * missing the first answer is the only one: it is checked once and nothing is
 * listened to. Returns the function that stops it.
 */
export const subscribeToPersonWorkspaces = (
  organizationId: string,
  callback: (result: PersonWorkspacesResult) => void,
  onError?: (error: unknown) => void,
): (() => void) => {
  let active = true;
  let stopListening: (() => void) | null = null;

  const load = async (): Promise<PersonWorkspacesResult | null> => {
    try {
      const result = await listPersonWorkspaces(organizationId);
      if (active) callback(result);
      return result;
    } catch (error) {
      if (active) onError?.(error);
      return null;
    }
  };

  void load().then((first) => {
    if (!active || !first?.available) return;
    const channel = supabase
      .channel(`hr-person-workspaces-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TABLE,
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    stopListening = () => {
      void channel.unsubscribe();
    };
  });

  return () => {
    active = false;
    stopListening?.();
  };
};
