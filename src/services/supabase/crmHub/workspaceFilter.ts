/**
 * Workspace filter semantics shared across CRM services:
 *
 *   undefined → "All workspaces" — do not filter by workspace_id
 *   null      → "Unassigned"     — workspace_id IS NULL only
 *   string    → specific workspace — workspace_id = <string> only
 *
 * Every list* function in the CRM accepts `workspaceId?: string | null` and
 * threads it through this helper so the whole surface behaves consistently
 * with the sidebar workspace switcher (which offers "All", "Unassigned",
 * and each real workspace as a selection).
 */
// deno-lint-ignore-file no-explicit-any
export function applyWorkspaceFilter<T>(
  q: T,
  workspaceId: string | null | undefined,
  column = 'workspace_id',
): T {
  if (workspaceId === undefined) return q;
  const query = q as unknown as {
    is(col: string, v: null): T;
    eq(col: string, v: string): T;
  };
  if (workspaceId === null) return query.is(column, null);
  return query.eq(column, workspaceId);
}
