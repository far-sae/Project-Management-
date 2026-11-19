import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import {
  hrFigureNote,
  hrScopeLabel,
  hrScopedUserIds,
  hrUnassignedPeople,
  isInHrScope,
  toHrAssignments,
} from '@/lib/hrWorkspace';
import { ALL_WORKSPACES_ID } from '@/lib/workspaceScope';
import { logger } from '@/lib/logger';
import {
  assignPeopleToWorkspace,
  setPersonWorkspace,
  subscribeToPersonWorkspaces,
} from '@/services/supabase/hrWorkspaces';
import type { OrganizationMember } from '@/types/organization';

export interface HrWorkspacePeople {
  /** Whether this person's records show for the workspace picked in the sidebar. */
  inScope: (userId: string) => boolean;
  /** Members in scope; `null` means everyone (nothing is filtered). */
  scopedUserIds: Set<string> | null;
  /** Members who are not in any workspace yet. */
  unassigned: OrganizationMember[];
  /** Put one person in a workspace; `null` takes them out of every workspace. */
  assign: (userId: string, workspaceId: string | null) => Promise<void>;
  /** Put everyone without a workspace into the selected one. Resolves to how many. */
  assignAllUnassignedToSelected: () => Promise<number>;
  /** False until migration 185 has been run: HR then shows the whole company. */
  available: boolean;
  /** The assignments are still being read. */
  loading: boolean;
  /** A workspace is selected but who is in it is not known yet: show a spinner, not numbers. */
  waiting: boolean;
  /** The workspace a person is in, or `null`. */
  workspaceOf: (userId: string) => string | null;
  /** Owners and admins can move people between workspaces. */
  canAssign: boolean;
  /** "Showing Studio". `null` while HR is not split by workspace. */
  label: string | null;
  /** "For Studio only", for figures that cover part of the company. `null` when they cover everyone. */
  figureNote: string | null;
  /** Set when the assignments could not be read; HR shows the whole company meanwhile. */
  error: string | null;
}

/**
 * The HR page loads the assignments once and shares them with the screens it
 * embeds (time tracking, payroll, expenses), so they all change together.
 */
export const HrWorkspacePeopleContext = createContext<HrWorkspacePeople | null>(null);

const NO_MEMBERS: OrganizationMember[] = [];

type Status = 'loading' | 'ready' | 'missing' | 'error';

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.trim() ? message : 'Could not load workspaces.';
};

function useLoadedHrWorkspacePeople(enabled: boolean): HrWorkspacePeople {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const { selectedId, selected } = useSelectedWorkspace();

  const orgId = organization?.organizationId ?? '';
  const actorId = user?.userId ?? null;
  const members = organization?.members ?? NO_MEMBERS;
  const canAssign = Boolean(isOwner || isAdmin);
  const selectedWorkspaceId = selected?.workspaceId ?? null;
  const selectedName = selected?.name ?? null;

  const [status, setStatus] = useState<Status>('loading');
  const [assignments, setAssignments] = useState<Map<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setAssignments(null);
    setError(null);
    if (!orgId) {
      setStatus('missing');
      return;
    }
    setStatus('loading');
    return subscribeToPersonWorkspaces(
      orgId,
      (result) => {
        setAssignments(result.available ? toHrAssignments(result.assignments) : null);
        setStatus(result.available ? 'ready' : 'missing');
        setError(null);
      },
      (e) => {
        logger.error('Failed to load HR workspace assignments:', e);
        // Keep what is already on screen if a later reload fails.
        setStatus((current) => (current === 'ready' ? current : 'error'));
        setError(messageOf(e));
      },
    );
  }, [enabled, orgId]);

  const available = status === 'ready' && assignments !== null;
  const loading = enabled && status === 'loading';

  const inScope = useCallback(
    (userId: string) => isInHrScope(userId, assignments, selectedId),
    [assignments, selectedId],
  );
  const scopedUserIds = useMemo(
    () => hrScopedUserIds(members, assignments, selectedId),
    [members, assignments, selectedId],
  );
  const unassigned = useMemo(
    () => (assignments === null ? NO_MEMBERS : hrUnassignedPeople(members, assignments)),
    [members, assignments],
  );
  const workspaceOf = useCallback((userId: string) => assignments?.get(userId) ?? null, [assignments]);

  const assign = useCallback(
    async (userId: string, workspaceId: string | null) => {
      if (!available || !orgId) return;
      if (!canAssign) throw new Error('Only an owner or an admin can change who is in a workspace.');
      const before = assignments?.get(userId) ?? null;
      const place = (target: string | null) =>
        setAssignments((current) => {
          if (!current) return current;
          const next = new Map(current);
          if (target) next.set(userId, target);
          else next.delete(userId);
          return next;
        });
      place(workspaceId);
      try {
        const result = await setPersonWorkspace(orgId, userId, workspaceId, actorId);
        if (!result.available) {
          setAssignments(null);
          setStatus('missing');
        }
      } catch (e) {
        place(before);
        throw e;
      }
    },
    [available, orgId, canAssign, assignments, actorId],
  );

  const assignAllUnassignedToSelected = useCallback(async () => {
    if (!available || !orgId || !selectedWorkspaceId || unassigned.length === 0) return 0;
    if (!canAssign) throw new Error('Only an owner or an admin can change who is in a workspace.');
    const userIds = unassigned.map((m) => m.userId);
    const result = await assignPeopleToWorkspace(orgId, userIds, selectedWorkspaceId, actorId);
    if (!result.available) {
      setAssignments(null);
      setStatus('missing');
      return 0;
    }
    setAssignments((current) => {
      if (!current) return current;
      const next = new Map(current);
      for (const userId of userIds) next.set(userId, selectedWorkspaceId);
      return next;
    });
    return userIds.length;
  }, [available, orgId, selectedWorkspaceId, unassigned, canAssign, actorId]);

  return useMemo<HrWorkspacePeople>(
    () => ({
      inScope,
      scopedUserIds,
      unassigned,
      assign,
      assignAllUnassignedToSelected,
      available,
      loading,
      waiting: loading && selectedId !== ALL_WORKSPACES_ID,
      workspaceOf,
      canAssign,
      label: available ? hrScopeLabel(selectedId, selectedName) : null,
      figureNote: available ? hrFigureNote(selectedId, selectedName) : null,
      error,
    }),
    [
      inScope, scopedUserIds, unassigned, assign, assignAllUnassignedToSelected, available,
      loading, selectedId, workspaceOf, canAssign, selectedName, error,
    ],
  );
}

/**
 * Whose HR data shows for the workspace picked in the sidebar, and the means
 * to put people in a workspace. Every HR list filters with `inScope`, so the
 * same rule applies on every tab and on /time, /payroll and /expenses.
 */
export function useHrWorkspacePeople(): HrWorkspacePeople {
  const shared = useContext(HrWorkspacePeopleContext);
  const own = useLoadedHrWorkspacePeople(shared === null);
  return shared ?? own;
}

export default useHrWorkspacePeople;
