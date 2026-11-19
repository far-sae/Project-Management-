// Pure rules for "HR follows the selected workspace". No React, no Supabase;
// everything here is unit-tested in tests/unit/hrWorkspace.test.ts.
//
// Each person is assigned to at most one workspace (table
// hr_person_workspaces, migration 185). Every HR list is filtered by person:
//   All workspaces → everyone
//   Unassigned     → people with no assignment
//   <workspace id> → people assigned to that workspace
// Until the migration has been run there are no assignments to read, so HR
// shows everyone, exactly as it did before.

import { ALL_WORKSPACES_ID, UNASSIGNED_WORKSPACE_ID } from '@/lib/workspaceScope';

/**
 * Person (user id) → workspace id. `null` means the assignments table is not
 * there yet (the migration has not been run): nothing is filtered.
 */
export type HrAssignments = ReadonlyMap<string, string> | null;

export function toHrAssignments(
  rows: ReadonlyArray<{ userId: string; workspaceId: string }>,
): Map<string, string> {
  return new Map(rows.map((r) => [r.userId, r.workspaceId]));
}

/**
 * Whether one person's records belong in the selected workspace. This is the
 * one rule every HR list uses. It also answers for people who have left the
 * organization, so their old leave, time, expenses and payslips stay in
 * exactly one place: the workspace they were in, or "Unassigned".
 */
export function isInHrScope(userId: string, assignments: HrAssignments, selectedId: string): boolean {
  if (assignments === null || selectedId === ALL_WORKSPACES_ID) return true;
  const workspaceId = assignments.get(userId);
  if (selectedId === UNASSIGNED_WORKSPACE_ID) return !workspaceId;
  return workspaceId === selectedId;
}

/**
 * The members whose data shows for the selection. `null` means "everyone, do
 * not filter" (All workspaces, or the table is missing).
 */
export function hrScopedUserIds<M extends { userId: string }>(
  members: ReadonlyArray<M>,
  assignments: HrAssignments,
  selectedId: string,
): Set<string> | null {
  if (assignments === null || selectedId === ALL_WORKSPACES_ID) return null;
  return new Set(
    members.filter((m) => isInHrScope(m.userId, assignments, selectedId)).map((m) => m.userId),
  );
}

/**
 * Members who are not in any workspace yet. They show only under "Unassigned"
 * and "All workspaces", so HR points them out when a workspace is selected.
 * Empty while the table is missing: there is nothing to assign people to.
 */
export function hrUnassignedPeople<M extends { userId: string; status?: string }>(
  members: ReadonlyArray<M>,
  assignments: HrAssignments,
): M[] {
  if (assignments === null) return [];
  return members.filter((m) => m.status !== 'removed' && !assignments.get(m.userId));
}

const named = (workspaceName: string | null | undefined) => workspaceName?.trim() || 'this workspace';

/** The line under the page title that says whose data is showing. */
export function hrScopeLabel(selectedId: string, workspaceName?: string | null): string {
  if (selectedId === ALL_WORKSPACES_ID) return 'Showing the whole company';
  if (selectedId === UNASSIGNED_WORKSPACE_ID) return 'Showing people with no workspace';
  return `Showing ${named(workspaceName)}`;
}

/**
 * Short note for a figure that covers only part of the company (a payroll
 * run's totals, for example). `null` when the figure is for everyone.
 */
export function hrFigureNote(selectedId: string, workspaceName?: string | null): string | null {
  if (selectedId === ALL_WORKSPACES_ID) return null;
  if (selectedId === UNASSIGNED_WORKSPACE_ID) return 'For people with no workspace only';
  return `For ${named(workspaceName)} only`;
}

/** "3 people are not in a workspace yet." */
export function hrUnassignedNotice(count: number): string {
  return count === 1
    ? '1 person is not in a workspace yet.'
    : `${count} people are not in a workspace yet.`;
}
