const GENERIC_MEMBER_NAMES = new Set([
  '',
  'admin',
  'member',
  'owner',
  'unknown',
  'user',
  'viewer',
  'you',
]);

export const isGenericMemberDisplayName = (
  value: string | null | undefined,
): boolean => GENERIC_MEMBER_NAMES.has(value?.trim().toLowerCase() ?? '');

/**
 * Resolve a person's label without ever presenting an access role (for
 * example, "Member") as though it were their name.
 */
export const resolveMemberDisplayName = (
  userId: string,
  email: string | null | undefined,
  ...candidates: Array<string | null | undefined>
): string => {
  const name = candidates.find(
    (candidate) => !isGenericMemberDisplayName(candidate),
  );
  if (name) return name.trim();

  const emailName = email?.split('@')[0]?.trim();
  if (emailName) return emailName;

  const shortId = userId.trim().slice(0, 6);
  return shortId ? `Teammate ${shortId}` : 'Teammate';
};
