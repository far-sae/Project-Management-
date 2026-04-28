export type MentionableMember = {
  userId: string;
  displayName: string;
  email: string;
  photoURL?: string;
};

/**
 * If the cursor is in an @-mention segment (no whitespace after @), returns the @ index and
 * lowercase query text after it (may be empty).
 */
export function getActiveMention(
  value: string,
  selectionStart: number,
): { from: number; query: string } | null {
  if (selectionStart < 1) return null;
  const before = value.slice(0, selectionStart);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  const afterAt = before.slice(at + 1);
  if (/\s/.test(afterAt)) return null;
  return { from: at, query: afterAt.toLowerCase() };
}

export function filterMentionMembers(
  members: MentionableMember[],
  query: string,
  excludeUserId?: string,
  limit = 12,
): MentionableMember[] {
  const list = members.filter((m) => m.userId && m.userId !== excludeUserId);
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  return list
    .filter((m) => {
      const name = (m.displayName || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      const first = name.split(/\s+/)[0] || "";
      const local = email.split("@")[0] || "";
      return (
        name.includes(q) ||
        email.includes(q) ||
        first.includes(q) ||
        local.includes(q)
      );
    })
    .slice(0, limit);
}

/**
 * Label placed after `@` in the message. Matches tokens used by `findMentionedUserIdsFromText`.
 */
export function mentionLabelForMember(m: MentionableMember): string {
  const name = (m.displayName || "").trim();
  const first = name.split(/\s+/)[0] || "";
  if (first.length >= 2) return first;
  const local = (m.email || "").split("@")[0] || "";
  if (local.length >= 2) return local;
  return m.userId.slice(0, 8);
}

export function applyMention(
  value: string,
  mentionFrom: number,
  selectionStart: number,
  label: string,
): { next: string; cursor: number } {
  const before = value.slice(0, mentionFrom);
  const after = value.slice(selectionStart);
  const insert = `@${label} `;
  const next = value.slice(0, mentionFrom) + insert + after;
  const cursor = before.length + insert.length;
  return { next, cursor };
}
