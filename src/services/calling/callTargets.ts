export interface CallTarget {
  userId: string;
  displayName: string;
  photoURL?: string;
}

/**
 * Who a project call rings: every member with an account except the caller,
 * plus the project owner — the owner is implicit (projects.owner_id) and is
 * often missing from `members`, so before this they were never rung.
 */
export function buildProjectCallTargets(
  members: ReadonlyArray<{ userId?: string | null; displayName?: string | null; photoURL?: string | null; email?: string | null }>,
  ownerId: string | null | undefined,
  selfId: string | null | undefined,
  nameFor: (userId: string, storedName: string) => string,
): CallTarget[] {
  const seen = new Set<string>();
  const out: CallTarget[] = [];
  const add = (userId: string | null | undefined, stored: string, photoURL?: string | null) => {
    if (!userId || userId === selfId || seen.has(userId)) return;
    seen.add(userId);
    out.push({
      userId,
      displayName: nameFor(userId, stored),
      ...(photoURL ? { photoURL } : {}),
    });
  };
  for (const m of members) add(m.userId, m.displayName ?? '', m.photoURL);
  add(ownerId, '');
  return out;
}
